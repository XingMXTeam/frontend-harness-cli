import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { featureDir } from './config.js';
import { resolveFromRoot } from './git.js';
import { rubricPath } from './rubric.js';

/**
 * Rubric evolution: the evaluator is the one actor that sees where the
 * rubric was too vague to score, missed a defect, or weighted something
 * wrong. It may attach `rubricRefinementSuggestions` to any judge
 * evidence file (or write evaluation/rubric-refinements.json). The kernel
 * records them; the planner must answer every one at replan time
 * (accepted | rejected-with-reason) before remediation continues.
 *
 * The rubric may only tighten without a human: removing an essential or
 * pitfall item, or lowering an item's level, needs GATE_HUMAN_CONFIRM=yes.
 */

export const REFINEMENT_TYPES = ['refine', 'add-verification', 'add', 'regrade'];
const LEVEL_RANK = { optional: 1, important: 2, essential: 3 };

export function normalizeSuggestion(raw, source) {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const type = String(raw.type ?? '').trim();
  if (!REFINEMENT_TYPES.includes(type)) return { error: `type must be one of ${REFINEMENT_TYPES.join('/')} (got "${raw.type}")` };
  const item = String(raw.item ?? '').trim();
  if (!item) return { error: 'item is required (an existing rubric id, or "NEW")' };
  const suggestion = String(raw.suggestion ?? '').trim();
  if (!suggestion) return { error: 'suggestion text is required' };
  return {
    type,
    item,
    problem: raw.problem ? String(raw.problem).trim() : null,
    suggestion,
    layer: raw.layer ?? null,
    level: raw.level ?? null,
    source,
  };
}

/** Collect suggestions from judge evidence files + the optional standalone file. */
export function collectRefinements(root, feature, rubric) {
  const found = [];
  const invalid = [];
  const take = (list, source) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const s = normalizeSuggestion(raw, source);
      if (s.error) invalid.push({ source, error: s.error });
      else found.push(s);
    }
  };
  for (const it of rubric.items) {
    if (it.kind !== 'judge') continue;
    const p = resolveFromRoot(root, it.evidence);
    if (!existsSync(p)) continue;
    try { take(JSON.parse(readFileSync(p, 'utf8')).rubricRefinementSuggestions, it.evidence); } catch { /* scored elsewhere */ }
  }
  const standalone = path.join(featureDir(root, feature), 'evaluation', 'rubric-refinements.json');
  if (existsSync(standalone)) {
    try {
      const parsed = JSON.parse(readFileSync(standalone, 'utf8'));
      take(Array.isArray(parsed) ? parsed : parsed.suggestions, path.relative(root, standalone).split(path.sep).join('/'));
    } catch (e) {
      invalid.push({ source: 'evaluation/rubric-refinements.json', error: `not valid JSON: ${e.message}` });
    }
  }
  return { found, invalid };
}

const key = (s) => `${s.type}|${s.item}|${s.suggestion}`;

/** Merge newly found suggestions into state.pendingRefinements (dedupe; ids RS-n are stable). */
export function recordRefinements(state, found, evaluationAt) {
  state.pendingRefinements ??= [];
  state.refinementLog ??= [];
  const seen = new Set([...state.pendingRefinements, ...state.refinementLog].map(key));
  let next = state.pendingRefinements.length + state.refinementLog.length + 1;
  const added = [];
  for (const s of found) {
    if (seen.has(key(s))) continue;
    seen.add(key(s));
    const entry = { id: `RS-${next++}`, ...s, cycle: state.macroCycle?.current ?? 1, at: evaluationAt };
    state.pendingRefinements.push(entry);
    added.push(entry);
  }
  return added;
}

export function rubricFingerprint(root, feature) {
  const p = rubricPath(root, feature);
  return existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16) : null;
}

export function rubricLevels(rubric) {
  return Object.fromEntries(rubric.items.map((i) => [i.id, i.level]));
}

/** Changes that weaken the contract relative to the locked baseline. */
export function looseningChanges(baseline, rubric) {
  if (!baseline) return [];
  const now = rubricLevels(rubric);
  const out = [];
  for (const [id, was] of Object.entries(baseline)) {
    const is = now[id];
    if (!is) {
      if (was === 'essential' || was === 'pitfall') out.push(`${id} (${was}) was removed`);
      continue;
    }
    if (was === 'pitfall' && is !== 'pitfall') out.push(`${id} is no longer a pitfall (now ${is})`);
    else if (LEVEL_RANK[was] && LEVEL_RANK[is] && LEVEL_RANK[is] < LEVEL_RANK[was]) out.push(`${id} downgraded ${was} -> ${is}`);
  }
  return out;
}

/** Validate the planner's answers: every pending suggestion decided; rejections carry a reason. */
export function checkDecisions(pending, decisions) {
  const problems = [];
  if (!Array.isArray(decisions)) return { ok: false, problems: ['replan-decisions.json must be a JSON array of {id, decision, note}'] };
  const byId = new Map(decisions.map((d) => [d.id, d]));
  for (const p of pending) {
    const d = byId.get(p.id);
    if (!d) { problems.push(`${p.id}: no decision recorded`); continue; }
    if (!['accepted', 'rejected'].includes(d.decision)) problems.push(`${p.id}: decision must be accepted|rejected (got "${d.decision}")`);
    if (d.decision === 'rejected' && !String(d.note ?? '').trim()) problems.push(`${p.id}: a rejection needs a reason in "note"`);
  }
  return { ok: problems.length === 0, problems, byId };
}
