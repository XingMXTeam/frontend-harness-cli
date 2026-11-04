import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEvidenceProblems, detectVerifyChecks } from '../src/verify.js';
import { runItem } from '../src/evaluate.js';
import { validateRubric } from '../src/rubric.js';
import { loadProjectRules } from '../src/learn.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'harness.js');
const fh = (cwd, ...args) => spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', HARNESS_ROLE: '' } });
const fhAs = (role, cwd, ...args) => spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', HARNESS_ROLE: role } });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

function repo(pkg) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fh-vl-'));
  if (pkg) writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init', '--allow-empty');
  return dir;
}
const commit = (dir, file, msg) => { writeFileSync(path.join(dir, file), msg); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg); };

const SCRIPTS = { test: 'node -e "console.log(\'unit ok\')"', lint: 'node -e "console.error(\'2 problems\'); process.exit(1)"', build: 'node -e 0' };

// ─── verify ──────────────────────────────────────────────────────────────────

test('init generates verify.json from scripts and turns on requireVerify', () => {
  const dir = repo({ scripts: SCRIPTS });
  assert.deepEqual(detectVerifyChecks(dir).map((c) => c.id), ['lint', 'unit', 'build']);
  const r = fh(dir, 'init', '--host', 'generic');
  assert.equal(r.status, 0, r.stderr);
  const v = readJson(path.join(dir, '.harness', 'verify.json'));
  assert.deepEqual(v.checks.map((c) => c.command), ['npm run lint', 'npm test', 'npm run build']);
  assert.equal(readJson(path.join(dir, 'harness.config.json')).evidence.requireVerify, true);
  assert.match(fh(dir, 'doctor').stdout, /verify\.json — lint, unit, build/);

  // A repo with no scripts gets an empty manifest and keeps requireVerify off.
  const bare = repo({ scripts: {} });
  fh(bare, 'init', '--host', 'generic');
  assert.deepEqual(readJson(path.join(bare, '.harness', 'verify.json')).checks, []);
  assert.equal(readJson(path.join(bare, 'harness.config.json')).evidence?.requireVerify, undefined);
});

test('fh verify runs every check, records sha/exit/log, and exits non-zero on a failure', () => {
  const dir = repo({ scripts: SCRIPTS });
  fh(dir, 'init', '--host', 'generic');
  commit(dir, 'a.js', 'one');
  const head = git(dir, 'rev-parse', '--short', 'HEAD').stdout.trim();

  let r = fh(dir, 'verify');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /❌ lint/);
  assert.match(r.stdout, /2 problems/);
  const last = readJson(path.join(dir, '.harness', 'verify', 'last.json'));
  assert.equal(last.runs.unit.status, 'passed');
  assert.equal(last.runs.unit.sha, head);
  assert.equal(last.runs.lint.exitCode, 1);
  assert.match(readFileSync(path.join(dir, last.runs.unit.log), 'utf8'), /unit ok/);

  r = fh(dir, 'verify', '--only', 'unit,build');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /"verify": \["unit", "build"\]/);
  assert.notEqual(fh(dir, 'verify', '--only', 'nope').status, 0);

  // Roles: evaluator and developer may verify; the planner may not.
  assert.equal(fhAs('evaluator', dir, 'verify', '--only', 'unit').status, 0);
  assert.match(fhAs('planner', dir, 'verify').stderr, /not available to the planner/);
});

test('verify evidence must have passed, at HEAD, after the latest work', () => {
  const dir = repo({ scripts: SCRIPTS });
  fh(dir, 'init', '--host', 'generic');
  fh(dir, 'verify');
  assert.deepEqual(verifyEvidenceProblems(dir, ['unit']), []);
  assert.match(verifyEvidenceProblems(dir, ['lint'])[0], /failed/);
  assert.match(verifyEvidenceProblems(dir, ['e2e'])[0], /never run/);
  assert.match(verifyEvidenceProblems(dir, ['unit'], { freshSince: Date.now() + 60_000, freshReason: 'task-done TASK-1' })[0], /before task-done TASK-1/);
  commit(dir, 'b.js', 'two');
  assert.match(verifyEvidenceProblems(dir, ['unit'])[0], /HEAD is/);
});

