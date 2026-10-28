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
import { nextAction, applyEvaluation, checkCoverage, VERDICT_ROUTES } from '../src/orchestrate.js';
import { loadVision } from '../src/vision.js';
import { collectRefinements, recordRefinements, rubricFingerprint, rubricLevels, looseningChanges, checkDecisions } from '../src/refine.js';
import { ROLES, roleInstructions, stripFrontMatter } from '../src/roles.js';
import { capturePages, comparePages, loadDiffLibs, loadRunManifest, adoptBaselines, defaultBaselineDir, loadPages, MissingPeerError, DEFAULT_MIN_BYTES } from '../src/evidence.js';
import { isGitRepo, verifySha, headSha } from '../src/git.js';
import { runScan, formatReport, loadScanConfig } from '../src/scan.js';
import { verifyZone } from '../src/gate/zone.js';
import { checkScope } from '../src/gate/scope.js';
import { readPreviousReport, appendHistory, computeTrend } from '../src/gate/history.js';
import { scoreSkillEval } from '../src/skills-eval.js';
import { runLoop, AGENT_TEMPLATES, makeKernelExec, makeAgentExec, buildPacket } from '../src/run.js';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const DOCS_SRC = path.join(TEMPLATES, '..', 'docs'); // repo docs/ is the single source; init copies it to .harness/docs/
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

/**
 * Role guard. Under `harness run` every agent step carries HARNESS_ROLE.
 * Kernel commands that record another role's result refuse to run inside
 * the wrong role — the evaluator cannot mark tasks done, the developer
 * cannot score its own work, nobody but the orchestrator runs eval.
 */
