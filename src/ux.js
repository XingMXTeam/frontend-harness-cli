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

const STACK_RANK = { nextjs: 3, vue: 2, react: 1, node: 0 };

function stackOfPkg(pkg) {
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  if (deps.next) return { stack: 'nextjs', dep: 'next' };
  if (deps.vue || deps.nuxt) return { stack: 'vue', dep: deps.nuxt ? 'nuxt' : 'vue' };
  if (deps.react) return { stack: 'react', dep: 'react' };
  return null;
}

/** Workspace globs from package.json "workspaces" and pnpm-workspace.yaml. */
export function workspaceGlobs(root, pkg = readPkg(root)) {
  const globs = [];
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) globs.push(...ws);
  else if (Array.isArray(ws?.packages)) globs.push(...ws.packages);
  const pnpm = path.join(root, 'pnpm-workspace.yaml');
  if (existsSync(pnpm)) {
    let inPackages = false;
    for (const line of readFileSync(pnpm, 'utf8').split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
      if (inPackages) {
        const m = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/);
        if (m) globs.push(m[1].trim());
        else if (/^\S/.test(line)) inPackages = false;
      }
    }
  }
  return globs.filter((g) => g && !g.startsWith('!'));
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.harness', 'dist', 'build', '.next']);

function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name) && !d.name.startsWith('.'))
      .map((d) => path.join(dir, d.name));
  } catch { return []; }
}

/** Expand simple workspace globs ("apps/*", "packages/**", "web") to package dirs. */
function expandGlob(root, glob) {
  const parts = glob.replace(/\/+$/, '').split('/');
  let dirs = [root];
  for (const part of parts) {
    const next = [];
    for (const d of dirs) {
      if (part === '**') {
        const stack = [d];
        while (stack.length) { const cur = stack.pop(); next.push(cur); if (path.relative(root, cur).split(path.sep).length < 4) stack.push(...subdirs(cur)); }
      } else if (part.includes('*')) {
        const re = new RegExp(`^${part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
        next.push(...subdirs(d).filter((s) => re.test(path.basename(s))));
      } else next.push(path.join(d, part));
    }
    dirs = next;
  }
  return dirs.filter((d) => existsSync(path.join(d, 'package.json')));
}

export function detectStack(root) {
  const pkg = readPkg(root);
  const own = stackOfPkg(pkg);
  if (own) return { stack: own.stack, why: `${own.dep} in package.json` };

  // Monorepo: the framework usually lives in a sub-package, not the root.
  let globs = workspaceGlobs(root, pkg);
  const declared = globs.length > 0;
  if (!declared) globs = ['apps/*', 'packages/*'];
  const seen = new Set();
  let best = null;
  const found = [];
  for (const g of globs) {
    for (const dir of expandGlob(root, g)) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      const hit = stackOfPkg(readPkg(dir));
      if (!hit) continue;
      const rel = path.relative(root, dir).split(path.sep).join('/');
      found.push(`${hit.stack}@${rel}`);
      if (!best || STACK_RANK[hit.stack] > STACK_RANK[best.stack]) best = { ...hit, rel };
    }
  }
  if (best) {
    const others = found.filter((f) => f !== `${best.stack}@${best.rel}`);
    const more = others.length ? `; also ${others.slice(0, 3).join(', ')}${others.length > 3 ? ', …' : ''}` : '';
    return { stack: best.stack, why: `${best.dep} in ${best.rel}/package.json (monorepo${declared ? '' : ', apps/* or packages/*'})${more}` };
  }
  if (!pkg) return { stack: 'node', why: 'no package.json' };
  return { stack: 'node', why: seen.size ? `no next/vue/react in root or ${seen.size} workspace package(s)` : 'no next/vue/react dependency' };
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
- "Tests pass" is evidence only as a recorded \`${bin} verify\` run; cite its ids, never describe a run.
- After a feature is done, run \`${bin} learn\` and show the user any proposal; adopt only with their yes.
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

  fh verify               Run the project's verification checks (the evidence judges cite)
  fh learn                Repeated failures → rules the kernel enforces

Also: p(acket)  r(eport)  g(ate)  c(apture)  v(isual)  scan  doctor  skills
Every command keeps its long name (harness next <feature>, task-done, …).
Full reference: fh help --all`;
