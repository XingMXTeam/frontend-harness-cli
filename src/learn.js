/**
 * learn.js — turn repeated failures into rules the kernel enforces.
 *
 * A veto that keeps coming back is not bad luck; it is a missing rule.
 * `fh learn` reads every evaluation report of every feature, groups the
 * failed items into mistake classes, and for each class that repeats
 * proposes the strongest enforcer that can hold it:
 *
 *   gate            the command joins harness.config.json gateCommands
 *   project-pitfall a pitfall item in .harness/project-rules.json, merged
 *                   into EVERY feature's evaluation — a veto, not advice
 *   deterministic   a judge item that keeps failing: rewrite it as a script
 *   per-task        already in the gate, still failing late: run it per task
 *   standards       write it into .harness/standards.md (weakest — docs)
 *
 * The rule → enforcer table lives in .harness/learnings.json. `fh learn
 * adopt <id>` applies the auto-adoptable ones; nothing is adopted silently.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { HARNESS_DIR, configPath } from './config.js';

export const learningsFile = (root) => path.join(root, HARNESS_DIR, 'learnings.json');
export const projectRulesFile = (root) => path.join(root, HARNESS_DIR, 'project-rules.json');

/** Strongest first — the order the proposals are listed in. */
export const ENFORCERS = ['gate', 'project-pitfall', 'deterministic', 'per-task', 'standards'];
export const PROJECT_RULE_PREFIX = 'PR-';
const PROJECT_RULE_KINDS = new Set(['grep', 'command', 'scan', 'verify']);

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };

/** Every evaluation report of every feature, oldest first, with the rubric it was scored against. */
export function collectReports(root) {
  const tasksDir = path.join(root, HARNESS_DIR, 'tasks');
  if (!existsSync(tasksDir)) return [];
  const out = [];
  for (const feature of readdirSync(tasksDir).sort()) {
    const evalDir = path.join(tasksDir, feature, 'evaluation');
    if (!existsSync(evalDir)) continue;
    const rubric = readJson(path.join(tasksDir, feature, 'rubric.json'), { items: [] });
    const items = new Map((rubric.items ?? []).map((i) => [i.id, i]));
    for (const f of readdirSync(evalDir).filter((n) => /^report-\d+\.json$/.test(n))) {
      const report = readJson(path.join(evalDir, f), null);
      if (report?.results) out.push({ feature, report, items });
    }
  }
  return out.sort((a, b) => a.report.at - b.report.at);
}

/**
 * The mistake class of one failed result. Classes that can repeat across
 * features are keyed by what they check (a pattern, a command); classes
 * that only make sense inside one feature are keyed by feature + item.
 */
export function signatureOf(feature, result, item) {
  const kind = item?.kind ?? result.kind;
  switch (kind) {
    case 'grep': return item?.pattern ? `grep:${item.expect ?? 'present'}:${item.pattern}` : null;
    case 'command': return item?.command ? `command:${item.command}` : null;
    case 'scan': return item?.dimension ? `scan:${item.dimension}` : null;
    case 'verify': return item?.check ? `verify:${item.check}` : null;
    case 'judge': return `judge:${feature}:${result.id}`;
    case 'file': return `file:${feature}:${result.id}`;
    default: return null;
  }
}

function proposalFor(sig, item, config) {
  const [kind] = sig.split(':');
  if (kind === 'command' || kind === 'verify') {
    const command = kind === 'command' ? item.command : `fh verify --only ${item.check}`;
    if ((config.gateCommands ?? []).includes(command)) {
      return { enforcer: 'per-task', adoptable: false, action: `"${command}" is already in the delivery gate but keeps failing at evaluation — have the developer run it before every \`fh done\` (implement-task skill), so it fails at the task, not the cycle.` };
    }
    return { enforcer: 'gate', adoptable: true, action: `add "${command}" to gateCommands — no delivery while it fails`, command };
  }
  if (kind === 'grep' || kind === 'scan') {
    const { id: _id, requirement: _r, weight: _w, layer: _l, ...check } = item;
    return {
      enforcer: 'project-pitfall', adoptable: true,
      action: `add a project-wide pitfall (${kind === 'grep' ? `/${item.pattern}/ in ${item.path}` : `scan ${item.dimension} >= ${item.minScore}`}) — every feature's evaluation vetoes on it`,
      rule: { ...check, level: 'pitfall' },
    };
  }
  if (kind === 'judge') {
    return { enforcer: 'deterministic', adoptable: false, action: 'a judgment that fails repeatedly is a check that can be scripted — rewrite it as a grep / command / verify item (deterministic-eval skill) so the kernel decides it, not a model' };
  }
  return { enforcer: 'standards', adoptable: false, action: 'write the expectation into .harness/standards.md so the planner names it in the next rubric' };
}

/**
 * Mine the reports. A class is a learning when it failed in at least
 * `min` reports. Status (adopted / dismissed) carries over by signature.
 */
