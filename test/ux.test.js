import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeArgv, detectStack, detectGateCommands, upsertBlock, protocolBlock } from '../src/ux.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'harness.js');
const fh = (cwd, ...args) => spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', HARNESS_ROLE: '' } });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function repo(pkg) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fh-ux-'));
  if (pkg) writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init', '--allow-empty');
  return dir;
}

function seedFeature(dir, feature, tasks = 1) {
  const d = path.join(dir, '.harness', 'tasks', feature);
  writeFileSync(path.join(d, 'tasks.json'), JSON.stringify(Array.from({ length: tasks }, (_, i) => ({ id: `TASK-${i + 1}`, title: `t${i + 1}`, requirements: ['REQ-1'], checks: [] }))));
  writeFileSync(path.join(d, 'vision.md'), 'REF-1: a.\nANTI-1: b.\nRL-1: c. (check: command)\nRL-2: d. (check: command)\n');
  writeFileSync(path.join(d, 'rubric.json'), JSON.stringify({ version: 1, feature, requirements: [{ id: 'REQ-1', description: 'x' }],
    qualityWaivers: [{ requirement: 'REQ-1', reason: 'test' }],
    items: [{ id: 'RB-1', requirement: 'REQ-1', level: 'essential', kind: 'grep', path: 'a.js', pattern: 'ok', expect: 'present', weight: 1 }] }));
}

test('aliases and current-feature injection', () => {
  const dir = repo();
  fh(dir, 'init', '--host', 'generic');
  fh(dir, 'new', 'alpha');
  assert.deepEqual(normalizeArgv(['node', 'fh', 'n'], dir).argv, ['node', 'fh', 'next', 'alpha']);
  assert.deepEqual(normalizeArgv(['node', 'fh', 'done', 'TASK-2'], dir).argv, ['node', 'fh', 'done', 'alpha', 'TASK-2']);
  assert.deepEqual(normalizeArgv(['node', 'fh', 'e', '--json'], dir).argv, ['node', 'fh', 'eval', 'alpha', '--json']);
  // an explicit feature (or a typo) is never rewritten
  assert.deepEqual(normalizeArgv(['node', 'fh', 'next', 'beta'], dir).argv, ['node', 'fh', 'next', 'beta']);
});

test('init detects stack, gate commands and wires the host', () => {
  const dir = repo({ dependencies: { next: '15' }, scripts: { lint: 'x', test: 'echo "Error: no test specified" && exit 1', build: 'y' } });
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  assert.equal(detectStack(dir).stack, 'nextjs');
  assert.deepEqual(detectGateCommands(dir), ['pnpm lint', 'pnpm build']);
  const r = fh(dir, 'init', '--host', 'claude-code');
  assert.equal(r.status, 0, r.stderr);
  const cfg = JSON.parse(readFileSync(path.join(dir, 'harness.config.json'), 'utf8'));
  assert.equal(cfg.stack, 'nextjs');
  assert.deepEqual(cfg.gateCommands, ['pnpm lint', 'pnpm build']);
  const settings = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.match(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /frontend-harness:start/);
  // idempotent: a second init neither duplicates the hook nor the block
  fh(dir, 'init', '--host', 'claude-code');
  assert.equal(JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).hooks.SessionStart.length, 1);
  assert.equal(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').split('frontend-harness:start').length, 2);
});

test('upsertBlock keeps the user\'s own text', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fh-md-'));
  const f = path.join(dir, 'AGENTS.md');
  writeFileSync(f, '# Mine\n\nkeep me\n');
  upsertBlock(f, protocolBlock());
  upsertBlock(f, protocolBlock('harness'));
  const txt = readFileSync(f, 'utf8');
  assert.match(txt, /keep me/);
  assert.match(txt, /`harness new/);
  assert.equal(txt.split('frontend-harness:start').length, 2);
});

test('fh done routes by phase and refuses a step without a new commit', () => {
  const dir = repo({ scripts: {} });
  fh(dir, 'init', '--host', 'generic');
  const cfg = JSON.parse(readFileSync(path.join(dir, 'harness.config.json'), 'utf8'));
  cfg.autoStop = { requiredStablePasses: 1 };
  writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify(cfg));
  fh(dir, 'new', 'alpha');
  seedFeature(dir, 'alpha', 2);
  let r = fh(dir, 'done');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Clarification locked/);

  r = fh(dir, 'done');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Commit this step/);

  writeFileSync(path.join(dir, 'a.js'), 'ok');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'task1');
  r = fh(dir, 'done');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /TASK-1 recorded done/);

  r = fh(dir, 'done', 'TASK-2');
  assert.notEqual(r.status, 0, 'same HEAD cannot be recorded twice');
  writeFileSync(path.join(dir, 'b.js'), 'ok');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'task2');
  r = fh(dir, 'done', 'TASK-2');
  assert.equal(r.status, 0, r.stderr);

  r = fh(dir, 'done'); // evaluate phase -> eval
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Evaluation: PASS/);
  assert.match(fh(dir).stdout, /\[done\]/);
});

test('bare fh outside a harness repo prints the short help', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fh-empty-'));
  const r = fh(dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /fh done/);
  assert.ok(!existsSync(path.join(dir, '.harness')));
});
