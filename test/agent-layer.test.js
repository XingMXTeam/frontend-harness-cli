import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRolePacket, evaluatorLeaks, roleFor, roleInstructions } from '../src/roles.js';
import { buildPrompt } from '../src/run.js';
import { validateRubric, coverageGaps } from '../src/rubric.js';
import { weightedScore } from '../src/evaluate.js';
import { looseningChanges, checkDecisions, normalizeSuggestion } from '../src/refine.js';
import { normalizePages, checkPng, comparePages } from '../src/evidence.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'harness.js');
const FAKE = path.join(HERE, 'fixtures', 'fake-agent.mjs');
const FAKE_PW = path.join(HERE, 'fixtures', 'fake-playwright.mjs');

function run(cwd, args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HARNESS_BIN: BIN, HARNESS_ROLE: '', ...env } });
}
const fdirOf = (dir, f = 'feat') => path.join(dir, '.harness', 'tasks', f);
const readState = (dir, f = 'feat') => JSON.parse(readFileSync(path.join(fdirOf(dir, f), 'state.json'), 'utf8'));
const writeJson = (file, v) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(v, null, 2)); };

const VISION = 'REF-1: list rows read like the reference inbox.\nANTI-1: placeholder text presented as content.\nRL-1: no stub wording ships. (check: command)\nRL-2: no clipped titles at 1280px. (check: screenshot)\n';

/**
 * A clarified project whose rubric has one judge item (anchored on REF-1)
 * plus deterministic items. Returns the project dir.
 */
