import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRubric, coverageGaps, e2eCategoryGaps } from './rubric.js';
import { loadVision, visionProblems } from './vision.js';
import { featureDir } from './config.js';
import { record, appendFailureLog } from './state.js';

/**
 * Decide what happens next from state alone. This is the resume core:
 * kill the process at any point, run `harness next`, and you get the same
 * answer a fresh session would have derived — nothing lives in chat memory.
 */
export function nextAction(root, state, config) {
  const base = { feature: state.feature, phase: state.phase, macroCycle: state.macroCycle.current };
  switch (state.phase) {
    case 'clarify': {
      if (!state.clarificationComplete) {
        return { ...base, action: 'clarify', instruction: 'Run the clarify step with the user. Do NOT write formal plan/rubric files as final until the user confirms the summary and open questions are zero. Then write vision.md (REF/ANTI/RL quality anchors) + rubric.json + tasks and run: harness clarify-done ' + state.feature };
      }
      return { ...base, action: 'clarify-done', instruction: 'Clarification is marked complete; run harness clarify-done to re-check rubric coverage.' };
    }
    case 'implement': {
      // Rubric evolution comes first: suggestions the evaluator filed must
      // be answered by the planner before anyone fixes against the rubric.
      if (state.remediation?.length && state.pendingRefinements?.length) {
        return { ...base, action: 'replan', refinements: state.pendingRefinements.map((r) => r.id), items: state.remediation, instruction: `The last evaluation failed and filed ${state.pendingRefinements.length} rubric refinement suggestion(s). Planner: decide each one (accepted | rejected with a reason) in replan-decisions.json, apply the accepted ones to rubric.json (tighten only; loosening needs a human), add tasks for open items that need new work, then run: harness replan-done ${state.feature}` };
      }
      const pending = state.tasks.find((t) => t.status !== 'done');
      if (pending) {
        return { ...base, action: 'implement-task', task: pending, instruction: `Implement task ${pending.id} (${pending.title}). Small loop: implement -> run its checks -> precise git commit -> harness task-done ${state.feature} ${pending.id} --sha <sha>. Do not start the next task before this one is recorded done.` };
      }
      if (state.remediation?.length && !state.remediationFixedAt) {
        return { ...base, action: 'remediate', items: state.remediation, instruction: `Fix ONLY these open evaluation items, commit precisely, then run: harness remediate-done ${state.feature} --sha <sha>. Do not run harness eval yourself — a fresh evaluator judges the fix.` };
      }
      return { ...base, action: 'evaluate', instruction: (state.remediation?.length ? 'The remediation is recorded. ' : 'All tasks are recorded done. ') + 'Dispatch the evaluator (fresh context) to produce judge evidence, then run: harness eval ' + state.feature };
    }
    case 'verify': {
      return { ...base, action: 'confirm-evaluation', instruction: 'A first full pass is recorded. Get a FRESH independent evaluation (new evaluator context; regenerate every judge evidence file — evidence older than the previous evaluation scores 0), then run: harness eval ' + state.feature };
    }
    case 'paused': {
      return { ...base, action: 'human-decision', reason: state.pauseReason ?? 'budget exhausted', instruction: 'The harness paused itself instead of burning more cycles. A human must review the last evaluation report, then either raise budgets in harness.config.json or run: harness resume ' + state.feature };
    }
    case 'done': {
      return { ...base, action: 'none', instruction: 'Feature is done: evaluation passed, delivery gate passed, stable-pass requirement met.' };
    }
    default:
      return { ...base, action: 'unknown', instruction: `Unknown phase ${state.phase}` };
  }
}

export function tryLoadRubric(root, feature) {
  try {
    return loadRubric(root, feature);
  } catch {
    return null;
  }
}

/** Apply an evaluation result to the state machine. Returns a routing summary. */
export function applyEvaluation(root, state, config, evaluation, gateResult) {
  state.remediationFixedAt = null;
  state.lastEvaluation = { at: evaluation.at, verdict: evaluation.verdict, score: evaluation.score, vetoed: evaluation.vetoed };
  const openItems = evaluation.results.filter((r) => r.score < 1).map((r) => r.id);

  if (evaluation.verdict !== 'pass') {
    state.consecutivePasses = 0;
    state.lastFailure = { at: evaluation.at, kind: 'evaluation', vetoed: evaluation.vetoed, openItems };
    appendFailureLog(root, state.feature, `evaluation failed score=${evaluation.score} vetoed=${evaluation.vetoed.map((v) => v.id).join(',') || 'none'} open=${openItems.join(',')}`);
    if (state.macroCycle.current >= (state.macroCycle.max ?? config.budgets.maxMacroCycles)) {
      state.phase = 'paused';
      state.pauseReason = `macro cycle budget exhausted (${state.macroCycle.current} cycles) with evaluation still failing`;
      record(state, { event: 'paused', reason: state.pauseReason });
      return { routed: 'paused', reason: state.pauseReason };
    }
    state.macroCycle.current += 1;
    state.phase = 'implement';
    state.remediation = openItems;
    record(state, { event: 'evaluation-failed', score: evaluation.score, vetoed: evaluation.vetoed, nextMacroCycle: state.macroCycle.current });
    const replan = Boolean(state.pendingRefinements?.length);
    return { routed: replan ? 'replan' : 'remediate', openItems, macroCycle: state.macroCycle.current, ...(replan ? { reason: 'the planner answers the rubric refinement suggestions before the developer fixes the open items' } : {}) };
  }

  // Pass path.
  state.remediation = [];
  state.consecutivePasses += 1;
  record(state, { event: 'evaluation-passed', score: evaluation.score, consecutivePasses: state.consecutivePasses, phaseAtEval: state.phase });

  const needed = config.autoStop.requiredStablePasses;
  if (state.phase !== 'verify' && state.consecutivePasses < needed) {
    state.phase = 'verify';
    return { routed: 'verify', reason: `needs ${needed} stable passes, has ${state.consecutivePasses}; a fresh confirmation evaluation is required` };
  }

  if (!gateResult.passed) {
    state.consecutivePasses = 0;
    state.lastFailure = { at: Date.now(), kind: 'gate', failedAt: gateResult.failedAt };
    appendFailureLog(root, state.feature, `delivery gate failed at: ${gateResult.failedAt}`);
    state.phase = 'implement';
    state.remediation = ['gate:' + gateResult.failedAt];
    record(state, { event: 'gate-failed', failedAt: gateResult.failedAt });
    return { routed: 'remediate', openItems: state.remediation, reason: 'delivery gate failed' };
  }

  state.phase = 'done';
  record(state, { event: 'done', score: evaluation.score });
  return { routed: 'done' };
}

