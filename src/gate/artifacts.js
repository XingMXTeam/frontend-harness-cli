// Parsers for real test-runner / coverage artifacts.
//
// The e2e dimension used to accept only a hand-written {passed, failed}
// file. Real projects already produce standard artifacts — Jest/Vitest
// JSON, Playwright JSON reports, istanbul coverage summaries — so the
// gate reads those directly and says which format it found.

// -> { format: "simple" | "jest" | "playwright", passed, failed, total }
//    or null when the shape is unrecognized.
export function parseTestResults(data) {
  if (!data || typeof data !== "object") return null;

  // Playwright JSON report: top-level `suites` and/or `stats`.
  if (Array.isArray(data.suites) || (data.stats && typeof data.stats === "object")) {
    if (data.stats && (data.stats.expected !== undefined || data.stats.unexpected !== undefined)) {
      const passed = Number(data.stats.expected) || 0;
      const failed = Number(data.stats.unexpected) || 0;
      return { format: "playwright", passed, failed, total: passed + failed };
    }
    let passed = 0;
    let failed = 0;
    const walk = (suite) => {
      for (const spec of suite.specs || []) {
        if (spec.ok === true) passed++;
        else if (spec.ok === false) failed++;
      }
      for (const child of suite.suites || []) walk(child);
    };
    for (const suite of data.suites || []) walk(suite);
    return { format: "playwright", passed, failed, total: passed + failed };
  }

  // Jest / Vitest JSON: numPassedTests / numFailedTests counters.
  if (typeof data.numPassedTests === "number" || typeof data.numFailedTests === "number") {
    const passed = Number(data.numPassedTests) || 0;
    const failed = Number(data.numFailedTests) || 0;
    return { format: "jest", passed, failed, total: passed + failed };
  }

  // The original hand-written shape.
  if (typeof data.passed === "number" && typeof data.failed === "number") {
    return { format: "simple", passed: data.passed, failed: data.failed, total: data.passed + data.failed };
  }
  return null;
}

// istanbul coverage-summary.json -> per-metric percentages + their mean.
// -> { lines, statements, functions, branches, mean } or null.
export function parseCoverage(data) {
  const total = data && typeof data === "object" ? data.total : null;
  if (!total || typeof total !== "object") return null;
  const pct = (m) => (m && typeof m.pct === "number" ? m.pct : null);
  const metrics = {
    lines: pct(total.lines),
    statements: pct(total.statements),
    functions: pct(total.functions),
    branches: pct(total.branches),
  };
  const values = Object.values(metrics).filter((v) => v !== null);
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { ...metrics, mean: Math.round(mean * 10) / 10 };
}