function judgedProject({ stable = 2, rubricExtra = {}, items = null, tasks = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-agent-'));
  assert.equal(run(dir, ['init', '--stack', 'node', '--host', 'generic']).status, 0);
  const cfgFile = path.join(dir, 'harness.config.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  cfg.autoStop = { requiredStablePasses: stable };
  cfg.gateCommands = ['node -e "process.exit(0)"'];
  writeJson(cfgFile, cfg);
  assert.equal(run(dir, ['new', 'feat']).status, 0);
  const fdir = fdirOf(dir);
  writeFileSync(path.join(fdir, 'vision.md'), VISION);
  writeJson(path.join(fdir, 'tasks.json'), tasks ?? [
    { id: 'TASK-1', title: 'write it', requirements: ['REQ-1'], checks: ['node -e "require(\'fs\').writeFileSync(\'out.txt\',\'real implementation\')"'] },
  ]);
  writeJson(path.join(fdir, 'rubric.json'), {
    version: 1, feature: 'feat',
    requirements: [{ id: 'REQ-1', description: 'a real deliverable' }],
    items: items ?? [
      { id: 'RB-1', requirement: 'REQ-1', level: 'essential', kind: 'file', path: 'out.txt', minBytes: 5, weight: 2 },
      { id: 'RB-2', requirement: 'REQ-1', level: 'pitfall', kind: 'grep', path: 'out.txt', pattern: 'stub', expect: 'absent' },
      { id: 'RB-3', requirement: 'REQ-1', level: 'important', kind: 'judge', anchor: 'REF-1', evidence: '.harness/tasks/feat/evaluation/judge-rb-3.json', weight: 1 },
    ],
    ...rubricExtra,
  });
  const r = run(dir, ['clarify-done', 'feat']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return dir;
}
const evidence = (dir, v) => writeJson(path.join(fdirOf(dir), 'evaluation', 'judge-rb-3.json'), v);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ─── skills, roles, init ─────────────────────────────────────────────────────

test('init (claude-code) installs the three role agents and the shared docs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-agent-init-'));
  const r = run(dir, ['init', '--stack', 'react', '--host', 'claude-code']);
  assert.equal(r.status, 0, r.stderr);
  for (const role of ['planner', 'developer', 'evaluator']) {
    const text = readFileSync(path.join(dir, '.claude', 'agents', `${role}.md`), 'utf8');
    assert.match(text, new RegExp(`^---\\nname: ${role}\\n`), role);
    assert.match(text, /## Hard boundaries/);
    assert.match(text, /## Handoff/);
  }
  for (const doc of ['orchestration.md', 'evaluation-rubric-standard.md', 'evaluation-heuristics.md']) {
    assert.ok(existsSync(path.join(dir, '.harness', 'docs', doc)), doc);
  }
  assert.match(readFileSync(path.join(dir, '.harness', 'standards.md'), 'utf8'), /React/);
  for (const s of ['clarify-requirements', 'write-acceptance-criteria', 'e2e-testing', 'implement-task']) {
    assert.ok(existsSync(path.join(dir, '.claude', 'skills', s, 'SKILL.md')), s);
  }
});

test('init (codex/generic) gets instruction-level role files and the protocol, without host front matter', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-agent-init-'));
  assert.equal(run(dir, ['init', '--stack', 'vue', '--host', 'codex']).status, 0);
  for (const role of ['planner', 'developer', 'evaluator']) {
    const text = readFileSync(path.join(dir, '.harness', 'agents', `${role}.md`), 'utf8');
    assert.ok(!text.startsWith('---'), `${role} has no front matter`);
    assert.match(text, /## Hard boundaries/);
  }
  assert.match(readFileSync(path.join(dir, '.harness', 'protocol.md'), 'utf8'), /Never stop at a summary/);
  assert.match(readFileSync(path.join(dir, '.harness', 'host-setup.md'), 'utf8'), /harness packet/);
});

test('protocol and hook carry the verdict map, the no-stop rule, and the never-decide-for-the-user rule', () => {
  const skill = readFileSync(path.join(HERE, '..', 'templates', 'claude-code', 'SKILL.md'), 'utf8');
  assert.match(skill, /Never stop at a summary/);
  assert.match(skill, /never decide for the user/i);
  assert.match(skill, /fail \+ refinement suggestions \| replan, then remediate/);
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-hook-'));
  writeJson(path.join(dir, '.harness', 'tasks', 'a', 'state.json'), { phase: 'implement' });
  const hook = spawnSync('bash', [path.join(HERE, '..', 'templates', 'claude-code', 'session-start.sh')], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  assert.equal(hook.status, 0, hook.stderr);
  const ctx = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Never stop at a summary/);
  assert.match(ctx, /never decide for the user/i);
  assert.match(ctx, /fail \+ refinement suggestions -> replan then remediate/);
  assert.match(ctx, /harness next a/);
});

test('roles: actions map to roles and the headless prompt carries that role definition', () => {
  assert.equal(roleFor('clarify'), 'planner');
  assert.equal(roleFor('replan'), 'planner');
  assert.equal(roleFor('implement-task'), 'developer');
  assert.equal(roleFor('remediate'), 'developer');
  assert.equal(roleFor('evaluate'), 'evaluator');
  assert.equal(roleFor('confirm-evaluation'), 'evaluator');
  assert.ok(!roleInstructions('developer').startsWith('---'));
  const dev = buildPrompt({ role: 'developer', action: 'implement-task', feature: 'f' });
  assert.match(dev, /You are the developer agent/);
  assert.match(dev, /# Developer/);
  const ev = buildPrompt({ role: 'evaluator', action: 'evaluate', feature: 'f' });
  assert.match(ev, /# Evaluator/);
  assert.doesNotMatch(ev, /# Developer/);
});

test('isolation: the evaluator packet carries no implementer record; the developer packet carries no rubric', () => {
  const dir = judgedProject();
  run(dir, ['task-done', 'feat', 'TASK-1', '--sha', 'cafe1234']); // not a git repo: SHA is recorded as given
  const fdir = fdirOf(dir);
  writeFileSync(path.join(fdir, 'failure-log.md'), '- implementer struggled with X\n');
  mkdirSync(path.join(fdir, 'developer'), { recursive: true });
  writeFileSync(path.join(fdir, 'developer', 'TASK-1-report.md'), 'I chose approach Y because ...');
  const state = readState(dir);
  state.tasks[0].commitSha = 'cafe1234';
  const rubric = JSON.parse(readFileSync(path.join(fdir, 'rubric.json'), 'utf8'));
  const evPacket = buildRolePacket(dir, state, { action: 'evaluate', phase: 'implement', instruction: 'x' }, { rubric });
  assert.equal(evPacket.role, 'evaluator');
  assert.deepEqual(evaluatorLeaks(dir, state, evPacket), []);
  const text = JSON.stringify({ ...evPacket, withheld: undefined });
  assert.ok(!text.includes('cafe1234'));
  assert.ok(!text.includes('TASK-1-report'));
  assert.ok(!text.includes('failure-log'));
  assert.deepEqual(evPacket.judgeItems.map((j) => j.id), ['RB-3']);
  assert.match(evPacket.instruction, /Do NOT run `harness eval`/);
  // the tripwire really trips
  assert.ok(evaluatorLeaks(dir, state, { ...evPacket, extra: 'cafe1234 developer/TASK-1-report.md' }).length >= 2);

  const devPacket = buildRolePacket(dir, state, { action: 'remediate', phase: 'implement', items: ['RB-1'], instruction: 'x' }, { rubric });
  assert.equal(devPacket.role, 'developer');
  assert.ok(!JSON.stringify(devPacket.inputs).includes('rubric'));
  assert.equal(devPacket.requirements, undefined);
  assert.ok(devPacket.withheld.some((w) => w.includes('rubric.json')));
});

test('harness packet prints the role-scoped packet for the next step', () => {
  const dir = judgedProject();
  const r = run(dir, ['packet', 'feat', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.role, 'developer');
  assert.equal(p.action, 'implement-task');
  assert.equal(p.task.id, 'TASK-1');
});

test('role guard: kernel commands refuse to run inside the wrong role', () => {
  const dir = judgedProject();
  const asEval = run(dir, ['task-done', 'feat', 'TASK-1'], { HARNESS_ROLE: 'evaluator' });
  assert.equal(asEval.status, 1);
  assert.match(asEval.stderr, /not available to the evaluator role/);
  assert.equal(run(dir, ['task-done', 'feat', 'TASK-1'], { HARNESS_ROLE: 'developer' }).status, 0);
  const devEval = run(dir, ['eval', 'feat'], { HARNESS_ROLE: 'developer' });
  assert.equal(devEval.status, 1);
  assert.match(devEval.stderr, /orchestrator only/);
  const evalEval = run(dir, ['eval', 'feat'], { HARNESS_ROLE: 'evaluator' });
  assert.equal(evalEval.status, 1);
});

// ─── judge evidence: freshness, artifacts, screenshots ───────────────────────

test('freshness: the confirmation pass cannot reuse the first pass evidence', () => {
  const dir = judgedProject({ stable: 2 });
  assert.equal(run(dir, ['task-done', 'feat', 'TASK-1']).status, 0);
  sleep(5);
  evidence(dir, { score: 1, note: 'first pass' });
  const first = JSON.parse(run(dir, ['eval', 'feat', '--json']).stdout);
  assert.equal(first.evaluation.verdict, 'pass');
  assert.equal(first.routing.next, 'confirm-evaluation');
  assert.equal(readState(dir).phase, 'verify');

  const stale = JSON.parse(run(dir, ['eval', 'feat', '--json']).stdout);
  const rb3 = stale.evaluation.results.find((r) => r.id === 'RB-3');
  assert.equal(rb3.score, 0);
  assert.match(rb3.detail, /stale judge evidence/);
  assert.notEqual(readState(dir).phase, 'done');
});

test('freshness: evidence written before the task finished is stale', () => {
  const dir = judgedProject({ stable: 1 });
  evidence(dir, { score: 1, note: 'written too early' });
  const past = new Date(Date.now() - 60_000);
  utimesSync(path.join(fdirOf(dir), 'evaluation', 'judge-rb-3.json'), past, past);
  run(dir, ['task-done', 'feat', 'TASK-1']);
  const out = JSON.parse(run(dir, ['eval', 'feat', '--json']).stdout);
  assert.match(out.evaluation.results.find((r) => r.id === 'RB-3').detail, /stale/);
});

test('artifacts: a judge note citing a missing artifact scores 0; a screenshot red line needs a real PNG', () => {
  const dir = judgedProject({
    stable: 1,
    items: [
      { id: 'RB-1', requirement: 'REQ-1', level: 'essential', kind: 'file', path: 'out.txt', minBytes: 5, weight: 2 },
      { id: 'RB-3', requirement: 'REQ-1', level: 'important', kind: 'judge', anchor: 'RL-2', evidence: '.harness/tasks/feat/evaluation/judge-rb-3.json', weight: 1 },
    ],
  });
  run(dir, ['task-done', 'feat', 'TASK-1']);
  sleep(5);
  evidence(dir, { score: 1, note: 'looked fine', artifacts: ['nope.png'] });
  let out = JSON.parse(run(dir, ['eval', 'feat', '--json']).stdout);
  assert.match(out.evaluation.results.find((r) => r.id === 'RB-3').detail, /missing artifact/);

  sleep(5);
  evidence(dir, { score: 1, note: 'no screenshot at all' });
  out = JSON.parse(run(dir, ['eval', 'feat', '--json']).stdout);
  assert.match(out.evaluation.results.find((r) => r.id === 'RB-3').detail, /screenshot-checked red line/);

  const png = path.join(dir, 'shot.png');
  writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4000)]));
  sleep(5);
  evidence(dir, { score: 1, note: 'checked at 1280px', artifacts: ['shot.png'] });
  out = JSON.parse(run(dir, ['eval', 'feat', '--json']).stdout);
  assert.equal(out.evaluation.results.find((r) => r.id === 'RB-3').score, 1);
});

// ─── layered scoring ─────────────────────────────────────────────────────────

test('layers: L1–L4 weights 0.40/0.25/0.20/0.15 with level default weights', () => {
  const rubric = validateRubric({
    requirements: [{ id: 'R', description: 'd' }],
    layerWeights: true,
    items: [
      { id: 'A', requirement: 'R', layer: 'L1-function', level: 'essential', kind: 'file', path: 'x' },
      { id: 'B', requirement: 'R', layer: 'L1', level: 'optional', kind: 'file', path: 'x' },
      { id: 'C', requirement: 'R', layer: 'L3', level: 'important', kind: 'file', path: 'x' },
      { id: 'P', requirement: 'R', layer: 'L2', level: 'pitfall', kind: 'file', path: 'x' },
    ],
  });
  assert.deepEqual(rubric.layerWeights, { L1: 0.4, L2: 0.25, L3: 0.2, L4: 0.15 });
  assert.equal(rubric.items.find((i) => i.id === 'B').weight, 0.3);
  const results = [
    { item: rubric.items[0], score: 1 },
    { item: rubric.items[1], score: 0 },
    { item: rubric.items[2], score: 0.5 },
    { item: rubric.items[3], score: 1 },
  ];
  const { score, layers } = weightedScore(rubric, results);
  // L1 = 1/1.3 = 0.769, L3 = 0.5; total = (0.769*0.4 + 0.5*0.2) / 0.6
  assert.equal(layers.L1.score, 0.769);
  assert.equal(layers.L3.score, 0.5);
  assert.equal(score, Math.round(((1 / 1.3) * 0.4 + 0.5 * 0.2) / 0.6 * 1000) / 1000);
  assert.throws(() => validateRubric({ requirements: [{ id: 'R', description: 'd' }], layerWeights: true, items: [{ id: 'A', requirement: 'R', level: 'essential', kind: 'file', path: 'x' }] }), /needs layer/);
});

test('layers: per-layer quotas are enforced unless the layer is declared N/A with a reason', () => {
  const base = {
    requirements: [{ id: 'R', description: 'd' }],
    layerWeights: { L1: 0.4, L3: 0.2 },
    policy: { minEssentialPerLayer: 1, minPitfallsPerLayer: 1 },
    items: [
      { id: 'A', requirement: 'R', layer: 'L1', level: 'essential', kind: 'file', path: 'x' },
      { id: 'P', requirement: 'R', layer: 'L1', level: 'pitfall', kind: 'file', path: 'x' },
    ],
  };
  const gaps = coverageGaps(validateRubric(structuredClone(base)));
  assert.ok(gaps.some((g) => g.problem.startsWith('layer L3: 0/1 essential')), JSON.stringify(gaps));
  const excused = structuredClone(base);
  excused.policy.layerNA = { L3: 'API-only feature, no screens' };
  assert.deepEqual(coverageGaps(validateRubric(excused)), []);
});

// ─── rubric evolution ────────────────────────────────────────────────────────

test('refinement: suggestions are recorded, route a failed eval to replan, and must each be answered', () => {
  const dir = judgedProject({ stable: 2 });
  run(dir, ['task-done', 'feat', 'TASK-1']);
  sleep(5);
  evidence(dir, {
    score: 0, note: 'rows clip',
    rubricRefinementSuggestions: [
      { type: 'refine', item: 'RB-3', problem: 'no width', suggestion: 'no clipped titles at 375 and 1280 px' },
      { type: 'add', item: 'NEW', layer: 'L2', level: 'pitfall', suggestion: 'double submit creates two rows' },
      { type: 'bogus', item: 'RB-3', suggestion: 'x' },
    ],
  });
  const r = run(dir, ['eval', 'feat', '--json']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.evaluation.verdict, 'fail');
  assert.deepEqual(out.evaluation.refinementSuggestions.added, ['RS-1', 'RS-2']);
  assert.equal(out.evaluation.refinementSuggestions.invalid.length, 1);
  assert.equal(out.routing.next, 'replan');
  let s = readState(dir);
  assert.equal(s.pendingRefinements.length, 2);
  assert.ok(s.history.some((h) => h.event === 'rubric-refinements-recorded'));

  // The planner's packet carries the suggestions; eval refuses until they are answered.
  const pkt = JSON.parse(run(dir, ['packet', 'feat', '--json']).stdout);
  assert.equal(pkt.role, 'planner');
  assert.deepEqual(pkt.refinements.map((x) => x.id), ['RS-1', 'RS-2']);
  assert.match(run(dir, ['eval', 'feat']).stderr, /unanswered/);

  // No decisions file -> refused. A rejection without a reason -> refused.
  assert.match(run(dir, ['replan-done', 'feat']).stderr, /replan-decisions\.json/);
  const dfile = path.join(fdirOf(dir), 'replan-decisions.json');
  writeJson(dfile, [{ id: 'RS-1', decision: 'accepted' }, { id: 'RS-2', decision: 'rejected' }]);
  assert.match(run(dir, ['replan-done', 'feat']).stderr, /RS-2: a rejection needs a reason/);
  // Accepted but nothing changed -> refused.
  writeJson(dfile, [{ id: 'RS-1', decision: 'accepted' }, { id: 'RS-2', decision: 'rejected', note: 'covered by RB-2 already' }]);
  assert.match(run(dir, ['replan-done', 'feat']).stderr, /unchanged/);

  // Apply RS-1 (tighten RB-3 to essential) and add a task -> accepted.
  const rfile = path.join(fdirOf(dir), 'rubric.json');
  const rubric = JSON.parse(readFileSync(rfile, 'utf8'));
  rubric.items.find((i) => i.id === 'RB-3').level = 'essential';
  writeJson(rfile, rubric);
  const tfile = path.join(fdirOf(dir), 'tasks.json');
  writeJson(tfile, [...JSON.parse(readFileSync(tfile, 'utf8')), { id: 'TASK-2', title: 'wrap long titles', requirements: ['REQ-1'], checks: [] }]);
  const ok = run(dir, ['replan-done', 'feat']);
  assert.equal(ok.status, 0, ok.stderr);
  s = readState(dir);
  assert.deepEqual(s.pendingRefinements, []);
  assert.deepEqual(s.refinementLog.map((x) => `${x.id}:${x.decision}`), ['RS-1:accepted', 'RS-2:rejected']);
  assert.equal(s.tasks.find((t) => t.id === 'TASK-2').status, 'pending');
  assert.equal(JSON.parse(run(dir, ['next', 'feat', '--json']).stdout).action, 'implement-task');
  assert.match(run(dir, ['report', 'feat']).stdout, /RS-1 \[refine\] RB-3/);
});

test('refinement: a replan that loosens the locked rubric needs a human', () => {
  const dir = judgedProject({ stable: 2 });
  run(dir, ['task-done', 'feat', 'TASK-1']);
  sleep(5);
  evidence(dir, { score: 0, note: 'bad', rubricRefinementSuggestions: [{ type: 'regrade', item: 'RB-2', suggestion: 'make it optional' }] });
  run(dir, ['eval', 'feat']);
  const rfile = path.join(fdirOf(dir), 'rubric.json');
  const rubric = JSON.parse(readFileSync(rfile, 'utf8'));
  rubric.items = rubric.items.filter((i) => i.id !== 'RB-2'); // drop the pitfall
  writeJson(rfile, rubric);
  writeJson(path.join(fdirOf(dir), 'replan-decisions.json'), [{ id: 'RS-1', decision: 'accepted', note: 'pitfall was noise' }]);
  const blocked = run(dir, ['replan-done', 'feat']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /RB-2 \(pitfall\) was removed/);
  assert.equal(run(dir, ['replan-done', 'feat'], { GATE_HUMAN_CONFIRM: 'yes' }).status, 0);
  assert.ok(readState(dir).history.some((h) => h.event === 'replanned' && h.loosenedWithHuman));
});

test('refinement units: loosening detection, decision checks, suggestion validation', () => {
  const rub = (items) => ({ items });
  assert.deepEqual(looseningChanges({ A: 'essential', B: 'important' }, rub([{ id: 'A', level: 'essential' }, { id: 'B', level: 'essential' }, { id: 'C', level: 'optional' }])), []);
  assert.deepEqual(looseningChanges({ A: 'essential', B: 'important' }, rub([{ id: 'A', level: 'important' }, { id: 'B', level: 'optional' }])), ['A downgraded essential -> important', 'B downgraded important -> optional']);
  assert.deepEqual(looseningChanges({ P: 'pitfall' }, rub([{ id: 'P', level: 'optional' }])), ['P is no longer a pitfall (now optional)']);
  assert.equal(checkDecisions([{ id: 'RS-1' }], [{ id: 'RS-1', decision: 'maybe' }]).ok, false);
  assert.ok(normalizeSuggestion({ type: 'add', item: 'NEW', suggestion: 'x' }, 's').type);
  assert.ok(normalizeSuggestion({ type: 'add', item: '', suggestion: 'x' }, 's').error);
});

// ─── remediation goes back through a fresh evaluator ─────────────────────────

test('remediate-done records the fix and hands the next step to the evaluator', () => {
  const dir = judgedProject({ stable: 2 });
  run(dir, ['task-done', 'feat', 'TASK-1']);
  sleep(5);
  evidence(dir, { score: 0, note: 'not like REF-1' });
  run(dir, ['eval', 'feat']);
  assert.equal(JSON.parse(run(dir, ['next', 'feat', '--json']).stdout).action, 'remediate');
  assert.match(run(dir, ['remediate-done', 'feat'], { HARNESS_ROLE: 'planner' }).stderr, /not available to the planner/);
  assert.equal(run(dir, ['remediate-done', 'feat']).status, 0);
  const next = JSON.parse(run(dir, ['next', 'feat', '--json']).stdout);
  assert.equal(next.action, 'evaluate');
  assert.match(next.instruction, /evaluator/);
  // stale evidence from before the fix no longer counts
  const out = JSON.parse(run(dir, ['eval', 'feat', '--json']).stdout);
  assert.match(out.evaluation.results.find((r) => r.id === 'RB-3').detail, /stale/);
});

// ─── the driver dispatches roles ─────────────────────────────────────────────

test('run: judge items make the driver dispatch an evaluator before each eval, to done', () => {
  const dir = judgedProject({ stable: 2 });
  const log = path.join(dir, 'agent.log');
  const packets = path.join(dir, 'packets.jsonl');
  const r = run(dir, ['run', 'feat', '--agent-cmd', `node ${FAKE} {prompt}`, '--json'], { FAKE_AGENT_LOG: log, FAKE_AGENT_LOG_ROLE: '1', FAKE_AGENT_PACKETS: packets });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).status, 'done');
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['implement-task:developer', 'evaluate:evaluator', 'confirm-evaluation:evaluator']);
  const sent = readFileSync(packets, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  for (const p of sent.filter((x) => x.role === 'evaluator')) {
    assert.ok(!JSON.stringify(p).includes('"commitSha"'));
    assert.deepEqual(p.judgeItems.map((j) => j.id), ['RB-3']);
  }
  assert.equal(sent.find((p) => p.role === 'developer').inputs.rubric, undefined);
});

