// E2E dimension: a transparent composite of up to three signals —
//
//   run       a real test run's pass rate (strongest claim)
//   coverage  mean istanbul coverage percentage
//   presence  share of source files with a sibling test (weakest)
//
// Weights live in rules.e2e.weights and renormalize over the signals
// that are actually available. Each signal becomes a named check whose
// points are exactly its weighted share of the total deduction, so the
// score always decomposes — no hidden math.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCoverage, parseTestResults } from "../artifacts.js";
import { check, violation } from "./shared.js";

function loadArtifact(root, rel) {
  try {
    return { data: JSON.parse(readFileSync(join(root, rel), "utf8")) };
  } catch (err) {
    return { error: err.message };
  }
}

function runSignal(ctx, neutralNotes) {
  const rel = ctx.inputs?.testResults || ctx.inputs?.e2eResults;
  if (!rel) {
    neutralNotes.push(check("e2e-results", null, "No testResults input — the run signal is absent; scoring falls back to coverage/presence signals. Provide a results file ({passed, failed}, Jest/Vitest JSON, or a Playwright JSON report) for run-based scoring."));
    return null;
  }
  const { data, error } = loadArtifact(ctx.root, rel);
  if (error) {
    neutralNotes.push(check("e2e-results", null, `Test results could not be loaded (${error}) — run signal unverified.`));
    return null;
  }
  const parsed = parseTestResults(data);
  if (!parsed) {
    neutralNotes.push(check("e2e-results", null, "Test results file format not recognized (expected {passed, failed}, Jest/Vitest JSON, or Playwright JSON) — run signal unverified."));
    return null;
  }
  if (parsed.total === 0) {
    neutralNotes.push(check("e2e-results", null, "Test results contain no tests — run unverified."));
    return null;
  }
  return {
    key: "run",
    score: Math.round((parsed.passed / parsed.total) * 1000) / 10,
    parsed,
    rel,
  };
}

function coverageSignal(ctx, neutralNotes) {
  const rel = ctx.inputs?.coverage;
  if (!rel) return null;
  const { data, error } = loadArtifact(ctx.root, rel);
  const parsed = error ? null : parseCoverage(data);
  if (!parsed) {
    neutralNotes.push(check("e2e-coverage", null, `Coverage summary could not be loaded or parsed (${error || "not an istanbul coverage-summary.json"}) — coverage signal unverified.`));
    return null;
  }
  return { key: "coverage", score: parsed.mean, parsed, rel };
}

function presenceSignal(files, rules, isTestFile) {
  const sources = files.filter((f) => !isTestFile(f.rel));
  const tests = files.filter((f) => isTestFile(f.rel));
  const testBaseNames = new Set(
    tests.map((f) => f.rel.split("/").pop().replace(/\.(test|spec)\./, "."))
  );
  let covered = 0;
  const uncovered = [];
  for (const src of sources) {
    const base = src.rel.split("/").pop();
    if (testBaseNames.has(base)) covered += 1;
    else uncovered.push(src.rel);
  }
  const ratio = sources.length === 0 ? 1 : covered / sources.length;
  const score = ratio >= rules.targetTestRatio
    ? 100
    : 100 - Math.round(60 * (1 - ratio / rules.targetTestRatio));
  return { key: "presence", score, ratio, covered, total: sources.length, uncovered };
}

function signalCheck(signal, points, rules) {
  const p = signal.parsed;
  if (signal.key === "run") {
    if (p.failed > 0) {
      return violation("e2e-failures", `Test run (${p.format} format): ${p.passed}/${p.total} passed, ${p.failed} failed — pass rate ${signal.score}%. A red run is a red run, however good the code looks.`, signal.rel, points);
    }
    return check("e2e-results", true, `Test run (${p.format} format): all ${p.total} test(s) passed.`);
  }
  if (signal.key === "coverage") {
    const detail = `lines ${p.lines}%, statements ${p.statements}%, functions ${p.functions}%, branches ${p.branches}%`;
    if (points > 0) {
      return violation("e2e-coverage", `Coverage mean ${p.mean}% (${detail}). Uncovered code is unverified code; the gap is weighted into the e2e score.`, signal.rel, points);
    }
    return check("e2e-coverage", true, `Coverage mean ${p.mean}% (${detail}).`);
  }
  if (signal.ratio < rules.targetTestRatio) {
    return violation("low-test-presence", `Only ${signal.covered}/${signal.total} source files have a sibling test (target ratio ${rules.targetTestRatio}). Uncovered: ${signal.uncovered.slice(0, 5).join(", ")}${signal.uncovered.length > 5 ? ", …" : ""}.`, "(project)", points);
  }
  return check("test-presence", true, `${signal.covered}/${signal.total} source files have a sibling test (ratio ${signal.ratio.toFixed(2)} ≥ ${rules.targetTestRatio}).`);
}

export function checkE2e(files, rules, isTestFile, ctx = {}) {
  const neutralNotes = [];
  const signals = [
    runSignal(ctx, neutralNotes),
    coverageSignal(ctx, neutralNotes),
    presenceSignal(files, rules, isTestFile),
  ].filter(Boolean);

  const weights = rules.weights || { run: 0.6, coverage: 0.25, presence: 0.15 };
  const totalWeight = signals.reduce((sum, s) => sum + (weights[s.key] || 0), 0) || 1;
  const raw = signals.map((s) => ((weights[s.key] || 0) / totalWeight) * (100 - s.score));
  const points = raw.map((r) => Math.round(r));
  // Rounding must not invent or lose points: pin the total deduction.
  const target = Math.round(raw.reduce((a, b) => a + b, 0));
  let diff = target - points.reduce((a, b) => a + b, 0);
  if (diff !== 0 && points.length > 0) {
    const idx = raw.indexOf(Math.max(...raw));
    points[idx] += diff;
  }

  const checks = [...neutralNotes];
  signals.forEach((s, i) => checks.push(signalCheck(s, points[i], rules)));
  return checks;
}
