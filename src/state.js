import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { featureDir } from './config.js';

export const PHASES = ['clarify', 'implement', 'evaluate', 'verify', 'done', 'paused'];

export function statePath(root, feature) {
  return path.join(featureDir(root, feature), 'state.json');
}

export function createState(feature, title = '') {
  const now = Date.now();
  return {
    version: 1,
    feature,
    title,
    phase: 'clarify',
    createdAt: now,
    updatedAt: now,
    macroCycle: { current: 1, max: null }, // max copied from config budgets at creation time
    consecutivePasses: 0,
    clarificationComplete: false,
    tasks: [], // { id, title, requirements: [], status: pending|done|failed, attempts, commitSha }
    history: [], // append-only phase/event records
    lastEvaluation: null, // { at, verdict, score, vetoed: [], reportPath }
    lastFailure: null,
  };
}

export function loadState(root, feature) {
  const file = statePath(root, feature);
  if (!existsSync(file)) {
    throw new Error(`No state for feature "${feature}". Run "harness new ${feature}" first.`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function saveState(root, state) {
  state.updatedAt = Date.now();
  const file = statePath(root, state.feature);
  mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename keeps a crash mid-write from corrupting the only resume record.
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(file, readFileSync(tmp, 'utf8'));
  rmSync(tmp, { force: true });
}

export function record(state, event) {
  state.history.push({ at: Date.now(), ...event });
}

export function appendFailureLog(root, feature, line) {
  const file = path.join(featureDir(root, feature), 'failure-log.md');
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `- ${new Date().toISOString()} ${line}\n`);
}

/** Simple advisory lock so two CLI invocations never interleave state writes. */
export function acquireLock(root, feature) {
  const lockFile = path.join(featureDir(root, feature), '.lock');
  mkdirSync(path.dirname(lockFile), { recursive: true });
  if (existsSync(lockFile)) {
    const { pid, at } = JSON.parse(readFileSync(lockFile, 'utf8'));
    const stale = Date.now() - at > 10 * 60 * 1000;
    if (!stale) {
      throw new Error(`Feature "${feature}" is locked by pid ${pid} (lock is ${Math.round((Date.now() - at) / 1000)}s old). If that process is gone, delete ${lockFile}.`);
    }
    rmSync(lockFile, { force: true });
  }
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }));
  return () => rmSync(lockFile, { force: true });
}

export async function withLock(root, feature, fn) {
  const release = acquireLock(root, feature);
  try {
    return await fn();
  } finally {
    release();
  }
}
