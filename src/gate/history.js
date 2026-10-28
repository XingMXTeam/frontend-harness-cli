// Run history: every evaluation can be appended to a history directory
// as an immutable JSON report, and the current run can be compared
// against the previous one (the "trend"). History files are named by
// timestamp and never overwritten — the record of what the gate said,
// and when, is itself part of the evidence.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Filesystem-safe ISO timestamp (colons are illegal in Windows paths).
export function historyFileName(date = new Date()) {
  return `${date.toISOString().replace(/:/g, "-")}.json`;
}

export function listHistory(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

// The most recent report already in the directory, or null.
export function readPreviousReport(dir) {
  const files = listHistory(dir);
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(dir, files[files.length - 1]), "utf8"));
  } catch {
    return null;
  }
}

// Append the report; returns the file name written, or null if a file
// with the same timestamp already exists (never overwrite history).
export function appendHistory(dir, report, date = new Date()) {
  mkdirSync(dir, { recursive: true });
  const name = historyFileName(date);
  const path = join(dir, name);
  if (existsSync(path)) return null;
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  return name;
}

const fmtDelta = (d) => (d > 0 ? `+${d}` : `${d}`);

// Compare two reports: per-dimension deltas, total delta, gate verdict
// movement. Returns null when there is nothing meaningful to compare.
export function computeTrend(previous, current) {
  if (!previous || !previous.dimensions || !current || !current.dimensions) return null;
  const dimensions = {};
  for (const dim of Object.keys(current.dimensions)) {
    const before = previous.dimensions[dim]?.score;
    const after = current.dimensions[dim].score;
    if (typeof before !== "number") continue;
    dimensions[dim] = { before, after, delta: after - before };
  }
  if (Object.keys(dimensions).length === 0) return null;
  const verdictOf = (r) =>
    r.passed ? "PASS" : `FAIL@${r.shortCircuitedAt || "?"}`;
  return {
    dimensions,
    total: {
      before: previous.totalScore,
      after: current.totalScore,
      delta: current.totalScore - previous.totalScore,
    },
    verdict: { before: verdictOf(previous), after: verdictOf(current) },
    changed: verdictOf(previous) !== verdictOf(current),
  };
}

export function formatTrend(trend) {
  const out = ["", "  trend (vs previous run):"];
  for (const [dim, t] of Object.entries(trend.dimensions)) {
    const arrow = t.delta > 0 ? "up" : t.delta < 0 ? "down" : "flat";
    out.push(`    ${dim.padEnd(10)} ${t.before} -> ${t.after} (${fmtDelta(t.delta)}, ${arrow})`);
  }
  out.push(`    total      ${trend.total.before} -> ${trend.total.after} (${fmtDelta(trend.total.delta)})`);
  if (trend.changed) {
    out.push(`    ** verdict changed: ${trend.verdict.before} -> ${trend.verdict.after} **`);
  } else {
    out.push(`    verdict unchanged: ${trend.verdict.after}`);
  }
  return out.join("\n");
}
