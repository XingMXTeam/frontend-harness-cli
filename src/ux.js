/**
 * ux.js — the ergonomics layer in front of the kernel.
 *
 * Nothing here changes what the kernel decides. It only removes typing:
 *   - short aliases (`fh n`, `fh e`, `fh p`) for the long command names
 *   - a remembered current feature (.harness/current) so <feature> is optional
 *   - `fh done`, one verb that routes to clarify-done / task-done /
 *     remediate-done / replan-done / eval by reading state, never by guessing
 *   - zero-flag `init`: stack, host and gate commands detected from the repo
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { HARNESS_DIR } from './config.js';

export const ALIASES = {
  n: 'next',
  s: 'status',
  st: 'status',
  e: 'eval',
  p: 'packet',
  r: 'report',
  g: 'gate',
  c: 'capture',
  v: 'visual',
  i: 'init',
  '-v': 'version',
  '--version': 'version',
  '-h': 'help',
  '--help': 'help',
};

/** Commands whose first positional argument is a feature name. */
export const FEATURE_COMMANDS = new Set([
  'next', 'eval', 'packet', 'report', 'capture', 'visual', 'run', 'resume',
  'clarify-done', 'task-done', 'remediate-done', 'replan-done', 'done',
]);

const currentFile = (root) => path.join(root, HARNESS_DIR, 'current');

export function listFeatures(root) {
  const dir = path.join(root, HARNESS_DIR, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => existsSync(path.join(dir, d, 'state.json'))).sort();
}

export function getCurrent(root) {
  const f = currentFile(root);
  if (existsSync(f)) {
    const name = readFileSync(f, 'utf8').trim();
    if (name && listFeatures(root).includes(name)) return name;
  }
  // Exactly one feature? That is the current one, no file needed.
  const all = listFeatures(root);
  return all.length === 1 ? all[0] : null;
}

export function setCurrent(root, feature) {
  mkdirSync(path.join(root, HARNESS_DIR), { recursive: true });
  writeFileSync(currentFile(root), `${feature}\n`);
}

/**
 * Rewrite argv so every kernel command sees the long name and an explicit
 * feature. Returns { argv, cmd, injected } — injected names the feature that
 * was filled in from .harness/current (for a one-line hint), or null.
 */
export function normalizeArgv(argv, root) {
  const out = argv.slice();
  let cmd = out[2];
  if (cmd && ALIASES[cmd]) cmd = out[2] = ALIASES[cmd];
  let injected = null;
  if (cmd && FEATURE_COMMANDS.has(cmd)) {
    const first = out[3];
    const features = listFeatures(root);
    // Fill in the current feature only when the slot is clearly not a feature
    // name: empty, a flag, or a task id. A typo stays a typo (and fails loudly).
    const missing = !first || first.startsWith('-') || (/^(TASK|T)-?\d+/i.test(first) && !features.includes(first));
    if (missing) {
      const cur = getCurrent(root);
      if (cur) { out.splice(3, 0, cur); injected = cur; }
    }
  }
  return { argv: out, cmd, injected };
}