test('run: a failing evaluation with suggestions goes planner -> developer -> evaluator', () => {
  const dir = judgedProject({ stable: 1 });
  const log = path.join(dir, 'agent.log');
  // Every evaluation scores the judge 0 and files the same suggestion; the
  // fake planner rejects it (with a reason). The loop must route through
  // replan once, then remediate, and pause on budget rather than spin.
  const cfgFile = path.join(dir, 'harness.config.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  cfg.budgets.maxMacroCycles = 2;
  writeJson(cfgFile, cfg);
  const st = readState(dir);
  st.macroCycle.max = 2;
  writeJson(path.join(fdirOf(dir), 'state.json'), st);
  const r = run(dir, ['run', 'feat', '--agent-cmd', `node ${FAKE} {prompt}`, '--json'], { FAKE_AGENT_LOG: log, FAKE_AGENT_LOG_ROLE: '1', FAKE_EVIDENCE_SCORE: '0', FAKE_SUGGEST: 'state the viewport' });
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.status, 'paused', r.stdout);
  const steps = readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(steps, ['implement-task:developer', 'evaluate:evaluator', 'replan:planner', 'remediate:developer', 'evaluate:evaluator']);
  assert.equal(readState(dir).refinementLog[0].decision, 'rejected');
});

// ─── evidence capture + visual diff ──────────────────────────────────────────

