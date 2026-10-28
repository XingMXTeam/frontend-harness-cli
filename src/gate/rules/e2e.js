// E2E dimension: a transparent composite of up to three signals —
//
//   run       a real test run's pass rate (strongest claim). Since v0.7
//             the scan can produce this run itself (inputs.testCommand,
//             or the CLI's --run-tests flag) instead of only grading a
//             results file it was handed; a run without a results file
//             degrades to an exit-code-only signal and says so.
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

// Load and parse the configured results file, if any. Returns
// { rel, parsed } on success, { rel, note } with the exact neutral-note
// text when the file cannot back a verdict, or { rel: null } when no
// results input is configured at all.
function loadResultsFile(ctx) {
  const rel = ctx.inputs?.testResults || ctx.inputs?.e2eResults;
  if (!rel) return { rel: null };
  const { data, error } = loadArtifact(ctx.root, rel);
  if (error) return { rel, note: `Test results could not be loaded (${error}) — run signal unverified.` };
  const parsed = parseTestResults(data);
  if (!parsed) return { rel, note: "Test results file format not recognized (expected {passed, failed}, Jest/Vitest JSON, or Playwright JSON) — run signal unverified." };
  if (parsed.total === 0) return { rel, note: "Test results contain no tests — run unverified." };
  return { rel, parsed };
}

function runSignal(ctx, neutralNotes) {
  const tr = ctx.testRun;
  if (tr) {
    // The scan ran the suite itself (inputs.testCommand or --run-tests).
    // A results file the command produced outranks the bare exit code:
    // counts decompose, an exit code only accuses.
    const f = loadResultsFile(ctx);
    if (f.parsed) {
      return { key: "run", score: Math.round((f.parsed.passed / f.parsed.total) * 1000) / 10, parsed: f.parsed, rel: f.rel };
    }
    if (tr.error) {
      neutralNotes.push(check("e2e-results", null, `Test command "${tr.command}" could not complete (${tr.error}) — run signal unverified.`));
      return null;
    }
    return {
      key: "run",
      score: tr.exitCode === 0 ? 100 : 0,
      parsed: { format: "exit-code", passed: 0, failed: 0, total: 0, exitCode: tr.exitCode, command: tr.command },
      rel: "(test command)",
    };
  }
  const f = loadResultsFile(ctx);
  if (!f.rel) {
    neutralNotes.push(check("e2e-results", null, "No testResults input — the run signal is absent; scoring falls back to coverage/presence signals. Provide a results file ({passed, failed}, Jest/Vitest JSON, or a Playwright JSON report), or set inputs.testCommand / pass --run-tests so the scan runs the suite itself."));
    return null;
  }
  if (!f.parsed) {
    neutralNotes.push(check("e2e-results", null, f.note));
    return null;
  }
  return {
    key: "run",
    score: Math.round((f.parsed.passed / f.parsed.total) * 1000) / 10,
    parsed: f.parsed,
    rel: f.rel,
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
    if (p.format === "exit-code") {
      if (p.exitCode === 0) {
        return check("e2e-results", true, `Test command "${p.command}" exited 0 — but no results file was produced, so per-test counts are unknown (exit-code signal only). Configure the runner to emit a JSON results file for counts.`);
      }
      return violation("e2e-failures", `Test command "${p.command}" exited ${p.exitCode} — the run failed. No results file to decompose the failure; configure the runner to emit a JSON results file for per-test counts.`, signal.rel, points);
    }
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