// ─── init detection ──────────────────────────────────────────────────────────
function readPkg(root) {
  const f = path.join(root, 'package.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

export function detectStack(root) {
  const pkg = readPkg(root);
  if (!pkg) return { stack: 'node', why: 'no package.json' };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  if (deps.next) return { stack: 'nextjs', why: 'next in package.json' };
  if (deps.vue || deps.nuxt) return { stack: 'vue', why: `${deps.nuxt ? 'nuxt' : 'vue'} in package.json` };
  if (deps.react) return { stack: 'react', why: 'react in package.json' };
  return { stack: 'node', why: 'no next/vue/react dependency' };
}

export function detectHost(root, env = process.env) {
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return { host: 'claude-code', why: 'running inside Claude Code' };
  if (env.CODEX_HOME || env.CODEX_SANDBOX) return { host: 'codex', why: 'running inside Codex' };
  if (existsSync(path.join(root, '.claude')) || existsSync(path.join(root, 'CLAUDE.md'))) return { host: 'claude-code', why: '.claude/ or CLAUDE.md present' };
  if (existsSync(path.join(root, 'AGENTS.md')) || existsSync(path.join(root, '.codex'))) return { host: 'codex', why: 'AGENTS.md or .codex/ present' };
  return { host: 'claude-code', why: 'default' };
}

/** Pick the npm scripts a delivery gate should run, in a sensible order. */
export function detectGateCommands(root) {
  const pkg = readPkg(root);
  const scripts = pkg?.scripts ?? {};
  const runner = existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm'
    : existsSync(path.join(root, 'yarn.lock')) ? 'yarn'
      : existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock')) ? 'bun'
        : 'npm';
  const run = (s) => (runner === 'npm' ? (s === 'test' ? 'npm test' : `npm run ${s}`) : `${runner} ${s}`);
  if (scripts.gate) return [run('gate')];
  const picked = [];
  for (const s of ['typecheck', 'type-check', 'lint', 'test', 'build']) {
    if (!scripts[s]) continue;
    if (s === 'test' && /no test specified/.test(scripts[s])) continue;
    if (s === 'type-check' && scripts.typecheck) continue;
    picked.push(run(s));
  }
  return picked;
}

// ─── host wiring: make it actually load in a real repo ───────────────────────
export const BLOCK_START = '<!-- frontend-harness:start -->';
export const BLOCK_END = '<!-- frontend-harness:end -->';

export function protocolBlock(bin = 'fh') {
  return `${BLOCK_START}
## Feature work runs under frontend-harness

- For any feature work, first run \`${bin}\` (= \`${bin} next\`) and do exactly the action it returns.
- Start a feature with \`${bin} new <name>\` (or \`${bin} new <name> --prd <file>\`); it becomes the current feature.
- When a step is finished, run \`${bin} done\` — it records the right thing for the current phase
  (clarify, task, remediation, replan) and rejects work that has not earned it.
- Never edit \`.harness/tasks/*/state.json\` by hand, and never declare a feature done yourself:
  only a passing \`${bin} eval\` plus the delivery gate can set done.
- Ask the user only at the clarify confirmation and when the harness pauses.
${BLOCK_END}
`;
}

/** Insert or refresh the protocol block in an instructions file (CLAUDE.md / AGENTS.md). */
export function upsertBlock(file, block) {
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : '';
  let next;
  const s = prev.indexOf(BLOCK_START);
  const e = prev.indexOf(BLOCK_END);
  if (s >= 0 && e > s) next = prev.slice(0, s) + block.trimEnd() + prev.slice(e + BLOCK_END.length);
  else next = `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${prev ? '\n' : ''}${block}`;
  if (next === prev) return 'unchanged';
  writeFileSync(file, next);
  return prev ? 'updated' : 'created';
}

/** Register the SessionStart hook in .claude/settings.json without clobbering other settings. */
export function registerClaudeHook(root) {
  const file = path.join(root, '.claude', 'settings.json');
  const command = '$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh';
  let settings = {};
  if (existsSync(file)) {
    try { settings = JSON.parse(readFileSync(file, 'utf8')); } catch { return 'skipped (settings.json is not valid JSON)'; }
  }
  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  const already = settings.hooks.SessionStart.some((g) => (g.hooks ?? []).some((h) => h.command === command));
  if (already) return 'unchanged';
  settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command }] });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return 'registered';
}

export const SHORT_HELP = `fh — frontend harness: proof-gated AI feature work

Everyday (the feature is remembered; <feature> is optional):
  fh                      What to do now (= fh next)
  fh init                 Set up this repo — stack, host, gate auto-detected
  fh new <name> [--prd f] Start a feature and make it current
  fh done [TASK-n]        Record the finished step for the current phase
  fh e                    Evaluate (rubric + vetoes); routes the loop
  fh s                    Status of the current feature (fh s --all: every feature)
  fh use <name>           Switch the current feature
  fh run                  Drive the loop unattended with Claude Code / Codex

Also: p(acket)  r(eport)  g(ate)  c(apture)  v(isual)  scan  doctor  skills
Every command keeps its long name (harness next <feature>, task-done, …).
Full reference: fh help --all`;
