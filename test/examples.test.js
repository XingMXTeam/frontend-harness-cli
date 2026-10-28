import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(HERE, '..', 'examples', 'notice-list');

test('example notice-list: replays clarify-done -> fail/veto -> replan -> fix -> pass -> confirm -> done', () => {
  const r = spawnSync('bash', [path.join(EXAMPLE, 'run.sh')], { encoding: 'utf8', env: { ...process.env, HARNESS_ROLE: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Evaluation: FAIL score=0\.882/);
  assert.match(r.stdout, /VETOED: RB-6/);
  assert.match(r.stdout, /Next action: replan/);
  assert.match(r.stdout, /Replan recorded for "notice-list": 1 accepted/);
  assert.match(r.stdout, /Routed: verify/);
  assert.match(r.stdout, /Routed: done/);
  assert.match(r.stdout, /phase=done/);
});

test('example notice-list: the recorded trajectory matches what the kernel produces', () => {
  const state = JSON.parse(readFileSync(path.join(EXAMPLE, 'trajectory', 'state.json'), 'utf8'));
  assert.equal(state.phase, 'done');
  assert.deepEqual(state.history.map((h) => h.event), ['clarify-done', 'task-done', 'task-done', 'task-done', 'rubric-refinements-recorded', 'evaluation-failed', 'replanned', 'remediation-fixed', 'rubric-refinements-recorded', 'evaluation-passed', 'evaluation-passed', 'done']);
  assert.deepEqual(state.refinementLog.map((x) => `${x.id}:${x.decision}`), ['RS-1:accepted']);
  const first = JSON.parse(readFileSync(path.join(EXAMPLE, 'trajectory', 'evaluation', 'report-1.json'), 'utf8'));
  assert.equal(first.verdict, 'fail');
  assert.deepEqual(first.vetoed.map((v) => v.id), ['RB-6']);
  const last = JSON.parse(readFileSync(path.join(EXAMPLE, 'trajectory', 'evaluation', 'report-3.json'), 'utf8'));
  assert.equal(last.verdict, 'pass');
  assert.deepEqual(Object.keys(last.layers), ['L1', 'L2', 'L3', 'L4']);
});
