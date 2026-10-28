import { spawnSync } from 'node:child_process';
import { loadState } from './state.js';
import { nextAction } from './orchestrate.js';

/**
 * The driver: what turns the kernel into a long-running system.
 *
 * The kernel never calls an LLM (SPEC decision 2) — and still doesn't.
 * This loop owns no intelligence either. It does exactly three things:
 *
 *   1. Ask the kernel what happens next (`nextAction`, a pure function
 *      of state — the same answer any session would derive).
 *   2. If the next step is kernel work (clarify-done, eval), run the CLI
 *      command directly. If it is agent work (implement, remediate,
 *      confirm), dispatch the packet to a host agent CLI, headless.
 *   3. Repeat until a stop condition: done, paused (budget), needs-human
 *      (clarification — the driver will not fabricate user answers),
 *      max-steps, timeout, agent-failing, or stalled.
 *
 * The driver keeps NO state of its own beyond loop counters. Kill it at
 * any point and `harness run` again — the kernel's files decide where
 * the work resumes. Stall detection is the driver's enforcement of the
 * "no stagnation" rule: an agent step that changes nothing in the state
 * signature counts against the run, twice in a row ends it.
 */

export const AGENT_TEMPLATES = {
  'claude-code': 'claude -p {prompt}',
  codex: 'codex exec {prompt}',
  generic: null,
};

export function stateSignature(state) {
  return JSON.stringify({
    phase: state.phase,
    tasks: state.tasks.map((t) => `${t.id}:${t.status}:${t.attempts}`),
    macro: state.macroCycle.current,
    passes: state.consecutivePasses,
    remediation: state.remediation ?? [],
    lastEval: state.lastEvaluation ? `${state.lastEvaluation.verdict}:${state.lastEvaluation.score}` : null,
  });
}

export function buildPacket(root, state, action) {
  return {
    feature: state.feature,
    action: action.action,
    phase: action.phase,
    instruction: action.instruction,
    task: action.task ?? null,
    items: action.items ?? null,
    root,
  };
}

export function buildPrompt(packet) {
  return [
    'You are the host agent for frontend-harness-cli, running headless under `harness run`.',
    'Hard rules: the CLI is the only source of truth for workflow state; never edit .harness/**/state.json by hand;',
    'do exactly the action in the packet — no skipping ahead, no unrelated changes;',
    'the implementer works from the plan and the task, NOT from rubric.json;',
    'commit precisely (git add <paths>, never git add -A) when the packet asks for a commit;',
    'when the packet names harness commands, run them and report their output honestly.',
    '',
    'PACKET:',
    JSON.stringify(packet, null, 2),
  ].join('\n');
}

/** Tokenize an agent command template; {prompt} is replaced as ONE argv element. */
export function renderAgentCommand(template, prompt) {
  const tokens = template.split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error('agent command template is empty');
  return tokens.map((t) => (t === '{prompt}' ? prompt : t));
}

export function makeKernelExec(binPath) {
  return (root, args) => spawnSync(process.execPath, [binPath, ...args], { cwd: root, encoding: 'utf8' });
}

export function makeAgentExec(template, { stepTimeoutMs }) {
  return (root, packet) => {
    const prompt = buildPrompt(packet);
    const argv = renderAgentCommand(template, prompt);
    const hasPlaceholder = template.includes('{prompt}');
    return spawnSync(argv[0], argv.slice(1), {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      timeout: stepTimeoutMs,
      input: hasPlaceholder ? undefined : prompt,
      env: { ...process.env, HARNESS_FEATURE: packet.feature, HARNESS_ACTION: packet.action },
    });
  };
}

const AGENT_ACTIONS = new Set(['implement-task', 'remediate', 'confirm-evaluation']);

/**
 * Run the loop. deps.execKernel(root,args) / deps.execAgent(root,packet)
 * are injectable for tests. Returns a summary object; never throws for
 * expected stop conditions.
 */