export function mine(root, config, { min = 2 } = {}) {
  const prior = new Map((readJson(learningsFile(root), { rules: [] }).rules ?? []).map((r) => [r.signature, r]));
  const classes = new Map();
  for (const { feature, report, items } of collectReports(root)) {
    for (const r of report.results) {
      if (r.score !== 0 || String(r.id).startsWith(PROJECT_RULE_PREFIX)) continue;
      const item = items.get(r.id) ?? { kind: r.kind };
      const sig = signatureOf(feature, r, item);
      if (!sig) continue;
      const c = classes.get(sig) ?? { signature: sig, item, occurrences: 0, features: new Set(), firstSeen: report.at, lastSeen: report.at, sample: '' };
      c.occurrences += 1;
      c.features.add(feature);
      c.lastSeen = Math.max(c.lastSeen, report.at);
      c.sample = `${feature}/${r.id}: ${r.detail ?? ''}`.slice(0, 200);
      classes.set(sig, c);
    }
  }
  const rules = [];
  for (const c of classes.values()) {
    if (c.occurrences < min) continue;
    const p = proposalFor(c.signature, c.item, config);
    const old = prior.get(c.signature);
    rules.push({
      id: old?.id ?? `L-${createHash('sha1').update(c.signature).digest('hex').slice(0, 6)}`,
      signature: c.signature,
      occurrences: c.occurrences,
      features: [...c.features].sort(),
      firstSeen: c.firstSeen,
      lastSeen: c.lastSeen,
      sample: c.sample,
      ...p,
      status: old?.status ?? 'suggested',
      ...(old?.adoptedAs ? { adoptedAs: old.adoptedAs } : {}),
    });
  }
  // Keep adopted/dismissed rules even when their class stopped failing —
  // that is the rule working, and the table should still show it.
  for (const old of prior.values()) {
    if (old.status !== 'suggested' && !rules.some((r) => r.signature === old.signature)) rules.push(old);
  }
  rules.sort((a, b) => ENFORCERS.indexOf(a.enforcer) - ENFORCERS.indexOf(b.enforcer) || b.occurrences - a.occurrences);
  return { updatedAt: Date.now(), min, rules };
}

export function saveLearnings(root, learnings) {
  mkdirSync(path.join(root, HARNESS_DIR), { recursive: true });
  writeFileSync(learningsFile(root), `${JSON.stringify(learnings, null, 2)}\n`);
}

export function loadLearnings(root) {
  return readJson(learningsFile(root), null);
}

/** Project-wide pitfall items, validated. Merged into every evaluation. */
export function loadProjectRules(root) {
  const raw = readJson(projectRulesFile(root), { items: [] });
  const items = Array.isArray(raw.items) ? raw.items : [];
  for (const it of items) {
    if (!String(it.id ?? '').startsWith(PROJECT_RULE_PREFIX)) throw new Error(`project-rules.json: item id "${it.id}" must start with ${PROJECT_RULE_PREFIX}`);
    if (it.level !== 'pitfall') throw new Error(`project-rules.json: ${it.id} must be level "pitfall" (project rules only veto)`);
    if (!PROJECT_RULE_KINDS.has(it.kind)) throw new Error(`project-rules.json: ${it.id} kind must be one of ${[...PROJECT_RULE_KINDS].join('/')}`);
  }
  return items.map((it) => ({ ...it, weight: 1, projectRule: true }));
}

/**
 * Apply one learning. Returns what changed. Only gate and project-pitfall
 * proposals are auto-adoptable; the rest name a manual step.
 */
export function adopt(root, id) {
  const learnings = loadLearnings(root);
  const rule = learnings?.rules?.find((r) => r.id === id);
  if (!rule) throw new Error(`No learning ${id}. Run \`fh learn\` to list them.`);
  if (rule.status === 'adopted') return { already: true, rule };
  if (!rule.adoptable) throw new Error(`${id} (${rule.enforcer}) is not auto-adoptable: ${rule.action}`);

  let adoptedAs;
  if (rule.enforcer === 'gate') {
    const raw = readJson(configPath(root), {});
    raw.gateCommands = [...new Set([...(raw.gateCommands ?? []), rule.command])];
    writeFileSync(configPath(root), `${JSON.stringify(raw, null, 2)}\n`);
    adoptedAs = `gateCommands: ${rule.command}`;
  } else {
    const file = projectRulesFile(root);
    const raw = readJson(file, { items: [] });
    raw.items ??= [];
    const n = raw.items.reduce((m, it) => Math.max(m, Number(String(it.id).slice(PROJECT_RULE_PREFIX.length)) || 0), 0) + 1;
    const item = { id: `${PROJECT_RULE_PREFIX}${n}`, ...rule.rule, source: `${rule.id} ${rule.signature}` };
    raw.items.push(item);
    writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
    adoptedAs = `project-rules.json: ${item.id}`;
  }
  rule.status = 'adopted';
  rule.adoptedAs = adoptedAs;
  saveLearnings(root, learnings);
  return { already: false, rule };
}

export function dismiss(root, id, reason) {
  const learnings = loadLearnings(root);
  const rule = learnings?.rules?.find((r) => r.id === id);
  if (!rule) throw new Error(`No learning ${id}. Run \`fh learn\` to list them.`);
  if (!String(reason ?? '').trim()) throw new Error('Dismissing a learning needs a reason (--reason "…"): a repeated failure you choose to live with should say why.');
  rule.status = 'dismissed';
  rule.reason = reason;
  saveLearnings(root, learnings);
  return rule;
}

export function formatLearnings(learnings) {
  if (!learnings.rules.length) return `No repeated failures (a class needs >= ${learnings.min} failed evaluations). Nothing to learn yet.`;
  const lines = ['rule      enforcer         seen  status     action'];
  for (const r of learnings.rules) {
    lines.push(`${r.id.padEnd(9)} ${r.enforcer.padEnd(16)} ${String(r.occurrences ?? '').padStart(4)}  ${r.status.padEnd(10)} ${r.adoptedAs ?? r.action}`);
    if (r.status === 'suggested' && r.sample) lines.push(`          └ ${r.sample}`);
  }
  const open = learnings.rules.filter((r) => r.status === 'suggested' && r.adoptable);
  if (open.length) lines.push('', `Adopt: ${open.map((r) => `fh learn adopt ${r.id}`).join('   ')}`);
  return lines.join('\n');
}
