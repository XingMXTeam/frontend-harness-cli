import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'harness.js');

function scan(fixture, extraArgs = []) {
  const dir = path.join(HERE, 'fixtures', fixture);
  const r = spawnSync(process.execPath, [BIN, 'scan', '--json', dir, ...extraArgs], {
    cwd: HERE,
    encoding: 'utf8',
  });
  assert.ok(r.stdout, r.stderr);
  return { report: JSON.parse(r.stdout), dir };
}

function findCheck(report, dim, name) {
  return report.dimensions[dim].checks.find((c) => c.name === name);
}

// ─── real compilation: the structure dimension stops guessing (v0.7) ──────
// The fixtures carry a stub `node_modules/.bin/tsc` (a shell script), so
// what is under test is the detection → execution → scoring chain, not
// tsc itself. Auto-detection requires tsconfig.json + a local tsc and
// never downloads anything; without either, compile stays neutral.

test('compile: auto-detected local tsc runs and verifies the dimension', () => {
  const { report } = scan('scan-compile-good');
  assert.equal(report.dimensions.structure.score, 100);
  const c = findCheck(report, 'structure', 'compile');
  assert.equal(c.passed, true);
  assert.match(c.message, /auto-detected local tsc/);
});

test('compile: a failing tsc deducts 40 and quotes the first error', () => {
  const { report } = scan('scan-compile-bad');
  assert.equal(report.dimensions.structure.score, 60);
  const c = findCheck(report, 'structure', 'compile');
  assert.equal(c.passed, false);
  assert.equal(c.points, 40);
  assert.match(c.message, /TS2322/);
});

test('compile: autoCompile=false keeps the check neutral even with tsc present', () => {
  const { report } = scan('scan-compile-off');
  assert.equal(report.dimensions.structure.score, 100);
  const c = findCheck(report, 'structure', 'compile');
  assert.equal(c.passed, null);
});

// ─── real test runs: the e2e dimension stops grading stale files (v0.7) ───
// e2e composition in these fixtures: run signal (weight 0.6) + presence
// (0.15, score 40 — no sibling tests) renormalized over 0.75, so a perfect
// run lands at 88 and a failed run at 8.

test('e2e: testCommand runs the suite and the produced results file is parsed', () => {
  const dir = path.join(HERE, 'fixtures', 'scan-testcmd-pass');
  const results = path.join(dir, 'results.json');
  rmSync(results, { force: true });
  const { report } = scan('scan-testcmd-pass');
  assert.ok(existsSync(results), 'the scan itself must have produced the results file');
  assert.equal(report.dimensions.e2e.score, 88);
  const c = findCheck(report, 'e2e', 'e2e-results');
  assert.equal(c.passed, true);
  assert.match(c.message, /all 3 test\(s\) passed/);
});

test('e2e: a failing command without a results file is an exit-code-only failure', () => {
  const { report } = scan('scan-testcmd-fail');
  assert.equal(report.dimensions.e2e.score, 8);
  const c = findCheck(report, 'e2e', 'e2e-failures');
  assert.equal(c.passed, false);
  assert.match(c.message, /exited 1/);
  assert.match(c.message, /exit-code|No results file/);
});

test('e2e: --run-tests detects package.json scripts.test; without it nothing runs', () => {
  const dir = path.join(HERE, 'fixtures', 'scan-runtests');
  const results = path.join(dir, 'results.json');
  rmSync(results, { force: true });
  const plain = scan('scan-runtests');
  assert.equal(plain.report.dimensions.e2e.score, 40, 'presence signal only — no run happened');
  assert.ok(!existsSync(results), 'no run, no results file');

  const withFlag = scan('scan-runtests', ['--run-tests']);
  assert.equal(withFlag.report.dimensions.e2e.score, 88);
  const c = findCheck(withFlag.report, 'e2e', 'e2e-results');
  assert.equal(c.passed, true);
  assert.match(c.message, /all 2 test\(s\) passed/);
});