function requireRole(command, allowed) {
  const role = process.env.HARNESS_ROLE;
  if (!role) return; // interactive / orchestrator context
  if (!allowed.includes(role)) fail(`\`harness ${command}\` is not available to the ${role} role (allowed: ${allowed.length ? allowed.join(', ') : 'orchestrator only'}). Finish your step and return; the orchestrator runs the next command.`);
}
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
  if (!['node', 'nextjs', 'vue', 'react'].includes(stack)) fail(`Unknown stack "${stack}" (node|nextjs|vue|react).`);
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
  if (stack === 'react') config.gateCommands = ['npm test'];
  write(configPath(root), `${JSON.stringify(config, null, 2)}\n`);

  mkdirSync(harnessDir(root), { recursive: true });
  const standardsSrc = path.join(TEMPLATES, 'standards', `${stack}.md`);
  const standardsDst = path.join(harnessDir(root), 'standards.md');
  if (existsSync(standardsDst) && !force) skipped.push(path.relative(root, standardsDst));
  else { copyFileSync(standardsSrc, standardsDst); made.push(path.relative(root, standardsDst)); }

  // Shared docs the skills and role agents cite (.harness/docs/*.md).
  for (const doc of readdirSync(DOCS_SRC).filter((f) => f.endsWith('.md'))) {
    const dst = path.join(harnessDir(root), 'docs', doc);
    if (existsSync(dst) && !force) skipped.push(path.relative(root, dst));
    else { mkdirSync(path.dirname(dst), { recursive: true }); copyFileSync(path.join(DOCS_SRC, doc), dst); made.push(path.relative(root, dst)); }
  }

  if (host === 'claude-code') {
    for (const role of ROLES) {
      const dst = path.join(root, '.claude', 'agents', `${role}.md`);
      if (existsSync(dst) && !force) skipped.push(path.relative(root, dst));
      else { mkdirSync(path.dirname(dst), { recursive: true }); copyFileSync(path.join(TEMPLATES, 'claude-code', 'agents', `${role}.md`), dst); made.push(path.relative(root, dst)); }
    }
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
      '# Claude Code host setup\n\nRegister the session-start hook in `.claude/settings.json`:\n\n```json\n{\n  "hooks": {\n    "SessionStart": [{ "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh" }] }]\n  }\n}\n```\n\nThe `harness` skill is already installed at `.claude/skills/harness/SKILL.md`, the three role agents (planner, developer, evaluator) at `.claude/agents/`, and the bundled skills pack (the authoring chain clarify-requirements → write-acceptance-criteria, implement-task, e2e-testing, …) alongside them. Manage the pack with `harness skills list|install`.\n\nThe main session is the orchestrator: it runs `harness next`, dispatches the role agent the action names (`harness packet <feature>` prints that agent\'s input), and runs the kernel commands. It does not do role work itself.\n');
  } else {
    // Instruction-level role definitions: same text, no host front matter.
    for (const role of ROLES) write(path.join(harnessDir(root), 'agents', `${role}.md`), `${roleInstructions(role)}\n`);
    write(path.join(harnessDir(root), 'protocol.md'), `${stripFrontMatter(readFileSync(path.join(TEMPLATES, 'claude-code', 'SKILL.md'), 'utf8')).trim()}\n`);
    write(path.join(harnessDir(root), 'host-setup.md'),
      `# Host setup (${host})\n\nAdd this to your agent instructions file (AGENTS.md or equivalent):\n\n> At the start of every session run \`harness next <feature>\` and follow the returned action. The rules are in \`.harness/protocol.md\`. Each action belongs to one role — clarify/replan: planner, implement-task/remediate: developer, evaluate/confirm-evaluation: evaluator — whose instructions are in \`.harness/agents/<role>.md\`. When your host supports separate sessions or sub-agents, run each role in its own context and give it only \`harness packet <feature>\`. Never stop at a summary: after every verdict, run the next action.\n\nThe authoring and evaluation skills are installable with \`harness skills install --dir <your skills dir>\`; their text is plain Markdown any host can read.\n`);
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
    // Lock the contract: later replans may tighten it, loosening needs a human.
    state.rubricBaseline = rubricLevels(loadRubric(root, feature));
    state.rubricHash = rubricFingerprint(root, feature);
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
  requireRole('task-done', ['developer']);
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
  requireRole('eval', []);
  const config = loadConfig(root);
  let verdict = null;
  await withLock(root, feature, async () => {
    const state = loadState(root, feature);
    if (!state.clarificationComplete) fail('Clarification is not complete; evaluation has no anchor yet. Finish clarify, then harness clarify-done.');
    const { ok, gaps } = checkCoverage(root, state);
    if (!ok) fail(`Rubric coverage gate failed:\n${gaps.map((g) => `  - ${g.requirement}: ${g.problem}`).join('\n')}`);
    const pendingTasks = state.tasks.filter((t) => t.status !== 'done');
    if (pendingTasks.length) {
      fail(`Not all tasks are recorded done yet (${pendingTasks.map((t) => t.id).join(', ')}). Evaluation runs on completed work: harness next ${feature}`);
    }
    if (state.pendingRefinements?.length && state.remediation?.length) {
      fail(`${state.pendingRefinements.length} rubric refinement suggestion(s) are unanswered. The planner replans first: harness next ${feature}`);
    }
    const rubric = loadRubric(root, feature);
    // Judge evidence must postdate the work it judges and the previous
    // evaluation — a confirmation pass cannot reuse the last pass's notes.
    const lastWork = [...state.history].reverse().find((h) => ['task-done', 'remediation-fixed', 'replanned'].includes(h.event));
    const candidates = [
      lastWork ? { at: lastWork.at, why: `${lastWork.event}${lastWork.task ? ` ${lastWork.task}` : ''}` } : null,
      state.lastEvaluation ? { at: state.lastEvaluation.at, why: 'the previous evaluation' } : null,
    ].filter(Boolean).sort((a, b) => b.at - a.at);
    const fresh = candidates[0] ?? null;
    const evaluation = evaluateRubric(root, rubric, config, {
      freshSince: fresh?.at ?? null,
      freshReason: fresh?.why ?? null,
      vision: loadVision(root, feature),
    });

    // Rubric evolution: the evaluator's suggestions are recorded, never lost.
    const refinements = collectRefinements(root, feature, rubric);
    const added = recordRefinements(state, refinements.found, evaluation.at);
    evaluation.refinementSuggestions = { added: added.map((a) => a.id), pending: (state.pendingRefinements ?? []).map((a) => a.id), invalid: refinements.invalid };
    if (added.length) record(state, { event: 'rubric-refinements-recorded', ids: added.map((a) => a.id) });
    const reportFile = writeReport(root, feature, evaluation);

    const willFinish = state.phase === 'verify' || state.consecutivePasses + 1 >= config.autoStop.requiredStablePasses;
    const gateResult = evaluation.verdict === 'pass' && willFinish
      ? runGateCommands(root, config)
      : { passed: true, failedAt: null, steps: [], skipped: true };
    const routing = applyEvaluation(root, state, config, evaluation, gateResult);
    saveState(root, state);
    const next = nextAction(root, state, config);
    routing.next = next.action;
    verdict = evaluation.verdict;
    print({ evaluation, gate: gateResult, routing, reportFile: path.relative(root, reportFile) },
      `Evaluation: ${evaluation.verdict.toUpperCase()} score=${evaluation.score} (pass >= ${evaluation.passScore})${evaluation.layers ? ` layers ${Object.entries(evaluation.layers).map(([k, v]) => `${k}=${v.score}`).join(' ')}` : ''}${evaluation.vetoed.length ? `\nVETOED: ${evaluation.vetoed.map((v) => `${v.id} — ${v.reason}`).join('; ')}` : ''}${added.length ? `\nRubric refinement suggestions recorded: ${added.map((a) => a.id).join(', ')}` : ''}${refinements.invalid.length ? `\nIgnored malformed suggestions: ${refinements.invalid.map((i) => `${i.source}: ${i.error}`).join('; ')}` : ''}\nRouted: ${routing.routed}${routing.reason ? ` (${routing.reason})` : ''}\nReport: ${path.relative(root, reportFile)}\nPhase now: ${state.phase}. ${next.action === 'none' ? 'Feature done — report it: harness report ' + feature : next.action === 'human-decision' ? 'Paused — surface the reason to the user.' : `Next action: ${next.action} — dispatch it now; do not stop at this summary.`}`);
  });
  if (verdict !== 'pass') process.exitCode = 1;
}