function captureProject(pages) {
  const dir = judgedProject();
  writeJson(path.join(fdirOf(dir), 'pages.json'), { baseUrl: 'http://127.0.0.1:9', pages });
  return dir;
}

test('capture: missing Playwright is a clear install instruction, not a stack trace', () => {
  const dir = captureProject([{ name: 'home', route: '/' }]);
  const r = run(dir, ['capture', 'feat', '--skip-probe']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /playwright is not installed in this project/);
  assert.match(r.stderr, /npm i -D playwright/);
  assert.doesNotMatch(r.stderr, /at .*\.js:\d+/);
});

test('capture: real PNGs pass; blank, non-PNG and failed pages fail; placeholders only with --allow-fallback', () => {
  const dir = captureProject([{ name: 'home', route: '/' }, { name: 'list', route: '/list' }]);
  const env = { HARNESS_PLAYWRIGHT_MODULE: FAKE_PW };
  const ok = run(dir, ['capture', 'feat', '--skip-probe', '--run-id', 'r1', '--json'], env);
  assert.equal(ok.status, 0, ok.stderr);
  const m = JSON.parse(ok.stdout);
  assert.equal(m.status, 'pass');
  assert.deepEqual(m.pages.map((p) => p.ok), [true, true]);
  assert.ok(existsSync(path.join(fdirOf(dir), 'evidence', 'r1', 'home.png')));
  assert.equal(JSON.parse(readFileSync(path.join(fdirOf(dir), 'evidence', 'latest.json'), 'utf8')).runId, 'r1');

  writeJson(path.join(fdirOf(dir), 'pages.json'), { baseUrl: 'http://127.0.0.1:9', pages: [{ name: 'blank', route: '/blank' }, { name: 'html', route: '/html' }, { name: 'boom', route: '/boom' }] });
  const bad = run(dir, ['capture', 'feat', '--skip-probe', '--run-id', 'r2', '--json'], env);
  assert.equal(bad.status, 1);
  const bm = JSON.parse(bad.stdout);
  assert.equal(bm.status, 'fail');
  assert.match(bm.pages[0].error, /< 2048B/);
  assert.match(bm.pages[1].error, /not a PNG/);
  assert.match(bm.pages[2].error, /ERR_CONNECTION_REFUSED/);
  assert.ok(bm.pages.every((p) => !p.usedFallback));

  const fb = run(dir, ['capture', 'feat', '--skip-probe', '--run-id', 'r3', '--allow-fallback', '--json'], env);
  assert.equal(fb.status, 0);
  const fm = JSON.parse(fb.stdout);
  assert.equal(fm.status, 'fallback');
  assert.match(fm.note, /NOT evidence/);
  assert.ok(fm.pages.every((p) => p.usedFallback));
});

