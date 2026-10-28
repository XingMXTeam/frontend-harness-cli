#!/usr/bin/env node
/**
 * Test double for a host agent, used by the `harness run` integration
 * tests and examples/demo-run.sh. It behaves the way the role agents are
 * instructed to behave:
 *   implement-task      (developer) -> run the task's checks, then harness task-done
 *   remediate           (developer) -> re-run all task checks, then harness remediate-done
 *   evaluate / confirm  (evaluator) -> write fresh judge evidence for every judge item
 *                                      in the packet (score from FAKE_EVIDENCE_SCORE, default 1);
 *                                      never runs harness eval — the driver does
 *   replan              (planner)   -> reject every pending suggestion with a reason,
 *                                      then harness replan-done
 * Modes via FAKE_AGENT_MODE: work (default) | noop (exit 0, do nothing)
 * | fail (exit 3). Every invocation appends "<action>" (or "<action>:<role>"
 * when FAKE_AGENT_LOG_ROLE is set) to FAKE_AGENT_LOG, and the packet to
 * FAKE_AGENT_PACKETS when set.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const mode = process.env.FAKE_AGENT_MODE ?? 'work';
const role = process.env.HARNESS_ROLE ?? '';
if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, `${process.env.HARNESS_ACTION ?? '?'}${process.env.FAKE_AGENT_LOG_ROLE ? `:${role}` : ''}\n`);
if (mode === 'fail') process.exit(3);
if (mode === 'noop') process.exit(0);

const prompt = process.argv[process.argv.length - 1] ?? '';
const packet = JSON.parse(prompt.split('PACKET:')[1]);
if (process.env.FAKE_AGENT_PACKETS) appendFileSync(process.env.FAKE_AGENT_PACKETS, `${JSON.stringify(packet)}\n`);
const bin = process.env.HARNESS_BIN;
if (!bin) { console.error('HARNESS_BIN not set'); process.exit(2); }
const cwd = process.cwd();
const harness = (args) => spawnSync(process.execPath, [bin, ...args], { cwd, stdio: 'inherit' });
const fdir = path.join(cwd, '.harness', 'tasks', packet.feature);
const tasks = JSON.parse(readFileSync(path.join(fdir, 'tasks.json'), 'utf8'));
const runChecks = (t) => { for (const c of t.checks ?? []) spawnSync(c, { cwd, shell: true, stdio: 'inherit' }); };

if (packet.action === 'implement-task') {
  const t = tasks.find((x) => x.id === packet.task.id);
  runChecks(t);
  harness(['task-done', packet.feature, packet.task.id]);
} else if (packet.action === 'remediate') {
  for (const t of tasks) runChecks(t);
  harness(['remediate-done', packet.feature]);
} else if (packet.action === 'evaluate' || packet.action === 'confirm-evaluation') {
  const score = Number(process.env.FAKE_EVIDENCE_SCORE ?? '1');
  for (const j of packet.judgeItems ?? []) {
    const file = path.join(cwd, j.evidence);
    mkdirSync(path.dirname(file), { recursive: true });
    const ev = { score, note: `fake evaluator, ${packet.action}, step ${packet.stepId}` };
    if (process.env.FAKE_SUGGEST) ev.rubricRefinementSuggestions = [{ type: 'refine', item: j.id, suggestion: process.env.FAKE_SUGGEST }];
    writeFileSync(file, JSON.stringify(ev));
  }
} else if (packet.action === 'replan') {
  const decisions = (packet.refinements ?? []).map((r) => ({ id: r.id, decision: 'rejected', note: 'fake planner: out of scope for this fixture' }));
  writeFileSync(path.join(fdir, 'replan-decisions.json'), JSON.stringify(decisions));
  harness(['replan-done', packet.feature]);
}
process.exit(0);
