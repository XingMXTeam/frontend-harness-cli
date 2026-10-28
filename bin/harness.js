#!/usr/bin/env node
/**
 * harness — the frontend-harness-cli kernel for long-running frontend AI coding.
 *
 * The CLI never calls an LLM. It owns the parts that must be deterministic:
 * state (files, resumable), rubric coverage, evaluation with veto rules,
 * delivery gates, budgets and auto-stop. Host agents (Claude Code, Codex, …)
 * do the planning / coding / judging through the packets `harness next` emits.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, chmodSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG, HARNESS_DIR, configPath, featureDir, harnessDir, loadConfig } from '../src/config.js';
import { createState, loadState, saveState, record, withLock } from '../src/state.js';
import { loadRubric, rubricPath } from '../src/rubric.js';
import { evaluateRubric, writeReport, runGateCommands } from '../src/evaluate.js';
import { nextAction, applyEvaluation, checkCoverage } from '../src/orchestrate.js';
import { isGitRepo, verifySha, headSha } from '../src/git.js';
import { runScan, formatReport, loadScanConfig } from '../src/scan.js';
import { verifyZone } from '../src/gate/zone.js';
import { checkScope } from '../src/gate/scope.js';
import { readPreviousReport, appendHistory, computeTrend } from '../src/gate/history.js';
import { scoreSkillEval } from '../src/skills-eval.js';
import { runLoop, AGENT_TEMPLATES, makeKernelExec, makeAgentExec } from '../src/run.js';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const root = process.cwd();

class CliError extends Error {}
// fail() throws instead of process.exit(): several commands run inside a
// state lock, and process.exit() would skip the finally that releases it,
// leaving a stale .lock behind for every later command.
function fail(msg) {
  throw new CliError(msg);
}

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (flag) => process.argv.includes(flag);
const jsonOut = () => has('--json');
function print(obj, human) {
  if (jsonOut()) console.log(JSON.stringify(obj, null, 2));
  else console.log(human ?? JSON.stringify(obj, null, 2));
}

// ─── skills pack (data, not logic: vendored from harness-skills) ─────────────
const SKILLS_SRC = path.join(TEMPLATES, 'skills');

export function listBundledSkills() {
  if (!existsSync(SKILLS_SRC)) return [];
  return readdirSync(SKILLS_SRC, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(SKILLS_SRC, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
}

/** Copy bundled skills into targetDir. Existing skills are skipped unless force. */
export function installSkills(targetDir, { only = null, force = false } = {}) {
  const names = only ?? listBundledSkills();
  const installed = [], skipped = [], missing = [];
  for (const name of names) {
    const src = path.join(SKILLS_SRC, name);
    if (!existsSync(path.join(src, 'SKILL.md'))) { missing.push(name); continue; }
    const dst = path.join(targetDir, name);
    if (existsSync(dst) && !force) { skipped.push(name); continue; }
    mkdirSync(dst, { recursive: true });
    cpSync(src, dst, { recursive: true, force: true });
    installed.push(name);
  }
  return { installed, skipped, missing };
}

