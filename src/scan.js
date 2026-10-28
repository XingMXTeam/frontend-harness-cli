import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { evaluate, formatReport } from './gate/evaluate.js';
import { DEFAULT_CONFIG, mergeConfig } from './gate/config.js';

/**
 * The gate engine (vendored from ai-code-gate v0.5.0) as a sensor.
 *
 * Standalone, `harness scan` prints this sensor's own report — that output
 * is data, not a verdict. Inside the harness loop the ONLY verdict comes
 * from the rubric evaluation: rubric items of kind "scan" read one
 * dimension score from here and compare it with the item's minScore.
 * Two verdict systems would be two sources of truth; there is exactly one.
 */
export function loadScanConfig(targetRoot) {
  const file = path.join(targetRoot, 'gate.config.json');
  if (!existsSync(file)) return mergeConfig({});
  try {
    return mergeConfig(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    throw new Error(`gate.config.json in ${targetRoot} is not valid JSON: ${e.message}`);
  }
}

export function runScan(targetRoot, opts = {}) {
  const config = loadScanConfig(targetRoot);
  return evaluate(targetRoot, config, opts);
}

export { formatReport, DEFAULT_CONFIG as SCAN_DEFAULTS };
