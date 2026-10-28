import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'harness.js');

function run(cwd, args, expectOk = true) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  if (expectOk && r.status !== 0) throw new Error(`harness ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  if (!expectOk && r.status === 0) throw new Error(`harness ${args.join(' ')} should have failed but passed:\n${r.stdout}`);
  return r;
}

function freshProject() {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-cli-test-'));
  run(dir, ['init', '--stack', 'node', '--host', 'generic']);
  return dir;
}

function writeRubric(dir, feature, rubric) {
  writeFileSync(path.join(dir, '.harness', 'tasks', feature, 'rubric.json'), JSON.stringify({ version: 1, feature, ...rubric }, null, 2));
}
function writeVision(dir, feature) {
  writeFileSync(path.join(dir, '.harness', 'tasks', feature, 'vision.md'),
    'REF-1: the reference implementation behaves exactly as specified.\nANTI-1: placeholder output presented as finished work.\nRL-1: no stub content ships. (check: command)\nRL-2: output matches the requirement wording. (check: command)\n');
}
function writeTasks(dir, feature, tasks) {
  writeFileSync(path.join(dir, '.harness', 'tasks', feature, 'tasks.json'), JSON.stringify(tasks, null, 2));
}
function state(dir, feature) {
  return JSON.parse(readFileSync(path.join(dir, '.harness', 'tasks', feature, 'state.json'), 'utf8'));
}
function setGate(dir, cmds) {
  const p = path.join(dir, 'harness.config.json');
  const c = JSON.parse(readFileSync(p, 'utf8'));
  c.gateCommands = cmds;
  writeFileSync(p, JSON.stringify(c, null, 2));
}
function setAutoStop(dir, n) {
  const p = path.join(dir, 'harness.config.json');
  const c = JSON.parse(readFileSync(p, 'utf8'));
  c.autoStop = { requiredStablePasses: n };
  writeFileSync(p, JSON.stringify(c, null, 2));
}

/** Project with one requirement, one task whose check creates the deliverable, rubric ready. */
function readyFeature(dir, feature = 'feat') {
  run(dir, ['new', feature]);
  writeFileSync(path.join(dir, 'src.txt'), ''); // placeholder replaced by task check below
  writeTasks(dir, feature, [
    { id: 'TASK-1', title: 'write deliverable', requirements: ['REQ-1'], checks: ['node -e "require(\'fs\').writeFileSync(\'out.txt\',\'real implementation, fully working\')"'] },
  ]);
  writeVision(dir, feature);
  writeRubric(dir, feature, {
    requirements: [{ id: 'REQ-1', description: 'deliverable exists with real content' }],
    qualityWaivers: [{ requirement: 'REQ-1', reason: 'fixture feature writes a plain text file — no quality surface beyond the deterministic checks' }],
    items: [
      { id: 'RB-1', requirement: 'REQ-1', level: 'essential', kind: 'file', path: 'out.txt', minBytes: 10, weight: 3 },
      { id: 'RB-2', requirement: 'REQ-1', level: 'important', kind: 'grep', path: 'out.txt', pattern: 'real implementation', expect: 'present', weight: 1 },
      { id: 'RB-3', requirement: 'REQ-1', level: 'pitfall', kind: 'grep', path: 'out.txt', pattern: 'stub|placeholder', expect: 'absent', weight: 1 },
    ],
  });
  run(dir, ['clarify-done', feature]);
  return feature;
}

test('init creates config, standards and is idempotent without --force', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-cli-init-'));
  const r1 = run(dir, ['init', '--stack', 'nextjs', '--host', 'claude-code']);
  assert.match(r1.stdout, /Initialized harness/);
  assert.ok(existsSync(path.join(dir, 'harness.config.json')));
  assert.ok(existsSync(path.join(dir, '.harness', 'standards.md')));
  assert.ok(existsSync(path.join(dir, '.claude', 'skills', 'harness', 'SKILL.md')));
  writeFileSync(path.join(dir, 'harness.config.json'), '{"version":1,"custom":true}\n');
  run(dir, ['init', '--stack', 'nextjs', '--host', 'claude-code']);
  assert.match(readFileSync(path.join(dir, 'harness.config.json'), 'utf8'), /"custom":true/);
});

test('coverage gate blocks clarify-done when a requirement has no essential item', () => {
  const dir = freshProject();
  run(dir, ['new', 'feat']);
  writeRubric(dir, 'feat', {
    requirements: [{ id: 'REQ-1', description: 'x' }, { id: 'REQ-2', description: 'y' }],
    items: [
      { id: 'RB-1', requirement: 'REQ-1', level: 'essential', kind: 'file', path: 'a.txt', weight: 1 },
      { id: 'RB-2', requirement: 'REQ-2', level: 'important', kind: 'file', path: 'b.txt', weight: 1 },
    ],
  });
  const r = run(dir, ['clarify-done', 'feat'], false);
  assert.match(r.stderr + r.stdout, /coverage gate failed/i);
  assert.match(r.stderr + r.stdout, /REQ-2: no essential item/);
  assert.equal(state(dir, 'feat').phase, 'clarify');
});

test('resume: next derives the pending task from state alone, across processes', () => {
  const dir = freshProject();
  readyFeature(dir);
  const a = JSON.parse(run(dir, ['next', 'feat', '--json']).stdout);
  assert.equal(a.action, 'implement-task');
  assert.equal(a.task.id, 'TASK-1');
  run(dir, ['task-done', 'feat', 'TASK-1']);
  const b = JSON.parse(run(dir, ['next', 'feat', '--json']).stdout);
  assert.equal(b.action, 'evaluate');
});

test('veto: one failing essential fails the verdict even when the weighted score would pass', () => {
  const dir = freshProject();
  const feature = readyFeature(dir);
  // Make the deliverable pass its task check but fail the essential file-size item:
  // task check writes 27 bytes; raise the essential minBytes above it via a second rubric item set.
  const rubric = JSON.parse(readFileSync(path.join(dir, '.harness', 'tasks', feature, 'rubric.json'), 'utf8'));
  rubric.items.find((i) => i.id === 'RB-1').minBytes = 10000;
  // Add many passing important items so the weighted score alone would be >= 0.9.
  for (let n = 0; n < 40; n++) rubric.items.push({ id: `RB-X${n}`, requirement: 'REQ-1', level: 'important', kind: 'file', path: 'src.txt', weight: 1 });
  writeFileSync(path.join(dir, '.harness', 'tasks', feature, 'rubric.json'), JSON.stringify(rubric, null, 2));
  run(dir, ['task-done', feature, 'TASK-1']);
  const r = run(dir, ['eval', feature, '--json'], false);
  const out = JSON.parse(r.stdout);
  assert.equal(out.evaluation.verdict, 'fail');
  assert.ok(out.evaluation.score >= 0.9, `score was ${out.evaluation.score}`);
  assert.ok(out.evaluation.vetoed.some((v) => v.id === 'RB-1'));
});

test('pitfall: forbidden pattern in the deliverable vetoes the evaluation', () => {
  const dir = freshProject();
  const feature = readyFeature(dir);
  const tasks = [{ id: 'TASK-1', title: 'write deliverable', requirements: ['REQ-1'], checks: ['node -e "require(\'fs\').writeFileSync(\'out.txt\',\'real implementation but stub inside\')"'] }];
  writeTasks(dir, feature, tasks);
  run(dir, ['task-done', feature, 'TASK-1']);
  const r = run(dir, ['eval', feature, '--json'], false);
  const out = JSON.parse(r.stdout);
  assert.equal(out.evaluation.verdict, 'fail');
  assert.ok(out.evaluation.vetoed.some((v) => v.id === 'RB-3'));
});

test('judge items score 0 without evidence and pass with evidence', () => {
  const dir = freshProject();
  const feature = readyFeature(dir);
  const rubric = JSON.parse(readFileSync(path.join(dir, '.harness', 'tasks', feature, 'rubric.json'), 'utf8'));
  rubric.items.push({ id: 'RB-J', requirement: 'REQ-1', level: 'important', kind: 'judge', anchor: 'RL-1', evidence: '.harness/tasks/feat/evaluation/judge-rb-j.json', weight: 5 });
  writeFileSync(path.join(dir, '.harness', 'tasks', feature, 'rubric.json'), JSON.stringify(rubric, null, 2));
  run(dir, ['task-done', feature, 'TASK-1']);
  const r1 = run(dir, ['eval', feature, '--json'], false);
  assert.equal(JSON.parse(r1.stdout).evaluation.results.find((x) => x.id === 'RB-J').score, 0);
  // Remediation cycle: write the judge evidence, re-eval (state is in implement/remediate).
  mkdirSync(path.join(dir, '.harness', 'tasks', feature, 'evaluation'), { recursive: true });
  writeFileSync(path.join(dir, '.harness', 'tasks', feature, 'evaluation', 'judge-rb-j.json'), JSON.stringify({ score: 1, note: 'checked against REQ-1' }));
  setAutoStop(dir, 1);
  setGate(dir, ['node -e "process.exit(0)"']);
  const r2 = run(dir, ['eval', feature, '--json']);
  assert.equal(JSON.parse(r2.stdout).evaluation.results.find((x) => x.id === 'RB-J').score, 1);
});

test('full loop reaches done: eval pass + gate pass + stable passes', () => {
  const dir = freshProject();
  const feature = readyFeature(dir);
  setAutoStop(dir, 2);
  setGate(dir, ['node -e "process.exit(0)"']);
  run(dir, ['task-done', feature, 'TASK-1']);
  run(dir, ['eval', feature]);
  assert.equal(state(dir, feature).phase, 'verify'); // one pass is not enough
  run(dir, ['eval', feature]); // fresh confirmation pass in verify phase
  assert.equal(state(dir, feature).phase, 'done');
  const n = JSON.parse(run(dir, ['next', feature, '--json']).stdout);
  assert.equal(n.action, 'none');
});

test('gate failure routes back to remediate instead of done', () => {
  const dir = freshProject();
  const feature = readyFeature(dir);
  setAutoStop(dir, 1);
  setGate(dir, ['node -e "process.exit(1)"']);
  run(dir, ['task-done', feature, 'TASK-1']);
  run(dir, ['eval', feature]);
  const s = state(dir, feature);
  assert.equal(s.phase, 'implement');
  assert.ok(s.remediation.some((i) => String(i).startsWith('gate:')));
});

test('budget: repeated failing evaluations pause the feature for a human', () => {
  const dir = freshProject();
  const feature = readyFeature(dir);
  // Deliverable will never satisfy the essential item (minBytes impossible).
  const rubric = JSON.parse(readFileSync(path.join(dir, '.harness', 'tasks', feature, 'rubric.json'), 'utf8'));
  rubric.items.find((i) => i.id === 'RB-1').minBytes = 10000000;
  writeFileSync(path.join(dir, '.harness', 'tasks', feature, 'rubric.json'), JSON.stringify(rubric, null, 2));
  run(dir, ['task-done', feature, 'TASK-1']);
  // maxMacroCycles default is 5 in config; shrink via state max for the test.
  const p = path.join(dir, '.harness', 'tasks', feature, 'state.json');
  const s0 = JSON.parse(readFileSync(p, 'utf8'));
  s0.macroCycle.max = 2;
  writeFileSync(p, JSON.stringify(s0, null, 2));
  run(dir, ['eval', feature], false); // cycle 1 -> remediate (cycle 2)
  run(dir, ['eval', feature], false); // cycle 2 -> budget exhausted -> paused
  const s = state(dir, feature);
  assert.equal(s.phase, 'paused');
  run(dir, ['resume', feature]);
  assert.equal(state(dir, feature).phase, 'implement');
});

test('git: task-done rejects a fake SHA and accepts the real HEAD', () => {
  const dir = freshProject();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  const feature = readyFeature(dir);
  writeFileSync(path.join(dir, 'seed.txt'), 'seed');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: dir });
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const bad = run(dir, ['task-done', feature, 'TASK-1', '--sha', 'deadbeef'], false);
  assert.match(bad.stderr + bad.stdout, /does not verify/);
  run(dir, ['task-done', feature, 'TASK-1', '--sha', head]);
  assert.equal(state(dir, feature).tasks[0].commitSha, head.toLowerCase());
});

test('task checks gate task-done: a failing check keeps the task pending and counts the attempt', () => {
  const dir = freshProject();
  run(dir, ['new', 'feat']);
  writeTasks(dir, 'feat', [{ id: 'TASK-1', title: 'always fails', requirements: ['REQ-1'], checks: ['node -e "process.exit(1)"'] }]);
  writeVision(dir, 'feat');
  writeRubric(dir, 'feat', {
    requirements: [{ id: 'REQ-1', description: 'x' }],
    qualityWaivers: [{ requirement: 'REQ-1', reason: 'task-check fixture — no quality surface' }],
    items: [{ id: 'RB-1', requirement: 'REQ-1', level: 'essential', kind: 'file', path: 'a.txt', weight: 1 }],
  });
  run(dir, ['clarify-done', 'feat']);
  run(dir, ['task-done', 'feat', 'TASK-1'], false);
  const s = state(dir, 'feat');
  assert.equal(s.tasks[0].status, 'pending');
  assert.equal(s.tasks[0].attempts, 1);
});
