import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseVision, visionProblems } from '../src/vision.js';
import { validateRubric, e2eCategoryGaps } from '../src/rubric.js';
import { scoreSkillEval } from '../src/skills-eval.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'harness.js');
const GOOD = path.join(HERE, 'fixtures', 'scan-good');

function run(cwd, args, { env = {} } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}
function freshFeature() {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-quality-'));
  assert.equal(run(dir, ['init', '--stack', 'node', '--host', 'generic']).status, 0);
  assert.equal(run(dir, ['new', 'feat']).status, 0);
  const fdir = path.join(dir, '.harness', 'tasks', 'feat');
  writeFileSync(path.join(fdir, 'tasks.json'), JSON.stringify([{ id: 'TASK-1', title: 't', requirements: ['REQ-1'], checks: [] }]));
  return { dir, fdir };
}
const VISION = 'REF-1: reference behavior, exactly as specified.\nANTI-1: stub output dressed as done.\nRL-1: no placeholder ships. (check: command)\nRL-2: wording matches the requirement. (check: dom)\n';
function writeRubricFile(fdir, rubric) {
  writeFileSync(path.join(fdir, 'rubric.json'), JSON.stringify({ version: 1, feature: 'feat', ...rubric }, null, 2));
}
const BASE_ITEMS = [
  { id: 'RB-1', requirement: 'REQ-1', level: 'essential', kind: 'file', path: 'a.txt', minBytes: 1, weight: 1 },
];

// ─── vision parsing / structure ──────────────────────────────────────────────

test('vision: parses anchors and flags structural problems', () => {
  const anchors = parseVision(VISION);
  assert.deepEqual([...anchors.keys()], ['REF-1', 'ANTI-1', 'RL-1', 'RL-2']);
  assert.deepEqual(visionProblems(anchors), []);
  const weak = parseVision('REF-1: only a reference.\nRL-1: a red line with no check method.\n');
  const problems = visionProblems(weak);
  assert.ok(problems.some((p) => p.includes('ANTI')), problems.join());
  assert.ok(problems.some((p) => p.includes('two RL')), problems.join());
  assert.ok(problems.some((p) => p.includes('RL-1') && p.includes('check')), problems.join());
});

// ─── coverage gate: vision + anchors + waivers ───────────────────────────────

test('coverage: clarify-done fails without vision.md', () => {
  const { dir, fdir } = freshFeature();
  execFileSync('rm', [path.join(fdir, 'vision.md')]); // `harness new` scaffolds one; remove it to test the missing case
  writeRubricFile(fdir, { requirements: [{ id: 'REQ-1', description: 'x' }], qualityWaivers: [{ requirement: 'REQ-1', reason: 'n/a' }], items: BASE_ITEMS });
  const r = run(dir, ['clarify-done', 'feat']);
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /vision\.md missing/);
});

test('coverage: judge item without an anchor is rejected at rubric load', () => {
  assert.throws(() => validateRubric({
    requirements: [{ id: 'R', description: 'x' }],
    items: [{ id: 'J', requirement: 'R', level: 'important', kind: 'judge', evidence: 'e.json' }],
  }), /anchor/);
});

test('coverage: judge item citing a nonexistent anchor fails clarify-done', () => {
  const { dir, fdir } = freshFeature();
  writeFileSync(path.join(fdir, 'vision.md'), VISION);
  writeRubricFile(fdir, {
    requirements: [{ id: 'REQ-1', description: 'x' }],
    items: [...BASE_ITEMS, { id: 'RB-J', requirement: 'REQ-1', level: 'important', kind: 'judge', anchor: 'RL-9', evidence: 'e.json', weight: 1 }],
  });
  const r = run(dir, ['clarify-done', 'feat']);
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /RL-9/);
});

test('coverage: anchored judge passes; missing judge without waiver fails', () => {
  const a = freshFeature();
  writeFileSync(path.join(a.fdir, 'vision.md'), VISION);
  writeRubricFile(a.fdir, {
    requirements: [{ id: 'REQ-1', description: 'x' }],
    items: [...BASE_ITEMS, { id: 'RB-J', requirement: 'REQ-1', level: 'important', kind: 'judge', anchor: 'RL-1', evidence: 'e.json', weight: 1 }],
  });
  assert.equal(run(a.dir, ['clarify-done', 'feat']).status, 0);

  const b = freshFeature();
  writeFileSync(path.join(b.fdir, 'vision.md'), VISION);
  writeRubricFile(b.fdir, { requirements: [{ id: 'REQ-1', description: 'x' }], items: BASE_ITEMS });
  const r = run(b.dir, ['clarify-done', 'feat']);
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /no judge \(quality\) item/);
});