function cmdSkillsEval() {
  const casesFile = arg('--cases') ?? (existsSync(path.join(root, '.harness', 'skills-eval', 'cases.json'))
    ? path.join(root, '.harness', 'skills-eval', 'cases.json')
    : path.join(TEMPLATES, 'skills-eval', 'cases.json'));
  if (!existsSync(casesFile)) fail(`Skill-eval cases file not found: ${casesFile}`);
  const parsed = JSON.parse(readFileSync(casesFile, 'utf8'));
  const cases = Array.isArray(parsed) ? parsed : parsed.cases;
  if (!Array.isArray(cases) || cases.length === 0) fail(`No cases in ${casesFile}`);
  const evidenceFile = arg('--evidence');
  if (!evidenceFile) {
    print({ status: 'awaiting-evidence', casesFile, cases },
      `Skill-eval packet: ${cases.length} case(s) from ${casesFile}\nRun each prompt in a FRESH host session with the skills pack installed (never the session that edited the skills — isolation applies to the workflow's own rules too). Record which bundled skill fired, then write the evidence file:\n  [{"id": "P1", "triggered": "plan-before-code"}, {"id": "N1", "triggered": null}, ...]\nThen: harness skills eval --evidence <file> [--min-accuracy 0.9]`);
    return;
  }
  const evRaw = JSON.parse(readFileSync(path.resolve(root, evidenceFile), 'utf8'));
  const results = Array.isArray(evRaw) ? evRaw : evRaw.results;
  if (!Array.isArray(results)) fail('Evidence file must be a JSON array (or {results: [...]}) of {id, triggered}.');
  const minAccuracy = Number(arg('--min-accuracy', '0.9'));
  const score = scoreSkillEval(cases, results, minAccuracy);
  print({ casesFile, evidenceFile, ...score },
    `Skill eval: ${score.correct}/${score.total} correct, accuracy ${score.accuracy} (min ${minAccuracy}) — ${score.verdict.toUpperCase()}` +
    (score.missed.length ? `\nMissed/wrong: ${score.missed.map((m) => `${m.id} (want ${m.expect}, got ${m.got ?? 'none'})`).join('; ')}` : '') +
    (score.falseTriggers.length ? `\nFalse triggers: ${score.falseTriggers.map((f) => `${f.id} -> ${f.triggered}`).join('; ')}` : '') +
    (score.unevidenced.length ? `\nNo evidence for: ${score.unevidenced.join(', ')}` : ''));
  if (score.verdict !== 'pass') process.exitCode = 1;
}

function cmdSkills() {
  const sub = process.argv[3];
  if (sub === 'eval') { cmdSkillsEval(); return; }
  if (sub === 'list' || !sub) {
    const names = listBundledSkills();
    print(names, `Bundled skills (${names.length}):\n${names.map((n) => `  - ${n}`).join('\n')}`);
    return;
  }
  if (sub === 'install') {
    const onlyArg = arg('--only');
    const only = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
    const target = arg('--dir') ?? (has('--project') ? path.join(root, '.claude', 'skills') : path.join(homedir(), '.claude', 'skills'));
    const res = installSkills(target, { only, force: has('--force') });
    print({ target, ...res }, `Skills -> ${target}\nInstalled: ${res.installed.join(', ') || 'none'}${res.skipped.length ? `\nSkipped (exist; --force to overwrite): ${res.skipped.join(', ')}` : ''}${res.missing.length ? `\nNot found: ${res.missing.join(', ')}` : ''}`);
    if (res.missing.length) process.exitCode = 1;
    return;
  }
  fail(`Unknown skills subcommand "${sub}" (list|install|eval).`);
}

// ─── scan (standalone sensor; no init / state required) ──────────────────────
function cmdScan() {
  const argv = process.argv.slice(3);
  const histIdx = argv.indexOf('--history');
  const historyDir = histIdx >= 0 ? argv[histIdx + 1] : null;
  const positional = argv.filter((a, i) => !a.startsWith('--') && i !== histIdx + 1);
  const target = path.resolve(root, positional[0] ?? '.');
  if (!existsSync(target)) fail(`Scan target does not exist: ${target}`);
  const report = runScan(target);
  if (historyDir) {
    const dir = path.resolve(root, historyDir);
    const previous = readPreviousReport(dir);
    report.trend = computeTrend(previous, report);
    appendHistory(dir, report);
  }
  if (jsonOut()) console.log(JSON.stringify(report, null, 2));
  else console.log(formatReport(report));
  // CI parity with ai-gate: the sensor's own pass/fail is the exit code when
  // used standalone. Inside `harness eval` this report is only an input.
  if (!report.passed) process.exitCode = 1;
}

