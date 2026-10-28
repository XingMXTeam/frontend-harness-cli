import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'harness.js');

function scan(fixture) {
  const r = spawnSync(process.execPath, [BIN, 'scan', '--json', path.join(HERE, 'fixtures', fixture)], {
    cwd: HERE,
    encoding: 'utf8',
  });
  assert.ok(r.stdout, r.stderr);
  return JSON.parse(r.stdout);
}

function dataChecks(report) {
  return report.dimensions.data.checks;
}

// ─── data-spec conformance: the data dimension gains a reference artifact ──
// Until v0.6 the data dimension could only check hygiene (secrets, URLs,
// storage keys) because there was nothing to compare the code against.
// With `inputs.dataSpec` set, TypeScript declarations are diffed against
// the contract field by field. Without the input, nothing changes — the
// ai-code-gate equivalence fixtures in unify.test.js pin that.

test('data-spec: matching declarations pass with every field compared', () => {
  const report = scan('scan-spec-good');
  assert.equal(report.dimensions.data.score, 100);
  const ok = dataChecks(report).find((c) => c.name === 'data-spec-conformant');
  assert.ok(ok, 'expected a data-spec-conformant check');
  assert.equal(ok.passed, true);
  assert.match(ok.message, /6 field\(s\) compared/);
});

test('data-spec: missing field, undeclared field and type drift each deduct', () => {
  const report = scan('scan-spec-bad');
  // 100 − 8 (field missing) − 6 (type mismatch) − 6 (field undeclared)
  assert.equal(report.dimensions.data.score, 80);
  const names = dataChecks(report).filter((c) => c.passed === false).map((c) => c.name);
  assert.deepEqual(names.sort(), [
    'data-spec-field-missing',
    'data-spec-field-undeclared',
    'data-spec-type-mismatch',
  ]);
});

test('data-spec: an unloadable spec reports neutral and deducts nothing', () => {
  const report = scan('scan-spec-broken');
  assert.equal(report.dimensions.data.score, 100);
  const neutral = dataChecks(report).find((c) => c.name === 'data-spec');
  assert.ok(neutral, 'expected a neutral data-spec check');
  assert.equal(neutral.passed, null);
});

test('data-spec: no type declarations in code reports neutral, not failure', () => {
  const report = scan('scan-spec-nodecl');
  assert.equal(report.dimensions.data.score, 100);
  const neutral = dataChecks(report).find((c) => c.name === 'data-spec');
  assert.ok(neutral, 'expected a neutral data-spec check');
  assert.equal(neutral.passed, null);
  assert.match(neutral.message, /no TypeScript interface\/type declarations/);
});