test('capture: pages.json is validated before any browser work', () => {
  assert.throws(() => normalizePages({ pages: [] }), /non-empty/);
  assert.throws(() => normalizePages({ pages: [{ name: 'a', route: 'x' }] }), /must start with "\/"/);
  assert.throws(() => normalizePages({ pages: [{ name: 'a', route: '/' }, { name: 'a', route: '/b' }] }), /duplicate page name/);
  assert.equal(normalizePages([{ name: 'a', route: '/' }]).pages[0].output, 'a.png');
  const dir = judgedProject();
  const r = run(dir, ['capture', 'feat', '--skip-probe'], { HARNESS_PLAYWRIGHT_MODULE: FAKE_PW });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No pages config/);
});

test('checkPng: size and signature gate', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-png-'));
  const f = path.join(dir, 'a.png');
  writeFileSync(f, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100)]));
  assert.match(checkPng(f, 2048).reason, /did not render/);
  writeFileSync(f, Buffer.alloc(5000));
  assert.match(checkPng(f, 2048).reason, /not a PNG/);
  assert.match(checkPng(path.join(dir, 'none.png')).reason, /not written/);
});

test('visual: no baseline is reported as no-baseline (exit 2), never as a pass — and needs no diff library', () => {
  const dir = captureProject([{ name: 'home', route: '/' }]);
  assert.equal(run(dir, ['capture', 'feat', '--skip-probe', '--run-id', 'r1'], { HARNESS_PLAYWRIGHT_MODULE: FAKE_PW }).status, 0);
  const r = run(dir, ['visual', 'feat', '--json']);
  assert.equal(r.status, 2, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'no-baseline');
  assert.deepEqual(out.noBaseline, ['home']);
  assert.ok(existsSync(path.join(fdirOf(dir), 'evidence', 'r1', 'comparison.json')));

  // A fallback run can neither be compared nor become a baseline.
  writeJson(path.join(fdirOf(dir), 'pages.json'), { baseUrl: 'http://127.0.0.1:9', pages: [{ name: 'home', route: '/blank' }] });
  run(dir, ['capture', 'feat', '--skip-probe', '--run-id', 'r2', '--allow-fallback'], { HARNESS_PLAYWRIGHT_MODULE: FAKE_PW });
  assert.match(run(dir, ['visual', 'feat']).stderr, /not evidence/);
  assert.match(run(dir, ['visual', 'feat', '--update-baseline']).stderr, /only a clean capture/);
  // Adopting the clean run is explicit and recorded.
  const adopt = run(dir, ['visual', 'feat', '--run-id', 'r1', '--update-baseline', '--json']);
  assert.equal(adopt.status, 0, adopt.stderr);
  assert.ok(existsSync(path.join(dir, '.harness', 'baselines', 'home.png')));
  assert.equal(JSON.parse(readFileSync(path.join(dir, '.harness', 'baselines', 'manifest.json'), 'utf8')).pages.home.fromRun, 'r1');
  // With a baseline present but no diff library installed: a clear install message.
  const nolib = run(dir, ['visual', 'feat', '--run-id', 'r1']);
  assert.equal(nolib.status, 1);
  assert.match(nolib.stderr, /pixelmatch is not installed/);
});