// ─── governance: protected zone + plan scope (gate engine, wired) ────────────
function cmdVerifyZone() {
  const positional = process.argv.slice(3).filter((a) => !a.startsWith('--'));
  const target = path.resolve(root, positional[0] ?? '.');
  if (!existsSync(target)) fail(`Target does not exist: ${target}`);
  const res = verifyZone(target, loadScanConfig(target));
  print(res, res.ok
    ? `Protected zone OK${res.touched?.length ? ` (touched: ${res.touched.join(', ')} — human confirmation present)` : ' (no protected files touched)'}`
    : `Protected zone BLOCKED: ${res.reason}\nTouched: ${(res.touched ?? []).join(', ')}`);
  if (!res.ok) process.exitCode = 1;
}

function cmdScope() {
  const positional = process.argv.slice(3).filter((a) => !a.startsWith('--'));
  const plan = positional[0];
  if (!plan) fail('Usage: harness scope <plan.md> [path]');
  const planAbs = path.resolve(root, plan);
  if (!existsSync(planAbs)) fail(`Plan file does not exist: ${plan}`);
  const target = path.resolve(root, positional[1] ?? '.');
  const res = checkScope(target, planAbs);
  print(res, res.ok
    ? `Scope OK${res.note ? ` — ${res.note}` : ` (${(res.patterns ?? []).length} editable pattern(s), no changes outside)`}`
    : `Scope BLOCKED: ${res.reason}\nOutside scope: ${(res.outside ?? []).join(', ')}`);
  if (!res.ok) process.exitCode = 1;
}

// ─── init ────────────────────────────────────────────────────────────────────
function cmdInit() {
  const stack = arg('--stack', 'node');
  const host = arg('--host', 'claude-code');
  const force = has('--force');
  if (!['node', 'nextjs', 'vue'].includes(stack)) fail(`Unknown stack "${stack}" (node|nextjs|vue).`);
  if (!['claude-code', 'codex', 'generic'].includes(host)) fail(`Unknown host "${host}" (claude-code|codex|generic).`);

  const made = [];
  const skipped = [];
  const write = (file, content) => {
    if (existsSync(file) && !force) { skipped.push(path.relative(root, file)); return; }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    made.push(path.relative(root, file));
  };

  const config = structuredClone(DEFAULT_CONFIG);
  config.stack = stack;
  config.host = host;
  if (stack === 'node') config.gateCommands = ['npm test'];
  if (stack === 'nextjs') config.gateCommands = ['npm run gate'];
  if (stack === 'vue') config.gateCommands = ['npm test'];
  write(configPath(root), `${JSON.stringify(config, null, 2)}\n`);

  mkdirSync(harnessDir(root), { recursive: true });
  const standardsSrc = path.join(TEMPLATES, 'standards', `${stack}.md`);
  const standardsDst = path.join(harnessDir(root), 'standards.md');
  if (existsSync(standardsDst) && !force) skipped.push(path.relative(root, standardsDst));
  else { copyFileSync(standardsSrc, standardsDst); made.push(path.relative(root, standardsDst)); }

  if (host === 'claude-code') {
    const skillDst = path.join(root, '.claude', 'skills', 'harness', 'SKILL.md');
    if (existsSync(skillDst) && !force) skipped.push(path.relative(root, skillDst));
    else { mkdirSync(path.dirname(skillDst), { recursive: true }); copyFileSync(path.join(TEMPLATES, 'claude-code', 'SKILL.md'), skillDst); made.push(path.relative(root, skillDst)); }
    const hookDst = path.join(root, '.claude', 'hooks', 'session-start.sh');
    if (existsSync(hookDst) && !force) skipped.push(path.relative(root, hookDst));
    else { mkdirSync(path.dirname(hookDst), { recursive: true }); copyFileSync(path.join(TEMPLATES, 'claude-code', 'session-start.sh'), hookDst); chmodSync(hookDst, 0o755); made.push(path.relative(root, hookDst)); }
    const pack = installSkills(path.join(root, '.claude', 'skills'), { force });
    made.push(...pack.installed.map((n) => `.claude/skills/${n}`));
    skipped.push(...pack.skipped.map((n) => `.claude/skills/${n}`));
    write(path.join(harnessDir(root), 'host-setup.md'),
      '# Claude Code host setup\n\nRegister the session-start hook in `.claude/settings.json`:\n\n```json\n{\n  "hooks": {\n    "SessionStart": [{ "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh" }] }]\n  }\n}\n```\n\nThe `harness` skill is already installed at `.claude/skills/harness/SKILL.md`, and the bundled skills pack (plan-before-code, deterministic-eval, …) is installed alongside it. Manage the pack with `harness skills list|install`.\n');
  } else {
    write(path.join(harnessDir(root), 'host-setup.md'),
      `# Host setup (${host})\n\nAt the start of every session, the host agent must run \`harness next <feature>\` and follow the returned action. Add that sentence to your agent instructions file (AGENTS.md / equivalent). The harness skill text for reference is in the frontend-harness-cli package: templates/claude-code/SKILL.md.\n`);
  }

  print({ ok: true, stack, host, created: made, skipped },
    `Initialized harness (stack=${stack}, host=${host}).\nCreated: ${made.join(', ') || 'nothing'}${skipped.length ? `\nSkipped (already exist, use --force to overwrite): ${skipped.join(', ')}` : ''}\nNext: harness new <feature>`);
}