test('coverage: a waiver without a reason is rejected', () => {
  assert.throws(() => validateRubric({
    requirements: [{ id: 'R', description: 'x' }],
    qualityWaivers: [{ requirement: 'R', reason: ' ' }],
    items: [{ id: 'A', requirement: 'R', level: 'essential', kind: 'file', path: 'a' }],
  }), /waiver without a reason/);
});

test('coverage: pitfall policy requires pitfalls per requirement when enabled', () => {
  const { dir, fdir } = freshFeature();
  writeFileSync(path.join(fdir, 'vision.md'), VISION);
  writeRubricFile(fdir, {
    requirements: [{ id: 'REQ-1', description: 'x' }],
    policy: { minPitfallsPerRequirement: 1 },
    qualityWaivers: [{ requirement: 'REQ-1', reason: 'n/a' }],
    items: BASE_ITEMS,
  });
  const r = run(dir, ['clarify-done', 'feat']);
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /pitfall item/);
});

// ─── e2e category quotas ─────────────────────────────────────────────────────

const E2E_SPEC = { core: 2, negative: 2, boundary: 1, crossFeature: 1, persistence: 1, uiJourney: 1 };
const E2E_CASES = [
  { id: 'E1', category: 'core', blocking: true, mapsTo: 'REQ-1' },
  { id: 'E2', category: 'core', mapsTo: 'REQ-1' },
  { id: 'E3', category: 'negative', blocking: true, mapsTo: 'REQ-1' },
  { id: 'E4', category: 'negative', mapsTo: 'REQ-1' },
  { id: 'E5', category: 'boundary', mapsTo: 'REQ-1' },
  { id: 'E6', category: 'crossFeature', mapsTo: 'REQ-1' },
  { id: 'E7', category: 'persistence', mapsTo: 'REQ-1' },
  { id: 'E8', category: 'uiJourney', mapsTo: 'REQ-1' },
];
const RUBRIC_FOR_E2E = { requirements: [{ id: 'REQ-1', description: 'x' }], items: [], e2eCategories: E2E_SPEC };

test('e2e categories: a full denominator passes, holes and unblocked core fail', () => {
  assert.deepEqual(e2eCategoryGaps(RUBRIC_FOR_E2E, E2E_CASES), []);
  const holes = e2eCategoryGaps(RUBRIC_FOR_E2E, E2E_CASES.filter((c) => c.category !== 'negative'));
  assert.ok(holes.some((g) => g.problem.includes('negative')), JSON.stringify(holes));
  const unblocked = e2eCategoryGaps(RUBRIC_FOR_E2E, E2E_CASES.map((c) => ({ ...c, blocking: false })));
  assert.ok(unblocked.some((g) => g.problem.includes('blocking')), JSON.stringify(unblocked));
  const naOk = e2eCategoryGaps({ ...RUBRIC_FOR_E2E, e2eCategories: { ...E2E_SPEC, na: { boundary: 'no numeric inputs in this feature' } } },
    E2E_CASES.filter((c) => c.category !== 'boundary'));
  assert.deepEqual(naOk, []);
  assert.ok(e2eCategoryGaps(RUBRIC_FOR_E2E, null).length > 0);
});

test('e2e categories: declared quotas are enforced at clarify-done', () => {
  const { dir, fdir } = freshFeature();
  writeFileSync(path.join(fdir, 'vision.md'), VISION);
  writeRubricFile(fdir, {
    requirements: [{ id: 'REQ-1', description: 'x' }],
    qualityWaivers: [{ requirement: 'REQ-1', reason: 'n/a' }],
    items: BASE_ITEMS,
    e2eCategories: E2E_SPEC,
  });
  writeFileSync(path.join(fdir, 'e2e-cases.json'), JSON.stringify(E2E_CASES.filter((c) => c.category !== 'uiJourney')));
  const r = run(dir, ['clarify-done', 'feat']);
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /uiJourney/);
  writeFileSync(path.join(fdir, 'e2e-cases.json'), JSON.stringify(E2E_CASES));
  assert.equal(run(dir, ['clarify-done', 'feat']).status, 0);
});