test('judge evidence: cited verify runs are checked; requireVerify rejects self-reports', () => {
  const dir = repo({ scripts: SCRIPTS });
  fh(dir, 'init', '--host', 'generic');
  fh(dir, 'verify');
  mkdirSync(path.join(dir, 'ev'));
  const judge = { id: 'RB-9', kind: 'judge', level: 'important', evidence: 'ev/rb9.json', anchor: 'REF-1' };
  const write = (ev) => writeFileSync(path.join(dir, 'ev', 'rb9.json'), JSON.stringify(ev));

  write({ score: 1, note: 'looks right' });
  assert.equal(runItem(dir, judge, 5000, new Map(), {}).score, 1, 'off by default');
  const noCite = runItem(dir, judge, 5000, new Map(), { requireVerify: true });
  assert.equal(noCite.score, 0);
  assert.match(noCite.detail, /cites no verify run/);

  write({ score: 1, note: 'ok', verify: ['unit'] });
  assert.equal(runItem(dir, judge, 5000, new Map(), { requireVerify: true }).score, 1);
  write({ score: 1, note: 'ok', verify: ['unit', 'lint'] });
  assert.match(runItem(dir, judge, 5000, new Map(), {}).detail, /lint: last run failed/);
  write({ score: 0, note: 'broken' });
  assert.equal(runItem(dir, judge, 5000, new Map(), { requireVerify: true }).detail, 'judge: broken', 'a 0 needs no citation');
});

