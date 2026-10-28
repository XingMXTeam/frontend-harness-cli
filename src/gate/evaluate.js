import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { collectFiles, isTestFile } from "./scan.js";
import {
  applyExemptions,
  buildContext,
  checkData,
  checkE2e,
  checkLogic,
  checkStructure,
  checkUi,
} from "./rules.js";
import { formatTrend } from "./history.js";

const DIMENSIONS = ["structure", "data", "logic", "ui", "e2e"];

const CHECKS = {
  structure: (files, cfg, ctx) => checkStructure(files, cfg.rules.structure, ctx),
  data: (files, cfg, ctx) => checkData(files, cfg.rules.data, ctx),
  logic: (files, cfg, ctx) => checkLogic(files, cfg.rules.logic, ctx),
  ui: (files, cfg, ctx) => checkUi(files, cfg.rules.ui, ctx),
  e2e: (files, cfg, ctx) => checkE2e(files, cfg.rules.e2e, isTestFile, ctx),
};

const COMPILE_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_DEFAULT_MS = 300_000;

// Compilation is verified by actually compiling, never by looking at the
// code harder. An explicit compileCommand wins; otherwise a locally
// installed tsc (tsconfig.json + node_modules/.bin/tsc) is auto-detected
// — local binaries only, a scan must never download anything. A timeout
// leaves the check unverified (neutral), not failed: "we could not
// finish checking" is a different claim from "the code does not compile".
function resolveCompile(root, config) {
  if (config.compileCommand) return { command: config.compileCommand, source: "compileCommand" };
  if (config.autoCompile === false) return null;
  if (existsSync(join(root, "tsconfig.json")) && existsSync(join(root, "node_modules", ".bin", "tsc"))) {
    return { command: "./node_modules/.bin/tsc --noEmit -p tsconfig.json", source: "auto-tsc" };
  }
  return null;
}

function firstErrorLine(err) {
  const text = `${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`;
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return line ? line.slice(0, 200) : null;
}

