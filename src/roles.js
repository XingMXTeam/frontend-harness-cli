import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { featureDir } from './config.js';

/**
 * Role layer: which agent does a dispatched action, and what that agent
 * is allowed to see.
 *
 * The kernel still never calls an LLM. What it does own is the packet —
 * the only input a headless agent step receives — so information
 * isolation is enforced here, by construction, instead of being a
 * sentence in a prompt:
 *
 *   planner    clarify, replan            sees requirements, rubric, evaluation
 *                                         findings and refinement suggestions
 *   developer  implement-task, remediate  sees the task / open items, the plan,
 *                                         vision + standards; NOT rubric.json
 *   evaluator  evaluate, confirm          sees requirements, rubric, vision,
 *                                         e2e cases, evidence targets; NOT the
 *                                         implementer's record (commit SHAs,
 *                                         task notes, developer reports,
 *                                         failure log, history)
 */

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
export const ROLE_TEMPLATES = path.join(TEMPLATES, 'claude-code', 'agents');
export const ROLES = ['planner', 'developer', 'evaluator'];

export const ROLE_BY_ACTION = {
  clarify: 'planner',
  replan: 'planner',
  'implement-task': 'developer',
  remediate: 'developer',
  evaluate: 'evaluator',
  'confirm-evaluation': 'evaluator',
};

export function roleFor(action) {
  return ROLE_BY_ACTION[action] ?? null;
}

/** Role definition body (front matter stripped) — the instruction-level version every host can use. */
export function roleInstructions(role) {
  const file = path.join(ROLE_TEMPLATES, `${role}.md`);
  if (!existsSync(file)) return '';
  return stripFrontMatter(readFileSync(file, 'utf8')).trim();
}

export function stripFrontMatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return text;
  return text.slice(text.indexOf('\n', end + 1) + 1);
}

// Paths under a feature directory the evaluator must never be handed.
export const EVALUATOR_WITHHELD = [
  'state.json (task commit SHAs, attempts, history)',
  'failure-log.md',
  'developer/** (implementer task reports)',
  'tasks.json titles and notes',
];

function readJsonSafe(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function rel(root, p) {
  return path.relative(root, p).split(path.sep).join('/');
}

/**
 * Build the packet for one agent step. Pure with respect to state: the
 * same state yields the same packet, so a killed driver re-dispatches the
 * same work.
 */
export function buildRolePacket(root, state, action, { rubric = null, stepId = null } = {}) {
  const role = roleFor(action.action);
  const fdir = featureDir(root, state.feature);
  const base = {
    feature: state.feature,
    role,
    action: action.action,
    phase: action.phase,
    macroCycle: state.macroCycle?.current ?? 1,
    instruction: action.instruction,
    stepId,
    root,
  };

  if (role === 'developer') {
    return {
      ...base,
      task: action.task ?? null,
      items: action.items ?? null,
      // Open items are named by id + the evaluator's one-line finding; the
      // rubric itself stays out of the developer's context.
      findings: (action.items ?? []).map((id) => findingFor(root, state.feature, id)).filter(Boolean),
      inputs: {
        plan: existing(root, [path.join(fdir, 'tasks.json'), path.join(fdir, 'plan.md'), path.join(fdir, 'dev-plan.md')]),
        vision: existing(root, [path.join(fdir, 'vision.md')]),
        standards: existing(root, [path.join(root, '.harness', 'standards.md')]),
        techDesign: existing(root, [path.join(fdir, 'tech-design.md')]),
      },
      withheld: ['rubric.json (the developer builds from the plan, not to the test)'],
    };
  }

  if (role === 'evaluator') {
    const items = rubric?.items ?? [];
    return {
      ...base,
      // The evaluator produces evidence; the orchestrator (driver or main
      // agent) runs `harness eval`. An evaluator that scored its own
      // evidence would collapse the two roles the verdict depends on.
      instruction: `Evaluate feature "${state.feature}" against its requirements, rubric and vision. For every judge item write {score: 0|0.5|1, note, artifacts: [paths], heuristics: [ids], rubricRefinementSuggestions?: [...]} to its evidence path. Capture screenshots with \`harness capture ${state.feature}\` where an anchor is screenshot-checked. Do NOT run \`harness eval\` — the orchestrator runs it after you return.${action.action === 'confirm-evaluation' ? ' This is the confirmation pass: regenerate every evidence file from scratch; evidence older than the previous evaluation scores 0.' : ''}`,
      requirements: rubric?.requirements ?? [],
      judgeItems: items.filter((i) => i.kind === 'judge').map((i) => ({ id: i.id, requirement: i.requirement ?? null, level: i.level, layer: i.layer ?? null, anchor: i.anchor, evidence: i.evidence })),
      inputs: {
        rubric: rel(root, path.join(fdir, 'rubric.json')),
        vision: existing(root, [path.join(fdir, 'vision.md')]),
        e2eCases: existing(root, [path.join(fdir, 'e2e-cases.json')]),
        pages: existing(root, [path.join(fdir, 'pages.json')]),
        prd: existing(root, [path.join(fdir, 'prd.md')]),
      },
      evidenceDir: rel(root, path.join(fdir, 'evaluation')),
      freshEvidenceRequired: action.action === 'confirm-evaluation',
      withheld: EVALUATOR_WITHHELD,
    };
  }

  if (role === 'planner') {
    const packet = {
      ...base,
      requirements: rubric?.requirements ?? [],
      inputs: {
        rubric: rel(root, path.join(fdir, 'rubric.json')),
        vision: existing(root, [path.join(fdir, 'vision.md')]),
        tasks: existing(root, [path.join(fdir, 'tasks.json')]),
        lastReport: existing(root, [path.join(fdir, 'evaluation', 'report.json')]),
      },
    };
    if (action.action === 'replan') {
      packet.refinements = state.pendingRefinements ?? [];
      packet.openItems = state.remediation ?? [];
      packet.decisionsFile = rel(root, path.join(fdir, 'replan-decisions.json'));
    }
    return packet;
  }

  return { ...base, task: action.task ?? null, items: action.items ?? null };
}

function existing(root, candidates) {
  const hit = candidates.find((p) => existsSync(p));
  return hit ? rel(root, hit) : null;
}

function findingFor(root, feature, id) {
  if (String(id).startsWith('gate:')) return { id, detail: `delivery gate failed at: ${String(id).slice(5)}` };
  const report = readJsonSafe(path.join(featureDir(root, feature), 'evaluation', 'report.json'));
  const r = report?.results?.find((x) => x.id === id);
  // Detail is the observable symptom; pattern/command internals stay out.
  return r ? { id, level: r.level, detail: r.detail } : { id, detail: null };
}

/** Everything a packet must never contain for the evaluator — used by tests and by the driver as a tripwire. */
export function evaluatorLeaks(root, state, packet) {
  const { withheld, ...visible } = packet; // the withheld list names what is absent, it is not a leak
  const text = JSON.stringify(visible);
  const leaks = [];
  for (const t of state.tasks ?? []) {
    if (t.commitSha && text.includes(t.commitSha)) leaks.push(`commit ${t.commitSha}`);
  }
  if (text.includes('failure-log')) leaks.push('failure-log path');
  if (/"history"\s*:/.test(text)) leaks.push('state history');
  const devDir = path.join(featureDir(root, state.feature), 'developer');
  if (existsSync(devDir)) {
    for (const f of readdirSync(devDir)) if (text.includes(f)) leaks.push(`developer/${f}`);
  }
  return leaks;
}
