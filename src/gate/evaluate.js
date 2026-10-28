import { execSync } from "node:child_process";
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

function runCompile(root, config, ctx) {
  if (!config.compileCommand) return;
  try {
    execSync(config.compileCommand, { cwd: root, stdio: "pipe" });
    ctx.compiled = true;
  } catch {
    ctx.compiled = false;
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

export function evaluate(root, config) {
  const files = collectFiles(root, config);
  const ctx = buildContext(root, config, files);
  runCompile(root, config, ctx);

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
