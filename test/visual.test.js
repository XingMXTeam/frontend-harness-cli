import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'harness.js');

function scan(fixture) {
  const dir = path.join(HERE, 'fixtures', fixture);
  const r = spawnSync(process.execPath, [BIN, 'scan', '--json', dir], { cwd: HERE, encoding: 'utf8' });
  assert.ok(r.stdout, r.stderr);
  return { report: JSON.parse(r.stdout), dir };
}

function findCheck(report, name) {
  return report.dimensions.ui.checks.find((c) => c.name === name);
}

// ─── visual fidelity: the ui dimension compares pixels (v0.8) ─────────────
// The input is the comparison.json shape `harness visual` writes
// ({ results: [{ name, status, ratio, maxDiffRatio }] }). The comparison
// already applied its tolerance, so scan trusts each page's status:
// diff / size-mismatch deduct 8, no-baseline is neutral (unverified,
// not passed — the same semantics `harness visual` itself uses), and
// without the input nothing changes for zero-config scans.

test('visual: pages matching their baselines pass the ui dimension', () => {
  const { report } = scan('scan-visual-good');
  assert.equal(report.dimensions.ui.score, 100);
  const c = findCheck(report, 'visual-diff');
  assert.equal(c.passed, true);
  assert.match(c.message, /2 compared page\(s\)/);
});

test('visual: a diffed page and a resized page deduct 8 each', () => {
  const { report } = scan('scan-visual-bad');
  assert.equal(report.dimensions.ui.score, 84);
  const diff = findCheck(report, 'visual-diff');
  assert.equal(diff.passed, false);
  assert.match(diff.message, /ratio 0\.1832 exceeds the allowed 0\.01/);
  const size = findCheck(report, 'visual-size-mismatch');
  assert.equal(size.passed, false);
  assert.match(size.message, /1280x960/);
});

test('visual: a page without a baseline is neutral — unverified, not passed', () => {
  const { report } = scan('scan-visual-nobaseline');
  assert.equal(report.dimensions.ui.score, 100, 'no-baseline must not deduct');
  const c = findCheck(report, 'visual-baseline-missing');
  assert.equal(c.passed, null);
  assert.match(c.message, /home/);
});

test('visual: an unreadable results file reports neutral and deducts nothing', () => {
  const { report } = scan('scan-visual-broken');
  assert.equal(report.dimensions.ui.score, 100);
  const c = findCheck(report, 'visual-diff');
  assert.equal(c.passed, null);
});

test('visual: visualCommand refreshes the report before scoring', () => {
  const dir = path.join(HERE, 'fixtures', 'scan-visual-cmd');
  const results = path.join(dir, 'visual-results.json');
  rmSync(results, { force: true });
  const { report } = scan('scan-visual-cmd');
  assert.ok(existsSync(results), 'the scan itself must have produced the results file');
  const c = findCheck(report, 'visual-diff');
  assert.equal(c.passed, true);
});