// ─── new ─────────────────────────────────────────────────────────────────────
function cmdNew() {
  const feature = process.argv[3];
  if (!feature) fail('Usage: harness new <feature> [--title "..."]');
  loadConfig(root);
  const dir = featureDir(root, feature);
  if (existsSync(path.join(dir, 'state.json'))) fail(`Feature "${feature}" already exists. See: harness status ${feature}`);
  mkdirSync(dir, { recursive: true });
  const config = loadConfig(root);
  const state = createState(feature, arg('--title', ''));
  state.macroCycle.max = config.budgets.maxMacroCycles;
  saveState(root, state);

  const rubric = {
    version: 1,
    feature,
    requirements: [
      { id: 'REQ-1', description: 'REPLACE: the first user-visible requirement, in one sentence.' },
    ],
    items: [
      { id: 'RB-1', requirement: 'REQ-1', layer: 'L1-function', level: 'essential', kind: 'file', path: 'REPLACE-WITH-REAL-PATH', minBytes: 1, weight: 3 },
      { id: 'RB-2', requirement: 'REQ-1', layer: 'L2-robustness', level: 'pitfall', kind: 'grep', path: 'REPLACE-WITH-REAL-PATH', pattern: 'TODO|FIXME|placeholder', expect: 'absent', weight: 1 },
      { id: 'RB-3', requirement: 'REQ-1', layer: 'L4-quality', level: 'important', kind: 'judge', anchor: 'RL-1', evidence: `.harness/tasks/${feature}/evaluation/judge-rb-3.json`, weight: 2 },
    ],
  };
  writeFileSync(rubricPath(root, feature), `${JSON.stringify(rubric, null, 2)}\n`);
  writeFileSync(path.join(dir, 'vision.md'),
    `# Quality vision — ${feature}\n\nAnchors the rubric's judge items cite. Replace every REPLACE line during clarify.\n\nREF-1: REPLACE — the positive reference: what good looks like for this feature, and where to see it.\nANTI-1: REPLACE — the anti-reference: what to avoid, and why.\nRL-1: REPLACE — a red line that is never acceptable. (check: screenshot)\nRL-2: REPLACE — another red line. (check: command)\n`);
  const tasks = [
    { id: 'TASK-1', title: 'REPLACE: first small, independently verifiable task', requirements: ['REQ-1'], checks: [] },
  ];
  writeFileSync(path.join(dir, 'tasks.json'), `${JSON.stringify(tasks, null, 2)}\n`);
  print({ ok: true, feature, dir: path.relative(root, dir) },
    `Created feature "${feature}" in ${path.relative(root, dir)}/\n- state.json (phase=clarify)\n- vision.md (scaffold — quality anchors the planner finalizes during clarification)\n- rubric.json (scaffold — the planner replaces it after clarification)\n- tasks.json (scaffold)\nNext: work the clarify step with the user, finalize vision.md + rubric.json + tasks.json, then: harness clarify-done ${feature}`);
}