test('visual: pixel ratio against a threshold, size mismatch fails, diff image written', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-diff-'));
  const runDir = path.join(dir, 'run');
  const baseDir = path.join(dir, 'base');
  mkdirSync(runDir); mkdirSync(baseDir);
  // A fake codec: files hold JSON {w,h,px[]}; the fake pixelmatch counts unequal pixels.
  const enc = (w, h, px) => Buffer.from(JSON.stringify({ w, h, px }));
  class PNG {
    constructor({ width, height }) { this.width = width; this.height = height; this.data = []; }
    static sync = {
      read: (buf) => { const j = JSON.parse(buf.toString()); return { width: j.w, height: j.h, data: j.px }; },
      write: () => Buffer.from('diff'),
    };
  }
  const pixelmatch = (a, b) => a.filter((v, i) => v !== b[i]).length;
  writeFileSync(path.join(baseDir, 'same.png'), enc(2, 2, [1, 1, 1, 1]));
  writeFileSync(path.join(runDir, 'same.png'), enc(2, 2, [1, 1, 1, 2]));
  writeFileSync(path.join(baseDir, 'moved.png'), enc(2, 2, [1, 1, 1, 1]));
  writeFileSync(path.join(runDir, 'moved.png'), enc(2, 2, [2, 2, 1, 1]));
  writeFileSync(path.join(baseDir, 'resized.png'), enc(2, 2, [1, 1, 1, 1]));
  writeFileSync(path.join(runDir, 'resized.png'), enc(4, 1, [1, 1, 1, 1]));
  writeFileSync(path.join(runDir, 'new.png'), enc(1, 1, [1]));
  const pages = ['same', 'moved', 'resized', 'new'].map((n) => ({ name: n, route: `/${n}`, file: `x/${n}.png` }));
  const res = await comparePages({ pages, runDir, baselineDir: baseDir, maxDiffRatio: 0.25, threshold: 0.1, load: async () => ({ pixelmatch, PNG }) });
  const by = Object.fromEntries(res.results.map((r) => [r.name, r]));
  assert.equal(by.same.status, 'match');
  assert.equal(by.same.ratio, 0.25);
  assert.equal(by.moved.status, 'diff');
  assert.equal(by.resized.status, 'size-mismatch');
  assert.equal(by.new.status, 'no-baseline');
  assert.equal(res.verdict, 'fail');
  assert.deepEqual(res.failed.sort(), ['moved', 'resized']);
  assert.ok(existsSync(path.join(runDir, 'same-diff.png')));
  // all baselines missing -> the loader is never called
  const none = await comparePages({ pages: pages.slice(3), runDir, baselineDir: baseDir, maxDiffRatio: 0.1, threshold: 0.1, load: async () => { throw new Error('should not load'); } });
  assert.equal(none.verdict, 'no-baseline');
});