// ─── remediate-done / replan-done ────────────────────────────────────────────
async function cmdRemediateDone() {
  const feature = process.argv[3];
  if (!feature) fail('Usage: harness remediate-done <feature> [--sha <commit>]');
  requireRole('remediate-done', ['developer']);
  const config = loadConfig(root);
  await withLock(root, feature, async () => {
    const state = loadState(root, feature);
    if (!state.remediation?.length) fail(`Feature "${feature}" has no open remediation items.`);
    let sha = arg('--sha');
    if (isGitRepo(root) && config.git.requireCommitPerTask) {
      if (!sha) fail('This is a git repo and requireCommitPerTask is on: commit the fix precisely, then pass --sha <commit>.');
      if (!verifySha(root, sha)) fail(`Commit SHA "${sha}" does not verify in this repo (git rev-parse --verify failed). Placeholder SHAs are not accepted.`);
      sha = sha.toLowerCase();
    }
    state.remediationFixedAt = Date.now();
    record(state, { event: 'remediation-fixed', items: state.remediation, commitSha: sha ?? null });
    saveState(root, state);
    print({ ok: true, feature, items: state.remediation, commitSha: sha ?? null }, `Remediation of ${state.remediation.join(', ')} recorded${sha ? ` @ ${sha}` : ''}. Next: a fresh evaluator judges it — harness next ${feature}`);
  });
}

async function cmdReplanDone() {
  const feature = process.argv[3];
  if (!feature) fail('Usage: harness replan-done <feature>');
  requireRole('replan-done', ['planner']);
  await withLock(root, feature, async () => {
    const state = loadState(root, feature);
    const pending = state.pendingRefinements ?? [];
    if (!pending.length) fail(`Feature "${feature}" has no pending rubric refinement suggestions to answer.`);
    const decisionsFile = path.join(featureDir(root, feature), 'replan-decisions.json');
    if (!existsSync(decisionsFile)) fail(`Write ${path.relative(root, decisionsFile)}: [{"id": "RS-1", "decision": "accepted"|"rejected", "note": "..."}] — one entry per pending suggestion (${pending.map((p) => p.id).join(', ')}).`);
    let decisions;
    try { decisions = JSON.parse(readFileSync(decisionsFile, 'utf8')); } catch (e) { fail(`replan-decisions.json is not valid JSON: ${e.message}`); }
    const check = checkDecisions(pending, decisions);
    if (!check.ok) fail(`Replan is incomplete:\n${check.problems.map((p) => `  - ${p}`).join('\n')}`);

    const { ok, gaps, rubric } = checkCoverage(root, state);
    if (!ok) fail(`Rubric coverage gate failed after replan:\n${gaps.map((g) => `  - ${g.requirement}: ${g.problem}`).join('\n')}`);
    const loosened = looseningChanges(state.rubricBaseline, rubric);
    if (loosened.length && process.env.GATE_HUMAN_CONFIRM !== 'yes') {
      fail(`The replan loosens the locked rubric:\n${loosened.map((l) => `  - ${l}`).join('\n')}\nThe rubric may only tighten automatically. A human reviews the diff and re-runs with GATE_HUMAN_CONFIRM=yes.`);
    }
    const accepted = pending.filter((p) => check.byId.get(p.id).decision === 'accepted');
    const hash = rubricFingerprint(root, feature);
    const tasksFile = path.join(featureDir(root, feature), 'tasks.json');
    const defs = JSON.parse(readFileSync(tasksFile, 'utf8'));
    const known = new Set(state.tasks.map((t) => t.id));
    const newTasks = defs.filter((t) => !known.has(t.id));
    if (accepted.length && hash === state.rubricHash && newTasks.length === 0) {
      fail(`${accepted.length} suggestion(s) marked accepted but rubric.json and tasks.json are unchanged. Apply them, or reject them with a reason.`);
    }
    for (const t of newTasks) state.tasks.push({ id: t.id, title: t.title, requirements: t.requirements ?? [], status: 'pending', attempts: 0, commitSha: null });
    state.refinementLog ??= [];
    for (const p of pending) state.refinementLog.push({ ...p, decision: check.byId.get(p.id).decision, note: check.byId.get(p.id).note ?? null, decidedAt: Date.now() });
    state.pendingRefinements = [];
    state.rubricBaseline = rubricLevels(rubric);
    state.rubricHash = hash;
    record(state, { event: 'replanned', accepted: accepted.map((a) => a.id), rejected: pending.filter((p) => !accepted.includes(p)).map((p) => p.id), newTasks: newTasks.map((t) => t.id), loosenedWithHuman: loosened.length ? loosened : undefined });
    saveState(root, state);
    print({ ok: true, feature, accepted: accepted.map((a) => a.id), newTasks: newTasks.map((t) => t.id) },
      `Replan recorded for "${feature}": ${accepted.length} accepted, ${pending.length - accepted.length} rejected, ${newTasks.length} new task(s). Rubric coverage OK. Next: harness next ${feature}`);
  });
}