// ─── clarify-done ────────────────────────────────────────────────────────────
async function cmdClarifyDone() {
  const feature = process.argv[3];
  const config = loadConfig(root);
  await withLock(root, feature, async () => {
    const state = loadState(root, feature);
    const { ok, gaps } = checkCoverage(root, state);
    if (!ok) fail(`Rubric coverage gate failed for "${feature}":\n${gaps.map((g) => `  - ${g.requirement}: ${g.problem}`).join('\n')}\nImplementation may not start until every requirement has an essential check.`);
    const tasksFile = path.join(featureDir(root, feature), 'tasks.json');
    const tasks = JSON.parse(readFileSync(tasksFile, 'utf8'));
    state.tasks = tasks.map((t) => ({ id: t.id, title: t.title, requirements: t.requirements ?? [], status: 'pending', attempts: 0, commitSha: null }));
    state.clarificationComplete = true;
    state.phase = 'implement';
    record(state, { event: 'clarify-done', tasks: state.tasks.length });
    saveState(root, state);
    print({ ok: true, feature, tasks: state.tasks.length }, `Clarification locked for "${feature}": rubric coverage OK, ${state.tasks.length} task(s) queued. Phase -> implement.`);
  });
}

// ─── next / status ───────────────────────────────────────────────────────────
function cmdNext() {
  const feature = process.argv[3];
  const config = loadConfig(root);
  const state = loadState(root, feature);
  const action = nextAction(root, state, config);
  print(action, `[${action.phase}] next action: ${action.action}\n${action.instruction}${action.task ? `\nTask: ${action.task.id} — ${action.task.title}` : ''}${action.items ? `\nOpen items: ${action.items.join(', ')}` : ''}`);
}

function cmdStatus() {
  const feature = process.argv[3];
  if (feature) {
    const state = loadState(root, feature);
    const done = state.tasks.filter((t) => t.status === 'done').length;
    print(state, `Feature: ${state.feature}\nPhase: ${state.phase} (macro cycle ${state.macroCycle.current}/${state.macroCycle.max})\nTasks: ${done}/${state.tasks.length} done\nConsecutive passes: ${state.consecutivePasses}\nLast evaluation: ${state.lastEvaluation ? `${state.lastEvaluation.verdict} score=${state.lastEvaluation.score}` : 'none'}${state.pauseReason ? `\nPaused: ${state.pauseReason}` : ''}`);
    return;
  }
  const dir = path.join(harnessDir(root), 'tasks');
  const features = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(path.join(dir, d, 'state.json'))) : [];
  const rows = features.map((f) => { const s = loadState(root, f); return { feature: f, phase: s.phase, macroCycle: s.macroCycle.current }; });
  print(rows, rows.length ? rows.map((r) => `${r.feature}: ${r.phase} (cycle ${r.macroCycle})`).join('\n') : 'No features yet. Run: harness new <feature>');
}