test('coverage: a uiJourney case whose route is not in pages.json fails clarify-done', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-agent-'));
  run(dir, ['init', '--stack', 'node', '--host', 'generic']);
  run(dir, ['new', 'feat']);
  const fdir = fdirOf(dir);
  writeFileSync(path.join(fdir, 'vision.md'), VISION);
  writeJson(path.join(fdir, 'tasks.json'), [{ id: 'TASK-1', title: 't', requirements: ['REQ-1'], checks: [] }]);
  writeJson(path.join(fdir, 'rubric.json'), {
    version: 1, feature: 'feat',
    requirements: [{ id: 'REQ-1', description: 'd' }],
    qualityWaivers: [{ requirement: 'REQ-1', reason: 'fixture' }],
    items: [{ id: 'RB-1', requirement: 'REQ-1', level: 'essential', kind: 'file', path: 'a.txt' }],
  });
  writeJson(path.join(fdir, 'pages.json'), { pages: [{ name: 'list', route: '/list?fixture=full' }] });
  writeJson(path.join(fdir, 'e2e-cases.json'), [
    { id: 'E2E-1', category: 'uiJourney', mapsTo: 'REQ-1', route: '/list' },
    { id: 'E2E-2', category: 'uiJourney', mapsTo: 'REQ-1', route: '/settings' },
  ]);
  const r = run(dir, ['clarify-done', 'feat']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /E2E-2: uiJourney route \/settings is not in pages\.json/);
  assert.doesNotMatch(r.stderr, /E2E-1/);
});

