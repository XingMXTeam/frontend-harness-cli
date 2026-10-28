#!/usr/bin/env node
/**
 * Test double for a host agent, used by the `harness run` integration
 * tests and examples/demo-run.sh. It behaves the way the harness skill
 * instructs a real host agent to behave:
 *   implement-task      -> run the task's own checks, then harness task-done
 *   remediate           -> re-run all task checks, then harness eval
 *   confirm-evaluation  -> nothing to produce (fixtures waive judge items)
 * Modes via FAKE_AGENT_MODE: work (default) | noop (exit 0, do nothing)
 * | fail (exit 3). Every invocation appends its action to FAKE_AGENT_LOG.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.env.FAKE_AGENT_MODE ?? 'work';
if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, `${process.env.HARNESS_ACTION ?? '?'}\n`);
if (mode === 'fail') process.exit(3);
if (mode === 'noop') process.exit(0);

const prompt = process.argv[process.argv.length - 1] ?? '';
const packet = JSON.parse(prompt.split('PACKET:')[1]);
const bin = process.env.HARNESS_BIN;
if (!bin) { console.error('HARNESS_BIN not set'); process.exit(2); }
const cwd = process.cwd();
const harness = (args) => spawnSync(process.execPath, [bin, ...args], { cwd, stdio: 'inherit' });
const tasksFile = path.join(cwd, '.harness', 'tasks', packet.feature, 'tasks.json');
const tasks = JSON.parse(readFileSync(tasksFile, 'utf8'));
const runChecks = (t) => { for (const c of t.checks ?? []) spawnSync(c, { cwd, shell: true, stdio: 'inherit' }); };

if (packet.action === 'implement-task') {
  const t = tasks.find((x) => x.id === packet.task.id);
  runChecks(t);
  harness(['task-done', packet.feature, packet.task.id]);
} else if (packet.action === 'remediate') {
  for (const t of tasks) runChecks(t);
  harness(['eval', packet.feature]);
} else if (packet.action === 'confirm-evaluation') {
  // Fresh-context evidence regeneration happens here in a real setup.
}
process.exit(0);