// ─── governance wiring: verify-zone / scope / scan --history ────────────────

function gitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-gov-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 't');
  return { dir, git };
}

test('verify-zone: protected change blocks without human confirmation, passes with it', () => {
  const { dir, git } = gitRepo();
  writeFileSync(path.join(dir, 'gate.config.json'), JSON.stringify({ protectedPaths: ['gate.config.json'] }));
  git('add', '.');
  git('commit', '-qm', 'init');
  writeFileSync(path.join(dir, 'gate.config.json'), JSON.stringify({ protectedPaths: ['gate.config.json', 'extra'] }));
  const blocked = run(dir, ['verify-zone', '.']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout + blocked.stderr, /gate\.config\.json/);
  const allowed = run(dir, ['verify-zone', '.'], { env: { GATE_HUMAN_CONFIRM: 'yes' } });
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
});

test('scope: changes outside the plan editable scope are blocked', () => {
  const { dir, git } = gitRepo();
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'a.js'), 'a');
  writeFileSync(path.join(dir, 'plan.md'), '# Plan\n\n## 可改范围\n\n- `src/**`\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  writeFileSync(path.join(dir, 'outside.js'), 'nope');
  const blocked = run(dir, ['scope', 'plan.md', '.']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout + blocked.stderr, /outside\.js/);
  execFileSync('rm', [path.join(dir, 'outside.js')]);
  writeFileSync(path.join(dir, 'src', 'b.js'), 'b');
  assert.equal(run(dir, ['scope', 'plan.md', '.']).status, 0);
});

test('scan --history: appends immutable reports and prints a trend on the second run', () => {
  const hist = mkdtempSync(path.join(tmpdir(), 'harness-hist-'));
  const r1 = run(HERE, ['scan', GOOD, '--history', hist]);
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(readdirSync(hist).filter((f) => f.endsWith('.json')).length, 1);
  const r2 = run(HERE, ['scan', GOOD, '--history', hist]);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /trend \(vs previous run\)/);
  assert.equal(readdirSync(hist).filter((f) => f.endsWith('.json')).length, 2);
});

// ─── skills eval ─────────────────────────────────────────────────────────────

test('skills eval: packet emits the bundled golden set (36 cases, ~80/20, every bundled skill covered)', () => {
  const r = run(HERE, ['skills', 'eval', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.status, 'awaiting-evidence');
  assert.equal(out.cases.length, 36);
  assert.equal(out.cases.filter((c) => c.expect === null).length, 7);
  const skills = JSON.parse(run(HERE, ['skills', 'list', '--json']).stdout);
  for (const s of skills) assert.ok(out.cases.some((c) => c.expect === s), `no golden case for ${s}`);
});

test('skills eval: perfect evidence passes, degraded evidence fails', () => {
  const packet = JSON.parse(run(HERE, ['skills', 'eval', '--json']).stdout);
  const perfect = packet.cases.map((c) => ({ id: c.id, triggered: c.expect }));
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-skillev-'));
  const evFile = path.join(dir, 'evidence.json');
  writeFileSync(evFile, JSON.stringify(perfect));
  const ok = run(HERE, ['skills', 'eval', '--evidence', evFile, '--json']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout).verdict, 'pass');

  const degraded = perfect.map((r, i) => (i < 4 ? { ...r, triggered: null } : r));
  writeFileSync(evFile, JSON.stringify(degraded));
  const bad = run(HERE, ['skills', 'eval', '--evidence', evFile, '--json']);
  assert.equal(bad.status, 1);
  const score = JSON.parse(bad.stdout);
  assert.equal(score.verdict, 'fail');
  assert.equal(score.missed.length, 4);
});

test('skills eval scoring: false triggers on should-not cases are counted', () => {
  const cases = [
    { id: 'A', prompt: 'x', expect: 'bug-root-cause' },
    { id: 'B', prompt: 'y', expect: null },
  ];
  const s = scoreSkillEval(cases, [{ id: 'A', triggered: 'bug-root-cause' }, { id: 'B', triggered: 'ship-checklist' }], 0.9);
  assert.equal(s.falseTriggers.length, 1);
  assert.equal(s.accuracy, 0.5);
  assert.equal(s.verdict, 'fail');
});
