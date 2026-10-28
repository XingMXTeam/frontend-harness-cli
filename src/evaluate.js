import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { featureDir } from './config.js';
import { resolveFromRoot } from './git.js';
import { runScan } from './scan.js';
import { layerKey } from './rubric.js';
export { DEFAULT_LAYER_WEIGHTS, layerKey } from './rubric.js';

/**
 * Run one rubric item. Returns { score: 0 | 0.5 | 1, detail }.
 * Deterministic kinds (command/file/grep) are only ever 0 or 1 — the kernel
 * never lets a model grade what a script can decide. kind=judge is the one
 * exception: an evaluator agent writes { score, note } to the item's evidence
 * file, and a judge item with no evidence scores 0.
 */
export function runItem(root, item, timeoutMs, scanCache = new Map(), opts = {}) {
  switch (item.kind) {
    case 'scan': {
      // Sensor input, not a second verdict: read one dimension score from
      // the gate engine and compare it with this item's own minScore.
      const target = resolveFromRoot(root, item.path ?? '.');
      if (!scanCache.has(target)) scanCache.set(target, runScan(target));
      const report = scanCache.get(target);
      const dim = report.dimensions[item.dimension];
      if (!dim) return { score: 0, detail: `scan: no dimension "${item.dimension}" in report` };
      const ok = dim.score >= item.minScore;
      return { score: ok ? 1 : 0, detail: `scan ${item.dimension}=${dim.score} (min ${item.minScore}) on ${item.path ?? '.'}; sensor total=${report.totalScore}` };
    }
    case 'command': {
      const r = spawnSync(item.command, { cwd: root, shell: true, encoding: 'utf8', timeout: timeoutMs });
      const ok = r.status === 0;
      const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-3).join(' | ').slice(0, 300);
      return { score: ok ? 1 : 0, detail: `exit=${r.status}${tail ? ` ${tail}` : ''}` };
    }
    case 'file': {
      const p = resolveFromRoot(root, item.path);
      if (!existsSync(p)) return { score: 0, detail: `missing file: ${item.path}` };
      const bytes = statSync(p).size;
      if (item.minBytes && bytes < item.minBytes) return { score: 0, detail: `${item.path} is ${bytes}B < minBytes ${item.minBytes} (blank/stub?)` };
      return { score: 1, detail: `${item.path} exists (${bytes}B)` };
    }
    case 'grep': {
      const p = resolveFromRoot(root, item.path);
      if (!existsSync(p)) return { score: 0, detail: `missing file: ${item.path}` };
      let found = false;
      const target = statSync(p).isDirectory() ? null : p;
      if (target) {
        found = new RegExp(item.pattern, 'm').test(readFileSync(target, 'utf8'));
      }
      const expect = item.expect ?? 'present';
      const ok = expect === 'present' ? found : !found;
      return { score: ok ? 1 : 0, detail: `pattern /${item.pattern}/ in ${item.path}: ${found ? 'found' : 'not found'}, expected ${expect}` };
    }
    case 'judge': {
      const p = resolveFromRoot(root, item.evidence);
      if (!existsSync(p)) return { score: 0, detail: `no judge evidence at ${item.evidence} — unevaluated items score 0` };
      // Freshness: evidence older than the work it judges (or, in the
      // confirmation pass, older than the previous evaluation) was not
      // produced by a fresh evaluator for this state of the code.
      if (opts.freshSince && statSync(p).mtimeMs < opts.freshSince) {
        return { score: 0, detail: `stale judge evidence at ${item.evidence}: written before ${new Date(opts.freshSince).toISOString()} (${opts.freshReason ?? 'the latest change'}) — regenerate it in a fresh evaluator context` };
      }
      let ev;
      try {
        ev = JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        return { score: 0, detail: `judge evidence at ${item.evidence} is not valid JSON` };
      }
      const s = Number(ev.score);
      if (![0, 0.5, 1].includes(s)) return { score: 0, detail: `judge evidence score must be 0, 0.5 or 1 (got ${ev.score})` };
      const artifacts = Array.isArray(ev.artifacts) ? ev.artifacts : [];
      const missing = artifacts.filter((a) => !existsSync(resolveFromRoot(root, a)));
      if (missing.length) return { score: 0, detail: `judge evidence cites missing artifact(s): ${missing.join(', ')}` };
      // A red line declared "(check: screenshot)" is judged from pixels:
      // its judge item must cite at least one real PNG screenshot.
      const anchor = opts.vision?.get?.(item.anchor);
      if (anchor && anchor.type === 'RL' && /check\s*:\s*screenshot/i.test(anchor.text)) {
        const minBytes = opts.minScreenshotBytes ?? 2048;
        const real = artifacts.filter((a) => /\.png$/i.test(a) && isRealPng(resolveFromRoot(root, a), minBytes));
        if (!real.length) return { score: 0, detail: `${item.anchor} is a screenshot-checked red line; the judge evidence must cite at least one real PNG (>= ${minBytes}B) in "artifacts" — run harness capture` };
      }
      return { score: s, detail: `judge: ${ev.note ?? ''}`.slice(0, 300) };
    }
    default:
      return { score: 0, detail: `unknown kind ${item.kind}` };
  }
}