export function checkCoverage(root, state) {
  const rubric = tryLoadRubric(root, state.feature);
  if (!rubric) return { ok: false, gaps: [{ requirement: '*', problem: 'rubric.json missing or invalid' }] };
  const gaps = coverageGaps(rubric);

  // Quality anchoring: vision.md must exist and be structurally sound,
  // judge items must cite anchors that exist, and every requirement needs
  // a quality (judge) item — or an explicit, reasoned waiver. "We didn't
  // think about quality for this one" must be said out loud, in writing.
  const vision = loadVision(root, state.feature);
  if (!vision) {
    gaps.push({ requirement: '*', problem: 'vision.md missing — quality anchors (REF/ANTI/RL) are written during clarify, before code' });
  } else {
    for (const p of visionProblems(vision)) gaps.push({ requirement: '*', problem: p });
    for (const it of rubric.items) {
      if (it.kind === 'judge' && it.anchor && !vision.has(it.anchor)) {
        gaps.push({ requirement: it.requirement ?? '*', problem: `item ${it.id}: cites vision anchor ${it.anchor}, which does not exist in vision.md` });
      }
    }
    const waivers = new Set((rubric.qualityWaivers ?? []).map((w) => w.requirement));
    for (const req of rubric.requirements) {
      const hasQuality = rubric.items.some((i) => i.requirement === req.id && i.kind === 'judge');
      if (!hasQuality && !waivers.has(req.id)) {
        gaps.push({ requirement: req.id, problem: 'no judge (quality) item maps to this requirement and no qualityWaivers entry excuses it — add an anchored judge item or a reasoned waiver' });
      }
    }
  }

  // E2E category quotas (only when the rubric declares them).
  if (rubric.e2eCategories) {
    const casesFile = path.join(featureDir(root, state.feature), 'e2e-cases.json');
    let cases = null;
    if (existsSync(casesFile)) { try { cases = JSON.parse(readFileSync(casesFile, 'utf8')); } catch { cases = null; } }
    gaps.push(...e2eCategoryGaps(rubric, cases));
  }

  // UI journeys must visit pages the capture step will screenshot.
  const casesPath = path.join(featureDir(root, state.feature), 'e2e-cases.json');
  const pagesPath = path.join(featureDir(root, state.feature), 'pages.json');
  if (existsSync(casesPath) && existsSync(pagesPath)) {
    let cases = null;
    let pages = null;
    try { cases = JSON.parse(readFileSync(casesPath, 'utf8')); } catch { /* reported above when quotas are declared */ }
    try { const raw = JSON.parse(readFileSync(pagesPath, 'utf8')); pages = Array.isArray(raw) ? raw : raw.pages; } catch { gaps.push({ requirement: '*', problem: 'pages.json is not valid JSON' }); }
    if (Array.isArray(cases) && Array.isArray(pages)) {
      const pathname = (r) => String(r ?? '').split(/[?#]/)[0];
      const known = new Set(pages.map((p) => pathname(p.route)));
      for (const c of cases) {
        if (c.category === 'uiJourney' && c.route && !known.has(pathname(c.route))) {
          gaps.push({ requirement: c.mapsTo ?? '*', problem: `e2e case ${c.id}: uiJourney route ${c.route} is not in pages.json — evidence capture would never screenshot it` });
        }
      }
    }
  }

  return { ok: gaps.length === 0, gaps, rubric };
}

/**
 * The fixed verdict -> next-step table. Every host reads the same table
 * (hook context, protocol skill, docs/orchestration.md); nobody improvises
 * a different route, and nobody stops at a summary between two rows.
 */
export const VERDICT_ROUTES = [
  { when: 'eval pass, stable passes still needed', phase: 'verify', next: 'confirm-evaluation', who: 'evaluator (fresh context)' },
  { when: 'eval pass, stable passes met, delivery gate green', phase: 'done', next: 'none', who: 'report to the user' },
  { when: 'eval pass, delivery gate red', phase: 'implement', next: 'remediate', who: 'developer' },
  { when: 'eval fail (veto or below passScore), refinement suggestions filed', phase: 'implement', next: 'replan', who: 'planner' },
  { when: 'eval fail (veto or below passScore), no suggestions', phase: 'implement', next: 'remediate', who: 'developer' },
  { when: 'eval fail, macro-cycle budget exhausted', phase: 'paused', next: 'human-decision', who: 'the user' },
];