// ─── task-done ───────────────────────────────────────────────────────────────
async function cmdTaskDone() {
  const feature = process.argv[3];
  const taskId = process.argv[4];
  if (!feature || !taskId) fail('Usage: harness task-done <feature> <taskId> [--sha <commit>]');
  const config = loadConfig(root);
  await withLock(root, feature, async () => {
    const state = loadState(root, feature);
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) fail(`No task "${taskId}" in feature "${feature}".`);
    if (task.status === 'done') fail(`Task ${taskId} is already done.`);
    const tasksFile = path.join(featureDir(root, feature), 'tasks.json');
    const def = JSON.parse(readFileSync(tasksFile, 'utf8')).find((t) => t.id === taskId);
    for (const cmd of def?.checks ?? []) {
      const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', timeout: config.evaluation.commandTimeoutMs });
      if (r.status !== 0) {
        task.attempts += 1;
        record(state, { event: 'task-check-failed', task: taskId, check: cmd, attempts: task.attempts });
        saveState(root, state);
        fail(`Task check failed for ${taskId}: \`${cmd}\` exited ${r.status}. Attempts: ${task.attempts}/${config.budgets.maxTaskRetries}.`);
      }
    }
    let sha = arg('--sha');
    if (isGitRepo(root) && config.git.requireCommitPerTask) {
      if (!sha) fail('This is a git repo and requireCommitPerTask is on: commit the task precisely, then pass --sha <commit>.');
      if (!verifySha(root, sha)) fail(`Commit SHA "${sha}" does not verify in this repo (git rev-parse --verify failed). Placeholder SHAs are not accepted.`);
      sha = sha.toLowerCase();
    }
    task.status = 'done';
    task.commitSha = sha ?? null;
    record(state, { event: 'task-done', task: taskId, commitSha: task.commitSha });
    if (state.remediation?.length) state.remediation = state.remediation.filter((i) => i !== taskId);
    saveState(root, state);
    print({ ok: true, feature, task: taskId, commitSha: task.commitSha }, `Task ${taskId} recorded done${sha ? ` @ ${sha}` : ''}. Next: harness next ${feature}`);
  });
}

// ─── eval / gate ─────────────────────────────────────────────────────────────
async function cmdEval() {
  const feature = process.argv[3];
  const config = loadConfig(root);
  let verdict = null;
  await withLock(root, feature, async () => {
    const state = loadState(root, feature);
    if (!state.clarificationComplete) fail('Clarification is not complete; evaluation has no anchor yet. Finish clarify, then harness clarify-done.');
    const { ok, gaps } = checkCoverage(root, state);
    if (!ok) fail(`Rubric coverage gate failed:\n${gaps.map((g) => `  - ${g.requirement}: ${g.problem}`).join('\n')}`);
    if (state.phase === 'implement' && state.tasks.some((t) => t.status !== 'done') && !state.remediation?.length) {
      fail('Not all tasks are recorded done yet. Evaluation runs on completed work: harness next ' + feature);
    }
    const rubric = loadRubric(root, feature);
    const evaluation = evaluateRubric(root, rubric, config);
    const reportFile = writeReport(root, feature, evaluation);

    const willFinish = state.phase === 'verify' || state.consecutivePasses + 1 >= config.autoStop.requiredStablePasses;
    const gateResult = evaluation.verdict === 'pass' && willFinish
      ? runGateCommands(root, config)
      : { passed: true, failedAt: null, steps: [], skipped: true };
    const routing = applyEvaluation(root, state, config, evaluation, gateResult);
    saveState(root, state);
    verdict = evaluation.verdict;
    print({ evaluation, gate: gateResult, routing, reportFile: path.relative(root, reportFile) },
      `Evaluation: ${evaluation.verdict.toUpperCase()} score=${evaluation.score} (pass >= ${evaluation.passScore})${evaluation.vetoed.length ? `\nVETOED: ${evaluation.vetoed.map((v) => `${v.id} — ${v.reason}`).join('; ')}` : ''}\nRouted: ${routing.routed}${routing.reason ? ` (${routing.reason})` : ''}\nReport: ${path.relative(root, reportFile)}\nPhase now: ${state.phase}. Next: harness next ${feature}`);
  });
  if (verdict !== 'pass') process.exitCode = 1;
}

function cmdGate() {
  const config = loadConfig(root);
  const result = runGateCommands(root, config);
  print(result, result.passed ? `Delivery gate PASSED (${result.steps.length} command(s)).` : `Delivery gate FAILED at: ${result.failedAt}`);
  if (!result.passed) process.exit(1);
}