export function isRealPng(file, minBytes) {
  if (!existsSync(file)) return false;
  const buf = readFileSync(file);
  return buf.length >= minBytes && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

/**
 * Weighted score. Flat mode (default): sum(score*weight)/sum(weight) over
 * non-pitfall items. Layered mode (rubric.layerWeights set): each layer
 * L1–L4 is scored on its own, then combined with the layer weights,
 * renormalized over the layers that actually have items.
 */
export function weightedScore(rubric, results) {
  const scored = results.filter((r) => r.item.level !== 'pitfall');
  const round = (x) => Math.round(x * 1000) / 1000;
  if (!rubric.layerWeights) {
    const denom = scored.reduce((s, r) => s + r.item.weight, 0);
    const numer = scored.reduce((s, r) => s + r.score * r.item.weight, 0);
    return { score: denom === 0 ? 0 : round(numer / denom), layers: null };
  }
  const layers = {};
  for (const r of scored) {
    const k = layerKey(r.item.layer);
    layers[k] ??= { numer: 0, denom: 0, weight: rubric.layerWeights[k] ?? 0 };
    layers[k].numer += r.score * r.item.weight;
    layers[k].denom += r.item.weight;
  }
  let total = 0;
  let wsum = 0;
  const out = {};
  for (const [k, l] of Object.entries(layers)) {
    const ls = l.denom === 0 ? 0 : l.numer / l.denom;
    out[k] = { score: round(ls), weight: l.weight };
    total += ls * l.weight;
    wsum += l.weight;
  }
  return { score: wsum === 0 ? 0 : round(total / wsum), layers: out };
}

/**
 * Score a rubric.
 * Verdict rules (in order — the veto is the point):
 *  1. Any triggered pitfall (score > 0 on a pitfall grep/command means the
 *     forbidden thing is present; pitfall items are written so score 1 on
 *     their check = clean, see runItem semantics below) — we use the
 *     convention: a pitfall item PASSES (score 1) when clean and FAILS
 *     (score 0) when the pitfall is present. Failing pitfall = veto.
 *  2. Any essential item scoring 0 = veto.
 *  3. Otherwise the weighted score must reach config passScore.
 */
export function evaluateRubric(root, rubric, config, opts = {}) {
  const timeoutMs = config.evaluation.commandTimeoutMs;
  const scanCache = new Map(); // one sensor run per target path, shared by all scan items
  const itemOpts = { ...opts, minScreenshotBytes: opts.minScreenshotBytes ?? config.evidence?.minScreenshotBytes ?? 2048 };
  const results = rubric.items.map((item) => ({ item, ...runItem(root, item, timeoutMs, scanCache, itemOpts) }));

  const vetoed = [];
  for (const r of results) {
    if (r.item.level === 'pitfall' && r.score === 0) vetoed.push({ id: r.item.id, reason: `pitfall triggered: ${r.detail}` });
    if (r.item.level === 'essential' && r.score === 0) vetoed.push({ id: r.item.id, reason: `essential item failed: ${r.detail}` });
  }

  const { score, layers } = weightedScore(rubric, results);

  const verdict = vetoed.length > 0 ? 'fail' : score >= config.evaluation.passScore ? 'pass' : 'fail';
  return {
    at: Date.now(),
    verdict,
    // Why it failed, in the fixed vocabulary the routing table uses.
    verdictReason: vetoed.length > 0 ? 'veto' : verdict === 'pass' ? 'score' : 'below-pass-score',
    score,
    passScore: config.evaluation.passScore,
    ...(layers ? { layers } : {}),
    vetoed,
    results: results.map((r) => ({ id: r.item.id, requirement: r.item.requirement ?? null, level: r.item.level, kind: r.item.kind, ...(r.item.layer ? { layer: r.item.layer } : {}), score: r.score, detail: r.detail })),
  };
}

export function writeReport(root, feature, evaluation) {
  const dir = path.join(featureDir(root, feature), 'evaluation');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `report-${evaluation.at}.json`);
  writeFileSync(file, `${JSON.stringify(evaluation, null, 2)}\n`);
  writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(evaluation, null, 2)}\n`);
  return file;
}

/** Delivery gate: run configured commands fail-fast. Returns { passed, steps }. */
export function runGateCommands(root, config) {
  const steps = [];
  for (const cmd of config.gateCommands) {
    const started = Date.now();
    const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', timeout: config.evaluation.commandTimeoutMs });
    const step = { command: cmd, status: r.status === 0 ? 'passed' : 'failed', exitCode: r.status, durationMs: Date.now() - started };
    steps.push(step);
    if (step.status !== 'passed') return { passed: false, failedAt: cmd, steps };
  }
  return { passed: true, failedAt: null, steps };
}