test('routes: the fixed verdict table is printable', () => {
  const r = run(mkdtempSync(path.join(tmpdir(), 'harness-routes-')), ['routes', '--json']);
  assert.equal(r.status, 0);
  const rows = JSON.parse(r.stdout);
  assert.ok(rows.some((x) => x.next === 'replan'));
  assert.ok(rows.some((x) => x.next === 'human-decision'));
});

test('skills: every new authoring/role skill names its harness role and ships a reading edition', () => {
  const dir = path.join(HERE, '..', 'templates', 'skills');
  const roleSkills = ['clarify-requirements', 'write-prd', 'write-quality-vision', 'write-tech-design', 'write-dev-plan', 'write-acceptance-criteria', 'implement-task', 'fix-from-report', 'e2e-testing', 'api-testing', 'systematic-debugging', 'verification-before-completion', 'sync-overview'];
  for (const s of roleSkills) {
    const en = readFileSync(path.join(dir, s, 'SKILL.md'), 'utf8');
    const desc = en.match(/^description: (.*)$/m)[1];
    assert.match(desc, /^Harness |^Any harness role/, `${s} description scopes it to the harness`);
    assert.ok(readFileSync(path.join(dir, s, 'SKILL.zh-CN.md'), 'utf8').includes('中文阅读版'), s);
  }
  assert.equal(readdirSync(dir).length, 21);
});
