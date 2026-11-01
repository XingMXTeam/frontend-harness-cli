import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzePrd } from '../src/prd.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'harness.js');

function run(cwd, args, expectOk = true) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
  if (expectOk && r.status !== 0) throw new Error(`harness ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  if (!expectOk && r.status === 0) throw new Error(`harness ${args.join(' ')} should have failed but passed:\n${r.stdout}`);
  return r;
}

function freshProject() {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-prd-test-'));
  run(dir, ['init', '--stack', 'node', '--host', 'generic']);
  return dir;
}

const PRD_GAPPED = `# Notice list PRD

## Requirements
- REQ-1: list shows notices newest first, unread titles bold
- REQ-2: clicking a notice marks it read
- REQ-4: empty list shows one sentence and a Refresh button

REQ-1 is the core of this feature.
`;

test('analyzePrd: extracts numbered requirements with their sentences', () => {
  const a = analyzePrd(PRD_GAPPED);
  assert.deepEqual(a.requirements.map((r) => r.id), ['REQ-1', 'REQ-2', 'REQ-4']);
  // the defining line (longest description) wins over a later prose mention
  assert.match(a.requirements[0].description, /newest first/);
  assert.equal(a.numberingComplete, false);
  assert.deepEqual(a.missing, ['REQ-3']);
});

test('analyzePrd: complete numbering and no-numbering documents', () => {
  const full = analyzePrd('REQ-1: a\nREQ-2: b\nREQ-3: c\n');
  assert.equal(full.numberingComplete, true);
  assert.deepEqual(full.missing, []);
  const none = analyzePrd('# PRD\n\nJust prose, no numbered requirements.\n');
  assert.deepEqual(none.requirements, []);
  assert.equal(none.numberingComplete, false);
});

test('new --prd: verbatim import, rubric seeded, shortened clarify', () => {
  const dir = freshProject();
  writeFileSync(path.join(dir, 'my-prd.md'), PRD_GAPPED);
  const r = run(dir, ['new', 'notice-list', '--prd', 'my-prd.md', '--json']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.prd.source, 'imported');
  assert.equal(out.prd.requirements, 3);
  assert.equal(out.prd.numberingComplete, false);
  assert.deepEqual(out.prd.missingNumbers, ['REQ-3']);

  const fdir = path.join(dir, '.harness', 'tasks', 'notice-list');
  assert.equal(readFileSync(path.join(fdir, 'prd.md'), 'utf8'), PRD_GAPPED, 'prd.md is the user document, byte for byte');
  const rubric = JSON.parse(readFileSync(path.join(fdir, 'rubric.json'), 'utf8'));
  assert.deepEqual(rubric.requirements.map((x) => x.id), ['REQ-1', 'REQ-2', 'REQ-4']);
  assert.match(rubric.requirements[0].description, /newest first/);
  for (const item of rubric.items) assert.equal(item.requirement, 'REQ-1');

  const state = JSON.parse(readFileSync(path.join(fdir, 'state.json'), 'utf8'));
  assert.equal(state.prd.source, 'imported');
  assert.ok(state.history.some((h) => h.event === 'prd-imported'));

  const next = JSON.parse(run(dir, ['next', 'notice-list', '--json']).stdout);
  assert.equal(next.prdImported, true);
  assert.match(next.instruction, /SHORTENED clarify/);
  assert.match(next.instruction, /never renumber|in place/);
});

test('new --prd: complete numbering seeds cleanly; missing file fails', () => {
  const dir = freshProject();
  writeFileSync(path.join(dir, 'full.md'), 'REQ-1: a\nREQ-2: b\n');
  const r = run(dir, ['new', 'feat-a', '--prd', 'full.md', '--json']);
  assert.equal(JSON.parse(r.stdout).prd.numberingComplete, true);

  run(dir, ['new', 'feat-b', '--prd', 'does-not-exist.md'], false);
  writeFileSync(path.join(dir, 'empty.md'), '   \n');
  run(dir, ['new', 'feat-c', '--prd', 'empty.md'], false);
});

test('new --prd: a PRD without numbering imports but flags it', () => {
  const dir = freshProject();
  writeFileSync(path.join(dir, 'plain.md'), '# PRD\n\nThe feature shows a list of notices.\n');
  const r = run(dir, ['new', 'plain-feat', '--prd', 'plain.md', '--json']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.prd.requirements, 0);
  assert.equal(out.prd.numberingComplete, false);
  const next = JSON.parse(run(dir, ['next', 'plain-feat', '--json']).stdout);
  assert.match(next.instruction, /no REQ-n numbering found/);
});

test('new without --prd is unchanged: no prd state, full clarify', () => {
  const dir = freshProject();
  run(dir, ['new', 'plain']);
  const fdir = path.join(dir, '.harness', 'tasks', 'plain');
  const state = JSON.parse(readFileSync(path.join(fdir, 'state.json'), 'utf8'));
  assert.equal(state.prd, undefined);
  const next = JSON.parse(run(dir, ['next', 'plain', '--json']).stdout);
  assert.equal(next.prdImported, undefined);
  assert.doesNotMatch(next.instruction, /SHORTENED/);
});
