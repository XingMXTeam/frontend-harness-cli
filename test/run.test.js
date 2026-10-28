import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderAgentCommand, stateSignature } from '../src/run.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'harness.js');
const FAKE = path.join(HERE, 'fixtures', 'fake-agent.mjs');

function run(cwd, args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HARNESS_BIN: BIN, ...env } });
}

/** Project with a clarified two-task feature, ready for `harness run`. */
function clarifiedProject() {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-run-'));
  assert.equal(run(dir, ['init', '--stack', 'node', '--host', 'generic']).status, 0);
  const cfg = JSON.parse(readFileSync(path.join(dir, 'harness.config.json'), 'utf8'));
  cfg.autoStop = { requiredStablePasses: 1 };
  cfg.gateCommands = ['node -e "process.exit(0)"'];
  writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify(cfg, null, 2));
  assert.equal(run(dir, ['new', 'feat']).status, 0);
  const fdir = path.join(dir, '.harness', 'tasks', 'feat');
  writeFileSync(path.join(fdir, 'vision.md'),
    'REF-1: output files contain exactly the specified real content.\nANTI-1: placeholder text presented as the deliverable.\nRL-1: no stub wording ships. (check: command)\nRL-2: content matches the task wording. (check: command)\n');
  writeFileSync(path.join(fdir, 'rubric.json'), JSON.stringify({
    version: 1, feature: 'feat',
    requirements: [{ id: 'REQ-1', description: 'two deliverables with real content' }],
    qualityWaivers: [{ requirement: 'REQ-1', reason: 'run-driver fixture: plain text deliverables, deterministic checks only' }],
    items: [
      { id: 'RB-1', requirement: 'REQ-1', level: 'essential', kind: 'file', path: 'out1.txt', minBytes: 5, weight: 2 },
      { id: 'RB-2', requirement: 'REQ-1', level: 'essential', kind: 'file', path: 'out2.txt', minBytes: 5, weight: 2 },
      { id: 'RB-3', requirement: 'REQ-1', level: 'pitfall', kind: 'grep', path: 'out1.txt', pattern: 'stub', expect: 'absent', weight: 1 },
    ],
  }, null, 2));
  writeFileSync(path.join(fdir, 'tasks.json'), JSON.stringify([
    { id: 'TASK-1', title: 'write one', requirements: ['REQ-1'], checks: ['node -e "require(\'fs\').writeFileSync(\'out1.txt\',\'real implementation one\')"'] },
    { id: 'TASK-2', title: 'write two', requirements: ['REQ-1'], checks: ['node -e "require(\'fs\').writeFileSync(\'out2.txt\',\'real implementation two\')"'] },
  ], null, 2));
  assert.equal(run(dir, ['clarify-done', 'feat']).status, 0);
  return dir;
}

const agentCmd = () => `node ${FAKE} {prompt}`;

test('run: drives a clarified feature to done with no human in the loop', () => {
  const dir = clarifiedProject();
  const log = path.join(dir, 'agent.log');
  const r = run(dir, ['run', 'feat', '--agent-cmd', agentCmd(), '--json'], { FAKE_AGENT_LOG: log });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.status, 'done');
  assert.equal(summary.steps, 2);
  const state = JSON.parse(readFileSync(path.join(dir, '.harness', 'tasks', 'feat', 'state.json'), 'utf8'));
  assert.equal(state.phase, 'done');
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['implement-task', 'implement-task']);
});

test('run: the driver itself is resumable — max-steps stop, re-run finishes', () => {
  const dir = clarifiedProject();
  const r1 = run(dir, ['run', 'feat', '--agent-cmd', agentCmd(), '--max-steps', '1', '--json']);
  assert.equal(r1.status, 1);
  assert.equal(JSON.parse(r1.stdout).status, 'max-steps');
  let state = JSON.parse(readFileSync(path.join(dir, '.harness', 'tasks', 'feat', 'state.json'), 'utf8'));
  assert.equal(state.tasks.filter((t) => t.status === 'done').length, 1);
  const r2 = run(dir, ['run', 'feat', '--agent-cmd', agentCmd(), '--json']);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.equal(JSON.parse(r2.stdout).status, 'done');
  state = JSON.parse(readFileSync(path.join(dir, '.harness', 'tasks', 'feat', 'state.json'), 'utf8'));
  assert.equal(state.phase, 'done');
});

test('run: clarification is a human stop — the driver never fabricates it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-run-'));
  assert.equal(run(dir, ['init', '--stack', 'node', '--host', 'generic']).status, 0);
  assert.equal(run(dir, ['new', 'feat']).status, 0);
  const log = path.join(dir, 'agent.log');
  const r = run(dir, ['run', 'feat', '--agent-cmd', agentCmd(), '--json'], { FAKE_AGENT_LOG: log });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).status, 'needs-human');
  assert.ok(!existsSync(log), 'agent must not be dispatched for clarification');
});

test('run: a failing host agent stops the run instead of looping forever', () => {
  const dir = clarifiedProject();
  const r = run(dir, ['run', 'feat', '--agent-cmd', agentCmd(), '--json'], { FAKE_AGENT_MODE: 'fail' });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).status, 'agent-failing');
});

test('run: an agent that changes nothing is detected as stalled', () => {
  const dir = clarifiedProject();
  const r = run(dir, ['run', 'feat', '--agent-cmd', agentCmd(), '--json'], { FAKE_AGENT_MODE: 'noop' });
  assert.equal(r.status, 1);
  const summary = JSON.parse(r.stdout);
  assert.equal(summary.status, 'stalled');
  assert.equal(summary.steps, 2);
});

test('run unit: {prompt} becomes exactly one argv element; signature tracks state', () => {
  assert.deepEqual(renderAgentCommand('claude -p {prompt}', 'a b c'), ['claude', '-p', 'a b c']);
  const s = { phase: 'implement', tasks: [{ id: 'T', status: 'pending', attempts: 0 }], macroCycle: { current: 1 }, consecutivePasses: 0, remediation: [], lastEvaluation: null };
  const s2 = structuredClone(s);
  s2.tasks[0].status = 'done';
  assert.notEqual(stateSignature(s), stateSignature(s2));
});
