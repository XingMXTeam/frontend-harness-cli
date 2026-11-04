/**
 * verify.js — project verification as an asset, not a self-report.
 *
 * `.harness/verify.json` lists the checks that prove this project works
 * (typecheck, lint, unit, e2e, build …). `fh init` generates it from the
 * repo's scripts; humans edit it. `fh verify` runs every check and writes
 * `.harness/verify/last.json` — command, exit code, duration, HEAD sha,
 * timestamp, output tail — plus the full log per check.
 *
 * That record is what the kernel trusts:
 *   - a rubric item `{ kind: "verify", check: "e2e" }` runs the check itself;
 *   - judge evidence may cite `"verify": ["e2e"]`, and the kernel accepts it
 *     only if that check PASSED, at the current HEAD, after the latest work;
 *   - with `evidence.requireVerify`, a judge score above 0 that cites no
 *     verify run is not evidence and scores 0.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { HARNESS_DIR } from './config.js';
import { headSha, isGitRepo } from './git.js';

export const verifyFile = (root) => path.join(root, HARNESS_DIR, 'verify.json');
export const verifyDir = (root) => path.join(root, HARNESS_DIR, 'verify');
export const verifyLastFile = (root) => path.join(verifyDir(root), 'last.json');

const ID = /^[a-z0-9][a-z0-9:_-]*$/i;

function readPkg(root) {
  try { return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return null; }
}

/** Checks inferred from package.json scripts, strongest signal first. */
export function detectVerifyChecks(root) {
  const scripts = readPkg(root)?.scripts ?? {};
  const runner = existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm'
    : existsSync(path.join(root, 'yarn.lock')) ? 'yarn'
      : existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock')) ? 'bun'
        : 'npm';
  const run = (s) => (runner === 'npm' ? (s === 'test' ? 'npm test' : `npm run ${s}`) : `${runner} ${s}`);
  const table = [
    ['typecheck', ['typecheck', 'type-check', 'tsc'], 'types compile'],
    ['lint', ['lint'], 'lint is clean'],
    ['unit', ['test:unit', 'test'], 'unit tests pass'],
    ['e2e', ['test:e2e', 'e2e', 'playwright'], 'end-to-end journeys pass'],
    ['build', ['build'], 'production build succeeds'],
  ];
  const checks = [];
  for (const [id, names, description] of table) {
    const name = names.find((n) => scripts[n] && !(n === 'test' && /no test specified/.test(scripts[n])));
    if (name) checks.push({ id, command: run(name), description });
  }
  return checks;
}

/** The verify manifest, validated. null when the project has none. */
export function loadVerify(root) {
  const file = verifyFile(root);
  if (!existsSync(file)) return null;
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`.harness/verify.json is not valid JSON: ${e.message}`); }
  const checks = Array.isArray(raw.checks) ? raw.checks : null;
  if (!checks) throw new Error('.harness/verify.json needs a "checks" array.');
  const seen = new Set();
  for (const c of checks) {
    if (!c?.id || !ID.test(c.id)) throw new Error(`verify.json: check id "${c?.id ?? ''}" must match ${ID}.`);
    if (seen.has(c.id)) throw new Error(`verify.json: duplicate check id "${c.id}".`);
    seen.add(c.id);
    if (typeof c.command !== 'string' || !c.command.trim()) throw new Error(`verify.json: check "${c.id}" needs a command.`);
  }
  return { ...raw, checks };
}

export function loadVerifyLast(root) {
  try { return JSON.parse(readFileSync(verifyLastFile(root), 'utf8')); } catch { return { runs: {} }; }
}

/**
 * Run one check and record it. Every run — from `fh verify` or from a
 * `kind: "verify"` rubric item — lands in last.json, so a passing record
 * always means the kernel itself saw the command exit 0.
 */
export function runCheck(root, check, timeoutMs) {
  const started = Date.now();
  const r = spawnSync(check.command, { cwd: root, shell: true, encoding: 'utf8', timeout: check.timeoutMs ?? timeoutMs });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const run = {
    id: check.id,
    command: check.command,
    status: r.status === 0 ? 'passed' : 'failed',
    exitCode: r.status,
    durationMs: Date.now() - started,
    at: Date.now(),
    sha: isGitRepo(root) ? headSha(root) : null,
    tail: output.trim().split('\n').slice(-5).join('\n').slice(0, 600),
    log: path.join(HARNESS_DIR, 'verify', `${check.id.replace(/[^\w-]+/g, '_')}.log`),
  };
  mkdirSync(verifyDir(root), { recursive: true });
  writeFileSync(path.join(root, run.log), output);
  const last = loadVerifyLast(root);
  last.runs = { ...(last.runs ?? {}), [check.id]: run };
  last.updatedAt = run.at;
  writeFileSync(verifyLastFile(root), `${JSON.stringify(last, null, 2)}\n`);
  return run;
}

/** Run all checks (or the ones named). Not fail-fast: the record is the point. */
export function runVerify(root, timeoutMs, only = null) {
  const manifest = loadVerify(root);
  if (!manifest) throw new Error('No .harness/verify.json. Run `fh init` (it generates one from package.json scripts) or write it: {"checks":[{"id":"unit","command":"npm test"}]}');
  const wanted = only?.length ? only : manifest.checks.map((c) => c.id);
  const unknown = wanted.filter((id) => !manifest.checks.some((c) => c.id === id));
  if (unknown.length) throw new Error(`Unknown verify check(s): ${unknown.join(', ')} (have: ${manifest.checks.map((c) => c.id).join(', ')})`);
  const runs = manifest.checks.filter((c) => wanted.includes(c.id)).map((c) => runCheck(root, c, timeoutMs));
  return { passed: runs.every((r) => r.status === 'passed'), runs };
}

/**
 * Why cited verify runs are NOT acceptable evidence (empty = acceptable):
 * the check must exist, have passed, be at the current HEAD, and postdate
 * the latest work.
 */
export function verifyEvidenceProblems(root, ids, opts = {}) {
  const last = loadVerifyLast(root).runs ?? {};
  const sha = isGitRepo(root) ? headSha(root) : null;
  const problems = [];
  for (const id of ids) {
    const run = last[id];
    if (!run) { problems.push(`${id}: never run — fh verify --only ${id}`); continue; }
    if (run.status !== 'passed') { problems.push(`${id}: last run failed (exit ${run.exitCode})`); continue; }
    if (sha && run.sha && run.sha !== sha) { problems.push(`${id}: ran at ${run.sha.slice(0, 7)}, HEAD is ${sha.slice(0, 7)} — rerun`); continue; }
    if (opts.freshSince && run.at < opts.freshSince) problems.push(`${id}: ran before ${opts.freshReason ?? 'the latest change'} — rerun`);
  }
  return problems;
}
