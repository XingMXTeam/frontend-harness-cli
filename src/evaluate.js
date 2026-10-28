import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { featureDir } from './config.js';
import { resolveFromRoot } from './git.js';

/**
 * Run one rubric item. Returns { score: 0 | 0.5 | 1, detail }.
 * Deterministic kinds (command/file/grep) are only ever 0 or 1 — the kernel
 * never lets a model grade what a script can decide. kind=judge is the one
 * exception: an evaluator agent writes { score, note } to the item's evidence
 * file, and a judge item with no evidence scores 0.
 */
export function runItem(root, item, timeoutMs) {
  switch (item.kind) {
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
      try {
        const ev = JSON.parse(readFileSync(p, 'utf8'));
        const s = Number(ev.score);
        if (![0, 0.5, 1].includes(s)) return { score: 0, detail: `judge evidence score must be 0, 0.5 or 1 (got ${ev.score})` };
        return { score: s, detail: `judge: ${ev.note ?? ''}`.slice(0, 300) };
      } catch {
        return { score: 0, detail: `judge evidence at ${item.evidence} is not valid JSON` };
      }
    }
    default:
      return { score: 0, detail: `unknown kind ${item.kind}` };
  }
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
export function evaluateRubric(root, rubric, config) {
  const timeoutMs = config.evaluation.commandTimeoutMs;
  const results = rubric.items.map((item) => ({ item, ...runItem(root, item, timeoutMs) }));

  const vetoed = [];
  for (const r of results) {
    if (r.item.level === 'pitfall' && r.score === 0) vetoed.push({ id: r.item.id, reason: `pitfall triggered: ${r.detail}` });
    if (r.item.level === 'essential' && r.score === 0) vetoed.push({ id: r.item.id, reason: `essential item failed: ${r.detail}` });
  }

  const scored = results.filter((r) => r.item.level !== 'pitfall');
  const denom = scored.reduce((s, r) => s + r.item.weight, 0);
  const numer = scored.reduce((s, r) => s + r.score * r.item.weight, 0);
  const score = denom === 0 ? 0 : Math.round((numer / denom) * 1000) / 1000;

  const verdict = vetoed.length > 0 ? 'fail' : score >= config.evaluation.passScore ? 'pass' : 'fail';
  return {
    at: Date.now(),
    verdict,
    score,
    passScore: config.evaluation.passScore,
    vetoed,
    results: results.map((r) => ({ id: r.item.id, requirement: r.item.requirement ?? null, level: r.item.level, kind: r.item.kind, score: r.score, detail: r.detail })),
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