// ─── run: the driver (kernel loop + headless host-agent dispatch) ────────────
function cmdRun() {
  const feature = process.argv[3];
  if (!feature) fail('Usage: harness run <feature> [--agent claude-code|codex] [--agent-cmd "..."] [--max-steps 20] [--max-minutes 240]');
  const config = loadConfig(root);
  let template = arg('--agent-cmd');
  if (!template) {
    const agentName = arg('--agent', config.host);
    template = AGENT_TEMPLATES[agentName];
    if (!template) fail(`No built-in agent command for "${agentName}". Pass --agent-cmd "<command with {prompt}>" (the packet is passed as one argument, or on stdin when no {prompt} placeholder is present).`);
  }
  const binPath = fileURLToPath(import.meta.url);
  const deps = {
    execKernel: makeKernelExec(binPath),
    execAgent: makeAgentExec(template, { stepTimeoutMs: Number(arg('--step-timeout', '1800')) * 1000 }),
  };
  const started = Date.now();
  const summary = runLoop(root, feature, config, deps, {
    maxSteps: Number(arg('--max-steps', '20')),
    maxMinutes: Number(arg('--max-minutes', '240')),
    onStep: (entry) => {
      if (!jsonOut()) console.log(`[run] ${entry.step === 'kernel' ? 'kernel' : `step ${entry.step}`}: ${entry.action}${entry.verdict ? ` -> ${entry.verdict}` : ''}${entry.evalVerdict ? ` + eval -> ${entry.evalVerdict}` : ''}${entry.stalled ? ' (no state change)' : ''}`);
    },
  });
  const mins = Math.round((Date.now() - started) / 600) / 100;
  print({ ...summary, minutes: mins },
    `[run] ${summary.status.toUpperCase()} — feature "${feature}" phase=${summary.phase ?? '?'} after ${summary.steps} agent step(s), ${mins} min${summary.reason ? `\nReason: ${summary.reason}` : ''}\n${summary.status === 'done' ? `Report: harness report ${feature}` : `Continue: harness run ${feature} (state decides where it resumes)`}`);
  if (summary.status !== 'done') process.exitCode = 1;
}

// ─── resume / report / doctor ────────────────────────────────────────────────
async function cmdResume() {
  const feature = process.argv[3];
  const config = loadConfig(root);
  await withLock(root, feature, async () => {
    const state = loadState(root, feature);
    if (state.phase !== 'paused') fail(`Feature "${feature}" is not paused (phase=${state.phase}).`);
    state.phase = 'implement';
    state.macroCycle.max = config.budgets.maxMacroCycles;
    state.macroCycle.current = 1;
    delete state.pauseReason;
    record(state, { event: 'resumed-by-human' });
    saveState(root, state);
    print({ ok: true, feature }, `Feature "${feature}" resumed with a fresh macro-cycle budget. Next: harness next ${feature}`);
  });
}

function cmdReport() {
  const feature = process.argv[3];
  const state = loadState(root, feature);
  const reportFile = path.join(featureDir(root, feature), 'evaluation', 'report.json');
  const ev = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null;
  const lines = [
    `# Harness report — ${state.feature}`,
    '',
    `- Phase: **${state.phase}** (macro cycle ${state.macroCycle.current}/${state.macroCycle.max})`,
    `- Title: ${state.title || '(untitled)'}`,
    `- Tasks: ${state.tasks.filter((t) => t.status === 'done').length}/${state.tasks.length} done`,
    ...state.tasks.map((t) => `  - ${t.status === 'done' ? '✅' : '⬜'} ${t.id} ${t.title}${t.commitSha ? ` @ ${t.commitSha}` : ''}`),
    `- Git HEAD: ${headSha(root) ?? 'n/a'}`,
  ];
  if (ev) {
    lines.push('', `## Last evaluation`, `- Verdict: **${ev.verdict}**, score ${ev.score} (pass >= ${ev.passScore})`,
      ...(ev.vetoed.length ? ev.vetoed.map((v) => `- VETO ${v.id}: ${v.reason}`) : ['- No vetoes']),
      ...ev.results.filter((r) => r.score < 1).map((r) => `- Open ${r.id} (${r.level}): ${r.detail}`));
  }
  lines.push('', `## History`, ...state.history.map((h) => `- ${new Date(h.at).toISOString()} ${h.event ?? ''} ${h.task ?? ''} ${h.reason ?? ''}`.trimEnd()));
  console.log(lines.join('\n'));
}