export function runLoop(root, feature, config, deps, opts = {}) {
  const maxSteps = opts.maxSteps ?? 20;
  const maxMinutes = opts.maxMinutes ?? 240;
  const maxAgentFailures = opts.maxAgentFailures ?? 2;
  const maxStalls = opts.maxStalls ?? 2;
  const onStep = opts.onStep ?? (() => {});
  const startedAt = Date.now();
  let steps = 0;
  let failures = 0;
  let stalls = 0;
  const log = [];

  const finish = (status, reason) => {
    const s = (() => { try { return loadState(root, feature); } catch { return null; } })();
    return { status, reason: reason ?? null, steps, feature, phase: s?.phase ?? null, log };
  };

  while (true) {
    if ((Date.now() - startedAt) / 60000 > maxMinutes) return finish('timeout', `wall-clock budget of ${maxMinutes} minutes exhausted`);
    let state;
    try {
      state = loadState(root, feature);
    } catch (e) {
      return finish('blocked', `cannot load state: ${e.message}`);
    }
    const action = nextAction(root, state, config);

    if (action.action === 'none') return finish('done');
    if (action.action === 'human-decision') return finish('paused', action.reason ?? 'kernel paused the feature');
    if (action.action === 'clarify') return finish('needs-human', 'clarification requires the user — the driver does not fabricate answers. Run the clarify step interactively, then re-run `harness run`.');
    if (action.action === 'unknown') return finish('blocked', action.instruction);

    if (action.action === 'clarify-done') {
      const r = deps.execKernel(root, ['clarify-done', feature]);
      if (r.status !== 0) return finish('blocked', `harness clarify-done failed: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`);
      log.push({ step: 'kernel', action: 'clarify-done' });
      onStep(log[log.length - 1]);
      continue;
    }

    if (action.action === 'evaluate') {
      const r = deps.execKernel(root, ['eval', feature, '--json']);
      // eval exits 1 on a failing verdict — that is routing information,
      // not a driver error. Only an unparseable result is a block.
      let verdict = null;
      try { verdict = JSON.parse(r.stdout).evaluation.verdict; } catch { /* handled below */ }
      if (!verdict) return finish('blocked', `harness eval produced no parseable verdict: ${(r.stderr || '').trim().slice(0, 400)}`);
      log.push({ step: 'kernel', action: 'eval', verdict });
      onStep(log[log.length - 1]);
      continue;
    }

    if (AGENT_ACTIONS.has(action.action)) {
      if (steps >= maxSteps) return finish('max-steps', `agent step budget of ${maxSteps} exhausted — re-run \`harness run ${feature}\` to continue from state`);
      const before = stateSignature(state);
      const packet = buildPacket(root, state, action);
      const r = deps.execAgent(root, packet);
      steps += 1;
      if (r.error || r.status !== 0) {
        failures += 1;
        log.push({ step: steps, action: action.action, agentExit: r.status ?? null, error: r.error ? String(r.error.message ?? r.error) : null });
        onStep(log[log.length - 1]);
        if (failures >= maxAgentFailures) return finish('agent-failing', `host agent failed ${failures} time(s) in a row (last exit ${r.status ?? 'n/a'})`);
        continue;
      }
      failures = 0;
      // A fresh confirmation evaluation is kernel work once the agent has
      // produced its evidence — run it here so the loop actually closes.
      if (action.action === 'confirm-evaluation') {
        const er = deps.execKernel(root, ['eval', feature, '--json']);
        let verdict = null;
        try { verdict = JSON.parse(er.stdout).evaluation.verdict; } catch { /* below */ }
        if (!verdict) return finish('blocked', 'confirmation eval produced no parseable verdict');
        log.push({ step: steps, action: action.action, agentExit: 0, evalVerdict: verdict });
        onStep(log[log.length - 1]);
        continue;
      }
      let after = null;
      try { after = stateSignature(loadState(root, feature)); } catch { /* treated as progress */ }
      if (after !== null && after === before) {
        stalls += 1;
        log.push({ step: steps, action: action.action, agentExit: 0, stalled: true });
        onStep(log[log.length - 1]);
        if (stalls >= maxStalls) return finish('stalled', `agent steps stopped changing the state (${maxStalls} stalls) — the work is stuck, not slow`);
        continue;
      }
      stalls = 0;
      log.push({ step: steps, action: action.action, agentExit: 0 });
      onStep(log[log.length - 1]);
      continue;
    }

    return finish('blocked', `unhandled action "${action.action}"`);
  }
}
