import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runItem } from '../src/evaluate.js';
import { validateRubric } from '../src/rubric.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'harness.js');
const GOOD = path.join(HERE, 'fixtures', 'scan-good');
const BAD = path.join(HERE, 'fixtures', 'scan-bad');

function run(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

// ─── scan: equivalence with the original ai-code-gate v0.5.0 CLI ────────────
// Baselines below were captured from `ai-gate --json examples/{good,bad}`
// (commit 431bd94, v0.5.0) before vendoring. Identical scores on the copied
// fixtures prove the vendored engine behaves exactly like the original.

test('scan: good fixture scores 100 across the board and exits 0', () => {
  const r = run(HERE, ['scan', '--json', GOOD]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.totalScore, 100);
  assert.equal(report.passed, true);
  for (const dim of ['structure', 'data', 'logic', 'ui', 'e2e']) assert.equal(report.dimensions[dim].score, 100, dim);
});

test('scan: bad fixture reproduces the original scores exactly and exits 1', () => {
  const r = run(HERE, ['scan', '--json', BAD]);
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.totalScore, 64);
  assert.equal(report.passed, false);
  const dims = Object.fromEntries(Object.entries(report.dimensions).map(([k, v]) => [k, v.score]));
  assert.deepEqual(dims, { structure: 68, data: 69, logic: 75, ui: 78, e2e: 32 });
});

test('scan: works with no harness project around (zero config, no init)', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'harness-scan-'));
  const r = run(empty, ['scan', '--json', GOOD]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).totalScore, 100);
});

// ─── rubric kind=scan: sensor feeds the single verdict ──────────────────────

test('rubric scan item: passes when the dimension clears minScore', () => {
  const res = runItem(GOOD, { id: 'S1', kind: 'scan', dimension: 'structure', minScore: 85 }, 30000);
  assert.equal(res.score, 1);
  assert.match(res.detail, /structure=100/);
});

test('rubric scan item: fails when the dimension is below minScore', () => {
  const res = runItem(BAD, { id: 'S2', kind: 'scan', dimension: 'e2e', minScore: 60 }, 30000);
  assert.equal(res.score, 0);
  assert.match(res.detail, /e2e=32/);
});

test('rubric validation: scan items need a known dimension and numeric minScore', () => {
  const base = { version: 1, feature: 'x', requirements: [{ id: 'R1', description: 'd' }] };
  assert.throws(() => validateRubric({ ...base, items: [{ id: 'A', requirement: 'R1', level: 'essential', kind: 'scan', minScore: 50 }] }), /dimension/);
  assert.throws(() => validateRubric({ ...base, items: [{ id: 'A', requirement: 'R1', level: 'essential', kind: 'scan', dimension: 'nope', minScore: 50 }] }), /dimension/);
  assert.throws(() => validateRubric({ ...base, items: [{ id: 'A', requirement: 'R1', level: 'essential', kind: 'scan', dimension: 'ui' }] }), /minScore/);
});

// ─── skills pack ─────────────────────────────────────────────────────────────

const EXPECTED_SKILLS = ['bug-root-cause', 'component-from-design', 'context-map', 'deterministic-eval', 'i18n-extract', 'plan-before-code', 'ship-checklist', 'state-schema-first'];

test('skills list shows the 8 bundled skills', () => {
  const r = run(HERE, ['skills', 'list', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), EXPECTED_SKILLS);
});

test('skills install: installs all, re-run skips all, --only filters, unknown name fails', () => {
  const target = path.join(mkdtempSync(path.join(tmpdir(), 'harness-skills-')), 'skills');
  let r = run(HERE, ['skills', 'install', '--dir', target, '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).installed, EXPECTED_SKILLS);
  for (const name of EXPECTED_SKILLS) assert.ok(existsSync(path.join(target, name, 'SKILL.md')), name);

  r = run(HERE, ['skills', 'install', '--dir', target, '--json']);
  const second = JSON.parse(r.stdout);
  assert.deepEqual(second.installed, []);
  assert.deepEqual(second.skipped, EXPECTED_SKILLS);

  const target2 = path.join(mkdtempSync(path.join(tmpdir(), 'harness-skills-')), 'skills');
  r = run(HERE, ['skills', 'install', '--dir', target2, '--only', 'plan-before-code', '--json']);
  assert.deepEqual(JSON.parse(r.stdout).installed, ['plan-before-code']);
  assert.ok(existsSync(path.join(target2, 'plan-before-code', 'SKILL.md')));
  assert.ok(!existsSync(path.join(target2, 'context-map')));

  r = run(HERE, ['skills', 'install', '--dir', target2, '--only', 'does-not-exist']);
  assert.equal(r.status, 1);
});

test('init (claude-code) installs the harness skill AND the bundled pack', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-init-'));
  const r = run(dir, ['init', '--stack', 'node', '--host', 'claude-code']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(dir, '.claude', 'skills', 'harness', 'SKILL.md')));
  for (const name of EXPECTED_SKILLS) assert.ok(existsSync(path.join(dir, '.claude', 'skills', name, 'SKILL.md')), name);
});

test('init is idempotent: a second init skips the pack instead of duplicating', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-init-'));
  assert.equal(run(dir, ['init', '--stack', 'node', '--host', 'claude-code']).status, 0);
  const r = run(dir, ['init', '--stack', 'node', '--host', 'claude-code', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  for (const name of EXPECTED_SKILLS) assert.ok(out.skipped.includes(`.claude/skills/${name}`), name);
});