// ─── packet: the role-scoped input for the next agent step ───────────────────
function cmdPacket() {
  const feature = process.argv[3];
  if (!feature) fail('Usage: harness packet <feature> [--json]');
  const config = loadConfig(root);
  const state = loadState(root, feature);
  const action = nextAction(root, state, config);
  const packet = buildPacket(root, state, action);
  print(packet, `Role: ${packet.role ?? '(kernel / human step)'}\nAction: ${packet.action}\n${JSON.stringify(packet, null, 2)}`);
}

// ─── capture / visual: real screenshots + pixel diff ─────────────────────────
async function cmdCapture() {
  const feature = process.argv[3];
  if (!feature) fail('Usage: harness capture <feature> [--base-url <url>] [--run-id <id>] [--pages <file>] [--min-bytes 2048] [--allow-fallback] [--skip-probe]');
  loadState(root, feature);
  let manifest;
  try {
    manifest = await capturePages(root, feature, {
      baseUrl: arg('--base-url'),
      runId: arg('--run-id'),
      pagesFile: arg('--pages'),
      minBytes: Number(arg('--min-bytes', String(DEFAULT_MIN_BYTES))),
      allowFallback: has('--allow-fallback'),
      skipProbe: has('--skip-probe'),
    });
  } catch (e) {
    if (e instanceof MissingPeerError) fail(e.message);
    throw e;
  }
  const bad = manifest.pages.filter((p) => !p.ok);
  print(manifest, `Capture ${manifest.status.toUpperCase()} — ${manifest.pages.length - bad.length}/${manifest.pages.length} page(s) valid (min ${manifest.minBytes}B PNG) -> ${manifest.dir}/${bad.length ? `\n${bad.map((p) => `  ✗ ${p.name} ${p.route}: ${p.error}${p.usedFallback ? ' [placeholder written]' : ''}`).join('\n')}` : ''}${manifest.note ? `\n${manifest.note}` : ''}`);
  if (manifest.status === 'fail') process.exitCode = 1;
}