function cmdDoctor() {
  const checks = [];
  checks.push({ name: 'node >= 20', ok: Number(process.versions.node.split('.')[0]) >= 20, detail: process.versions.node });
  try { const c = loadConfig(root); checks.push({ name: 'harness.config.json parses', ok: true, detail: `stack=${c.stack} host=${c.host}` }); checks.push({ name: 'gateCommands configured', ok: c.gateCommands.length > 0, detail: c.gateCommands.join(' ; ') || 'empty — harness gate will pass vacuously' }); }
  catch (e) { checks.push({ name: 'harness.config.json parses', ok: false, detail: e.message }); }
  checks.push({ name: 'git repo', ok: isGitRepo(root), detail: isGitRepo(root) ? `HEAD ${headSha(root)}` : 'not a git repo — per-task SHA checks are skipped' });
  checks.push({ name: '.harness/standards.md present', ok: existsSync(path.join(harnessDir(root), 'standards.md')), detail: '' });
  print(checks, checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`).join('\n'));
  if (checks.some((c) => !c.ok && c.name !== 'gateCommands configured')) process.exit(1);
}

// ─── main ────────────────────────────────────────────────────────────────────
const cmd = process.argv[2];
try {
  switch (cmd) {
    case 'init': cmdInit(); break;
    case 'new': cmdNew(); break;
    case 'clarify-done': await cmdClarifyDone(); break;
    case 'next': cmdNext(); break;
    case 'status': cmdStatus(); break;
    case 'task-done': await cmdTaskDone(); break;
    case 'eval': await cmdEval(); break;
    case 'gate': cmdGate(); break;
    case 'resume': await cmdResume(); break;
    case 'report': cmdReport(); break;
    case 'doctor': cmdDoctor(); break;
    case 'scan': cmdScan(); break;
    case 'skills': cmdSkills(); break;
    case 'verify-zone': cmdVerifyZone(); break;
    case 'scope': cmdScope(); break;
    case 'run': cmdRun(); break;
    default:
      console.log(`harness — frontend Harness kernel for long-running AI coding

Usage:
  harness init [--stack node|nextjs|vue] [--host claude-code|codex|generic] [--force]
  harness new <feature> [--title "..."]
  harness clarify-done <feature>        Lock clarification (rubric coverage gate)
  harness next <feature> [--json]       The next action, derived from state alone (resume)
  harness task-done <feature> <taskId> [--sha <commit>]
  harness eval <feature> [--json]       Run rubric evaluation (veto rules apply), route the loop
  harness gate                          Run configured delivery-gate commands, fail-fast
  harness status [<feature>] [--json]
  harness resume <feature>              Human un-pause after a budget stop
  harness report <feature>              Markdown acceptance report
  harness doctor                        Environment + config checks
  harness scan [path] [--json] [--history <dir>]
                                        Standalone gate-engine scan (no init needed; CI-friendly);
                                        --history appends the report and prints the trend vs last run
  harness verify-zone [path]            Block if protected files changed without GATE_HUMAN_CONFIRM=yes
  harness scope <plan.md> [path]        Block if changes fall outside the plan's declared editable scope
  harness skills list                   List the bundled skills pack
  harness skills install [--project|--dir <path>] [--only a,b] [--force]
                                        Install the bundled skills pack (default: ~/.claude/skills)
  harness skills eval [--cases <path>] [--evidence <path>] [--min-accuracy 0.9]
                                        Emit the skill golden-set packet, or score returned evidence
  harness run <feature> [--agent claude-code|codex] [--agent-cmd "..."] [--max-steps 20] [--max-minutes 240] [--step-timeout 1800]
                                        Drive the loop unattended: kernel steps run directly,
                                        agent steps dispatch to the host agent CLI headless.
                                        Stops on done / paused / needs-human / stall / budget.`);
      if (cmd && cmd !== '--help' && cmd !== '-h') process.exit(1);
  }
} catch (e) {
  console.error(`harness: ${e.message}`);
  process.exit(1);
}