test('rubric kind=verify runs the check and records the run', () => {
  const dir = repo({ scripts: SCRIPTS });
  fh(dir, 'init', '--host', 'generic');
  assert.equal(runItem(dir, { id: 'RB-1', kind: 'verify', check: 'unit' }, 5000).score, 1);
  const lint = runItem(dir, { id: 'RB-2', kind: 'verify', check: 'lint' }, 5000);
  assert.equal(lint.score, 0);
  assert.match(lint.detail, /npm run lint` exit=1/);
  assert.match(runItem(dir, { id: 'RB-3', kind: 'verify', check: 'e2e' }, 5000).detail, /no check "e2e"/);
  assert.equal(readJson(path.join(dir, '.harness', 'verify', 'last.json')).runs.unit.status, 'passed');
  assert.throws(() => validateRubric({ requirements: [{ id: 'R' }], items: [{ id: 'X', kind: 'verify', level: 'essential' }] }), /needs a check id/);
});

// ─── learn ───────────────────────────────────────────────────────────────────

function seedReports(dir, feature, rubricItems, reports) {
  const d = path.join(dir, '.harness', 'tasks', feature, 'evaluation');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(dir, '.harness', 'tasks', feature, 'rubric.json'), JSON.stringify({ requirements: [{ id: 'REQ-1' }], items: rubricItems }));
  reports.forEach((results, i) => {
    const at = Date.parse('2026-11-01T00:00:00Z') + i * 1000 + feature.length;
    writeFileSync(path.join(d, `report-${at}.json`), JSON.stringify({ at, verdict: 'fail', results }));
  });
}

test('fh learn groups repeated failures and proposes the strongest enforcer', () => {
  const dir = repo({ scripts: {} });
  fh(dir, 'init', '--host', 'generic');
  const consoleLog = { level: 'pitfall', kind: 'grep', path: 'src/app.js', pattern: 'console\\.log', expect: 'absent' };
  seedReports(dir, 'alpha',
    [{ id: 'RB-1', requirement: 'REQ-1', ...consoleLog }, { id: 'RB-2', kind: 'judge', level: 'important', evidence: 'e.json', anchor: 'REF-1' }, { id: 'RB-3', kind: 'command', level: 'essential', command: 'npm run typecheck' }],
    [
      [{ id: 'RB-1', kind: 'grep', score: 0, detail: 'found' }, { id: 'RB-2', kind: 'judge', score: 0, detail: 'clipped titles' }, { id: 'RB-3', kind: 'command', score: 0, detail: 'exit=2' }],
      [{ id: 'RB-1', kind: 'grep', score: 1 }, { id: 'RB-2', kind: 'judge', score: 0, detail: 'clipped again' }, { id: 'RB-3', kind: 'command', score: 0, detail: 'exit=2' }],
    ]);
  seedReports(dir, 'beta', [{ id: 'RB-7', ...consoleLog, path: 'src/b.js' }], [[{ id: 'RB-7', kind: 'grep', score: 0, detail: 'found' }]]);

  const r = fh(dir, 'learn', '--json');
  assert.equal(r.status, 0, r.stderr);
  const { rules } = JSON.parse(r.stdout);
  assert.deepEqual(rules.map((x) => x.enforcer), ['gate', 'project-pitfall', 'deterministic'], 'strongest enforcer first');
  const pit = rules.find((x) => x.enforcer === 'project-pitfall');
  assert.deepEqual(pit.features, ['alpha', 'beta']);
  assert.equal(pit.occurrences, 2);
  assert.equal(rules.find((x) => x.enforcer === 'gate').command, 'npm run typecheck');
  assert.equal(rules.find((x) => x.enforcer === 'deterministic').adoptable, false);
  assert.match(fh(dir, 'learn').stdout, /fh learn adopt L-/);

  // Planner and other roles cannot adopt; the orchestrator can.
  assert.match(fhAs('developer', dir, 'learn', 'adopt', pit.id).stderr, /orchestrator only/);
  assert.equal(fh(dir, 'learn', 'adopt', pit.id).status, 0);
  const pr = readJson(path.join(dir, '.harness', 'project-rules.json')).items;
  assert.equal(pr[0].id, 'PR-1');
  assert.equal(pr[0].level, 'pitfall');
  assert.equal(pr[0].pattern, 'console\\.log');
  assert.equal(loadProjectRules(dir).length, 1);

  const gate = rules.find((x) => x.enforcer === 'gate');
  assert.equal(fh(dir, 'learn', 'adopt', gate.id).status, 0);
  assert.ok(readJson(path.join(dir, 'harness.config.json')).gateCommands.includes('npm run typecheck'));

  const judge = rules.find((x) => x.enforcer === 'deterministic');
  assert.match(fh(dir, 'learn', 'adopt', judge.id).stderr, /not auto-adoptable/);
  assert.match(fh(dir, 'learn', 'dismiss', judge.id).stderr, /needs a reason/);
  assert.equal(fh(dir, 'learn', 'dismiss', judge.id, '--reason', 'design changing next sprint').status, 0);

  // Status survives a re-mine.
  const again = JSON.parse(fh(dir, 'learn', '--json').stdout).rules;
  assert.equal(again.find((x) => x.id === pit.id).status, 'adopted');
  assert.equal(again.find((x) => x.id === judge.id).status, 'dismissed');
  assert.equal(JSON.parse(fh(dir, 'learn', '--json', '--min', '3').stdout).rules.filter((x) => x.status === 'suggested').length, 0);
});

test('an adopted project rule vetoes every feature at eval', () => {
  const dir = repo({ scripts: {} });
  fh(dir, 'init', '--host', 'generic');
  const cfg = readJson(path.join(dir, 'harness.config.json'));
  cfg.autoStop = { requiredStablePasses: 1 };
  writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify(cfg));
  fh(dir, 'new', 'alpha');
  const d = path.join(dir, '.harness', 'tasks', 'alpha');
  writeFileSync(path.join(d, 'tasks.json'), JSON.stringify([{ id: 'TASK-1', title: 't', requirements: ['REQ-1'], checks: [] }]));
  writeFileSync(path.join(d, 'vision.md'), 'REF-1: a.\nANTI-1: b.\nRL-1: c. (check: command)\nRL-2: d. (check: command)\n');
  writeFileSync(path.join(d, 'rubric.json'), JSON.stringify({ version: 1, feature: 'alpha', requirements: [{ id: 'REQ-1', description: 'x' }],
    qualityWaivers: [{ requirement: 'REQ-1', reason: 'test' }],
    items: [{ id: 'RB-1', requirement: 'REQ-1', level: 'essential', kind: 'grep', path: 'a.js', pattern: 'ok', expect: 'present', weight: 1 }] }));
  writeFileSync(path.join(dir, '.harness', 'project-rules.json'), JSON.stringify({ items: [{ id: 'PR-1', level: 'pitfall', kind: 'grep', path: 'a.js', pattern: 'console\\.log', expect: 'absent' }] }));
  assert.equal(fh(dir, 'done').status, 0); // clarify
  commit(dir, 'a.js', 'ok; console.log(1)');
  assert.equal(fh(dir, 'done').status, 0); // TASK-1

  const r = fh(dir, 'done'); // eval
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /VETOED: PR-1 — pitfall triggered/);
  // The feature's own rubric is untouched — the rule lives at project level.
  assert.ok(!readFileSync(path.join(d, 'rubric.json'), 'utf8').includes('PR-1'));
});

test('project-rules.json only accepts veto-only items', () => {
  const dir = repo();
  mkdirSync(path.join(dir, '.harness'));
  const f = path.join(dir, '.harness', 'project-rules.json');
  writeFileSync(f, JSON.stringify({ items: [{ id: 'X-1', level: 'pitfall', kind: 'grep' }] }));
  assert.throws(() => loadProjectRules(dir), /must start with PR-/);
  writeFileSync(f, JSON.stringify({ items: [{ id: 'PR-1', level: 'essential', kind: 'grep' }] }));
  assert.throws(() => loadProjectRules(dir), /only veto/);
  writeFileSync(f, JSON.stringify({ items: [{ id: 'PR-1', level: 'pitfall', kind: 'judge' }] }));
  assert.throws(() => loadProjectRules(dir), /kind must be/);
  assert.ok(!existsSync(path.join(dir, '.harness', 'learnings.json')));
});