function runCompile(root, config, ctx) {
  const resolved = resolveCompile(root, config);
  if (!resolved) return;
  ctx.compileSource = resolved.source;
  try {
    execSync(resolved.command, { cwd: root, stdio: "pipe", timeout: COMPILE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    ctx.compiled = true;
  } catch (err) {
    if (err.code === "ETIMEDOUT") {
      ctx.compileTimedOut = true;
      return;
    }
    ctx.compiled = false;
    ctx.compileErrorLine = firstErrorLine(err);
  }
}

// The e2e dimension used to grade a results file it was handed — someone
// else had to run the tests. With inputs.testCommand set (or the scan's
// --run-tests flag, which reads package.json's test script), the scan
// runs the suite itself before scoring; a results file the command
// produces is then parsed for counts exactly as before. A command that
// cannot complete (spawn failure, timeout) leaves the run signal
// unverified instead of inventing a result.
function resolveTestCommand(root, config, opts) {
  if (config.inputs?.testCommand) return config.inputs.testCommand;
  if (!opts?.runTests) return null;
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (pkg.scripts && typeof pkg.scripts.test === "string" && pkg.scripts.test.trim()) return "npm test";
  } catch {
    // No readable package.json — nothing to detect.
  }
  return null;
}

function runTests(root, config, ctx, opts) {
  const command = resolveTestCommand(root, config, opts);
  if (!command) return;
  const timeout = config.inputs?.testTimeoutMs ?? TEST_TIMEOUT_DEFAULT_MS;
  try {
    execSync(command, { cwd: root, stdio: "pipe", timeout, maxBuffer: 16 * 1024 * 1024 });
    ctx.testRun = { command, exitCode: 0 };
  } catch (err) {
    if (err.code === "ETIMEDOUT") ctx.testRun = { command, error: `timed out after ${timeout}ms` };
    else if (typeof err.status === "number") ctx.testRun = { command, exitCode: err.status };
    else ctx.testRun = { command, error: err.message };
  }
}

function scoreDimensions(files, config, ctx) {
  const dimensions = {};
  for (const dim of DIMENSIONS) {
    let checks = CHECKS[dim](files, config, ctx);
    checks = applyExemptions(checks, config.exemptions);
    const deducted = checks
      .filter((c) => c.passed === false)
      .reduce((sum, c) => sum + c.points, 0);
    const score = Math.max(0, 100 - deducted);
    dimensions[dim] = {
      score,
      threshold: config.dimensions[dim].threshold,
      why: config.dimensions[dim].why,
      passed: score >= config.dimensions[dim].threshold,
      checks,
    };
  }
  return dimensions;
}

function evaluateGates(config, dimensions) {
  const gates = [];
  let shortCircuitedAt = null;
  for (const gate of config.gates) {
    if (shortCircuitedAt) {
      gates.push({ gate: gate.id, passed: null, status: "skipped", detail: `Not evaluated — run stopped at "${shortCircuitedAt}".` });
      continue;
    }
    const unmet = [];
    for (const [dim, min] of Object.entries(gate.requires)) {
      const need = min ?? config.dimensions[dim].threshold;
      if (dimensions[dim].score < need) unmet.push(`${dim} score ${dimensions[dim].score} < ${need}`);
    }
    const passed = unmet.length === 0;
    gates.push({
      gate: gate.id,
      passed,
      status: passed ? "passed" : "failed",
      detail: passed
        ? Object.keys(gate.requires)
            .map((d) => `${d} ${dimensions[d].score} ≥ ${gate.requires[d] ?? config.dimensions[d].threshold}`)
            .join(", ")
        : unmet.join("; "),
    });
    if (!passed) shortCircuitedAt = gate.id;
  }
  return { gates, shortCircuitedAt };
}

// Explain the failure: which checks, in which dimension, and how the
// fixes group up (the remediation view an agent or human works from).
function summarize(dimensions) {
  const failedReasons = [];
  const buckets = {};
  for (const dim of DIMENSIONS) {
    for (const c of dimensions[dim].checks) {
      if (c.passed !== false) continue;
      failedReasons.push({ dim, check: c.name, why: c.message, evidence: c.evidence });
      buckets[c.name] = buckets[c.name] || { count: 0, points: 0, dims: new Set() };
      buckets[c.name].count += 1;
      buckets[c.name].points += c.points;
      buckets[c.name].dims.add(dim);
    }
  }
  const remediation = Object.entries(buckets)
    .map(([rule, b]) => ({ rule, count: b.count, points: b.points, dimensions: [...b.dims] }))
    .sort((a, b) => b.points - a.points);
  const notCovered = DIMENSIONS.flatMap((dim) =>
    dimensions[dim].checks
      .filter((c) => c.passed === null)
      .map((c) => `${dim}/${c.name}: ${c.message}`)
  );
  return { failedReasons, remediation, notCovered };
}

const VISUAL_TIMEOUT_DEFAULT_MS = 180_000;

// Same contract as runTests, for the UI dimension: when inputs.visualCommand
// is configured, the scan refreshes the visual comparison itself (the
// command typically captures fresh screenshots and runs the pixel diff,
// e.g. via `harness capture` + `harness visual`, writing the
// comparison.json that inputs.visualResults points at). The results file
// remains the source of truth; the exit code is only recorded.
function runVisual(root, config, ctx) {
  const command = config.inputs?.visualCommand;
  if (!command) return;
  const timeout = config.inputs?.visualTimeoutMs ?? VISUAL_TIMEOUT_DEFAULT_MS;
  try {
    execSync(command, { cwd: root, stdio: "pipe", timeout, maxBuffer: 16 * 1024 * 1024 });
    ctx.visualRun = { command, exitCode: 0 };
  } catch (err) {
    if (err.code === "ETIMEDOUT") ctx.visualRun = { command, error: `timed out after ${timeout}ms` };
    else if (typeof err.status === "number") ctx.visualRun = { command, exitCode: err.status };
    else ctx.visualRun = { command, error: err.message };
  }
}

export function evaluate(root, config, opts = {}) {
  const files = collectFiles(root, config);
  const ctx = buildContext(root, config, files);
  runCompile(root, config, ctx);
  runTests(root, config, ctx, opts);
  runVisual(root, config, ctx);

  // 1. Score every dimension. 2. Evaluate named gates in order;
  // short-circuit at the first failure. 3. Summarize for remediation.
  const dimensions = scoreDimensions(files, config, ctx);
  const totalScore = Math.round(
    DIMENSIONS.reduce((sum, d) => sum + dimensions[d].score, 0) / DIMENSIONS.length
  );
  const { gates, shortCircuitedAt } = evaluateGates(config, dimensions);
  const { failedReasons, remediation, notCovered } = summarize(dimensions);

  return {
    root,
    fileCount: files.length,
    totalScore,
    passed: shortCircuitedAt === null,
    shortCircuitedAt,
    dimensions,
    gates,
    failedReasons,
    remediation,
    notCovered,
    howToDebug: [
      "Treat the first failed gate as the only result. Later gates did not decide anything.",
      "Work the remediation list top-down: it is sorted by points at stake.",
      "Re-run after each fix batch; scores are deterministic, so movement is real.",
    ],
  };
}

export function formatReport(report) {
  const out = [];
  out.push(`harness scan — scanned ${report.fileCount} file(s) in ${report.root}`);
  out.push(`total score: ${report.totalScore}/100`);
  out.push("");
  for (const [dim, d] of Object.entries(report.dimensions)) {
    const mark = d.passed ? "PASS" : "FAIL";
    out.push(`  ${dim.padEnd(10)} ${String(d.score).padStart(3)}/100  (threshold ${d.threshold})  ${mark}`);
    for (const c of d.checks) {
      if (c.passed === true && c.name.endsWith("-rules")) continue;
      const tag = c.passed === null ? "neutral" : c.passed ? "ok" : "FAIL";
      out.push(`    [${tag}] ${c.name}: ${c.message}${c.evidence ? ` (${c.evidence})` : ""}`);
    }
  }
  out.push("");
  for (const g of report.gates) {
    const mark = g.status === "skipped" ? "SKIPPED" : g.passed ? "PASS" : "FAIL";
    out.push(`  gate ${g.gate.padEnd(12)} ${mark} — ${g.detail}`);
  }
  if (report.remediation.length > 0) {
    out.push("");
    out.push("  remediation (by points at stake):");
    for (const r of report.remediation)
      out.push(`    - ${r.rule}: ${r.count} occurrence(s), ${r.points} points`);
  }
  if (report.notCovered.length > 0) {
    out.push("");
    out.push("  not covered / unverified:");
    for (const n of report.notCovered) out.push(`    - ${n}`);
  }
  if (report.trend) out.push(formatTrend(report.trend));
  out.push("");
  out.push(
    report.passed
      ? "VERDICT: PASS — all gates cleared."
      : `VERDICT: FAIL — stopped at gate "${report.shortCircuitedAt}".`
  );
  return out.join("\n");
}