async function cmdVisual() {
  const feature = process.argv[3];
  if (!feature) fail('Usage: harness visual <feature> [--run-id <id>|latest] [--update-baseline] [--max-diff-ratio 0.01] [--threshold 0.1]');
  loadState(root, feature);
  const { manifest, runDir } = loadRunManifest(root, feature, arg('--run-id', 'latest'));
  let cfgBaseline = null;
  try { cfgBaseline = loadPages(root, feature).baselineDir; } catch { /* pages optional here */ }
  const baselineDir = cfgBaseline ? path.resolve(root, cfgBaseline) : defaultBaselineDir(root);
  if (has('--update-baseline')) {
    const adopted = adoptBaselines(root, manifest, runDir, baselineDir);
    print({ adopted, baselineDir: path.relative(root, baselineDir), fromRun: manifest.runId }, `Adopted ${adopted.length} baseline(s) from run ${manifest.runId} -> ${path.relative(root, baselineDir)}/ (review them; commit them with the change that justified them).`);
    return;
  }
  if (manifest.status !== 'pass') fail(`Run ${manifest.runId} has status "${manifest.status}" — it is not evidence, so there is nothing valid to compare. Re-run harness capture.`);
  let result;
  try {
    result = await comparePages({
      pages: manifest.pages,
      runDir,
      baselineDir,
      maxDiffRatio: Number(arg('--max-diff-ratio', '0.01')),
      threshold: Number(arg('--threshold', '0.1')),
      load: () => loadDiffLibs(root),
    });
  } catch (e) {
    if (e instanceof MissingPeerError) fail(e.message);
    throw e;
  }
  const out = { feature, runId: manifest.runId, baselineDir: path.relative(root, baselineDir), ...result };
  writeFileSync(path.join(runDir, 'comparison.json'), `${JSON.stringify(out, null, 2)}\n`);
  const lines = result.results.map((r) => `  ${r.status === 'match' ? '✓' : r.status === 'no-baseline' ? '?' : '✗'} ${r.name} ${r.status}${r.ratio !== undefined ? ` ratio=${r.ratio} (max ${r.maxDiffRatio})` : ''}${r.detail ? ` ${r.detail}` : ''}`);
  print(out, `Visual ${result.verdict.toUpperCase()} — run ${manifest.runId} vs ${path.relative(root, baselineDir)}/\n${lines.join('\n')}${result.verdict === 'no-baseline' ? `\nNOT a pass: ${result.noBaseline.length} page(s) have no baseline. Review the screenshots, then adopt them explicitly: harness visual ${feature} --update-baseline` : ''}`);
  if (result.verdict === 'fail') process.exitCode = 1;
  else if (result.verdict === 'no-baseline') process.exitCode = 2;
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
    lines.push('', `## Last evaluation`, `- Verdict: **${ev.verdict}**, score ${ev.score} (pass >= ${ev.passScore})${ev.layers ? ` — ${Object.entries(ev.layers).map(([k, v]) => `${k} ${v.score}×${v.weight}`).join(', ')}` : ''}`,
      ...(ev.vetoed.length ? ev.vetoed.map((v) => `- VETO ${v.id}: ${v.reason}`) : ['- No vetoes']),
      ...ev.results.filter((r) => r.score < 1).map((r) => `- Open ${r.id} (${r.level}): ${r.detail}`));
  }
  if (state.pendingRefinements?.length || state.refinementLog?.length) {
    lines.push('', '## Rubric refinements',
      ...(state.pendingRefinements ?? []).map((r) => `- ⏳ ${r.id} [${r.type}] ${r.item}: ${r.suggestion}`),
      ...(state.refinementLog ?? []).map((r) => `- ${r.decision === 'accepted' ? '✅' : '✖'} ${r.id} [${r.type}] ${r.item}: ${r.suggestion}${r.note ? ` — ${r.note}` : ''}`));
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
    case 'remediate-done': await cmdRemediateDone(); break;
    case 'replan-done': await cmdReplanDone(); break;
    case 'packet': cmdPacket(); break;
    case 'capture': await cmdCapture(); break;
    case 'visual': await cmdVisual(); break;
    case 'routes': print(VERDICT_ROUTES, VERDICT_ROUTES.map((r) => `${r.when}\n    -> phase ${r.phase}, next ${r.next} (${r.who})`).join('\n')); break;
    default:
      console.log(`harness — frontend Harness kernel for long-running AI coding

Usage:
  harness init [--stack node|nextjs|vue|react] [--host claude-code|codex|generic] [--force]
  harness new <feature> [--title "..."]
  harness clarify-done <feature>        Lock clarification (rubric coverage gate)
  harness next <feature> [--json]       The next action, derived from state alone (resume)
  harness task-done <feature> <taskId> [--sha <commit>]
  harness remediate-done <feature> [--sha <commit>]
                                        Record a remediation fix; a fresh evaluator judges it next
  harness replan-done <feature>         Record the planner's answers to rubric refinement suggestions
                                        (replan-decisions.json); the rubric may only tighten
  harness packet <feature> [--json]     The role-scoped input for the next agent step
  harness routes                        The fixed verdict -> next-step table
  harness capture <feature> [--base-url <url>] [--run-id <id>] [--allow-fallback] [--min-bytes 2048]
                                        Playwright screenshots of pages.json routes; <min-bytes or
                                        non-PNG fails; placeholders only with --allow-fallback
  harness visual <feature> [--run-id <id>] [--update-baseline] [--max-diff-ratio 0.01]
                                        Pixel diff (pixelmatch) vs baselines; no baseline is
                                        reported as no-baseline (exit 2), never as a pass
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
