import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'harness.config.json';
export const HARNESS_DIR = '.harness';

export const DEFAULT_CONFIG = {
  version: 1,
  host: 'claude-code', // claude-code | codex | generic — the CLI never runs an LLM itself
  stack: 'node', // node | nextjs | python — selects a standards pack + default checks
  // Commands run by `harness gate` (fail-fast, in order). Empty = no delivery gate.
  gateCommands: [],
  budgets: {
    maxMacroCycles: 5, // full plan->implement->evaluate rounds before pausing for a human
    maxTaskRetries: 3, // per-task fix attempts before that task is escalated
  },
  autoStop: {
    requiredStablePasses: 2, // consecutive passing evaluations (with gate green) required to finish
  },
  evaluation: {
    passScore: 0.9, // weighted rubric score required, ON TOP of the veto rules
    commandTimeoutMs: 120000,
  },
  git: {
    requireCommitPerTask: true, // every finished task must record a verifiable commit SHA
  },
};

export function configPath(root) {
  return path.join(root, CONFIG_FILE);
}

export function harnessDir(root) {
  return path.join(root, HARNESS_DIR);
}

export function featureDir(root, feature) {
  return path.join(root, HARNESS_DIR, 'tasks', feature);
}

export function loadConfig(root) {
  const file = configPath(root);
  if (!existsSync(file)) {
    throw new Error(`No ${CONFIG_FILE} in ${root}. Run "harness init" first.`);
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return deepMerge(structuredClone(DEFAULT_CONFIG), raw);
}

export function deepMerge(base, over) {
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}
