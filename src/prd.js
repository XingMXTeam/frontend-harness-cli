/**
 * PRD import analysis.
 *
 * The kernel never parses PRD prose for verdicts — requirements reach
 * rubric.json through the planner, lifted from the PRD. But the one
 * structural contract all downstream machinery depends on can be checked
 * mechanically at import time: requirements numbered REQ-1, REQ-2, ...
 * with no gaps, each with its sentence on the same line, so the ids can
 * be lifted into rubric.json verbatim. This module checks exactly that
 * and nothing more — content quality stays with the planner and the user.
 */
export function analyzePrd(markdown) {
  const byId = new Map();
  String(markdown).split(/\r?\n/).forEach((line, idx) => {
    const m = line.match(/\bREQ-(\d+)\b/);
    if (!m) return;
    const n = Number(m[1]);
    const id = `REQ-${n}`;
    const description = line
      .slice(m.index + m[0].length)
      .replace(/^[\s:：、.．)）\]】\-—–·|]+/, '')
      .replace(/\*+/g, '')
      .trim()
      .slice(0, 240);
    const prev = byId.get(id);
    // A PRD may mention an id several times (prose references, a summary
    // table). Keep the mention that actually describes the requirement:
    // the longest same-line text wins.
    if (!prev || description.length > prev.description.length) {
      byId.set(id, { id, n, description, line: idx + 1 });
    }
  });
  const found = [...byId.values()].sort((a, b) => a.n - b.n);
  const missing = [];
  if (found.length) {
    const have = new Set(found.map((r) => r.n));
    for (let i = 1; i <= found[found.length - 1].n; i += 1) {
      if (!have.has(i)) missing.push(`REQ-${i}`);
    }
  }
  return {
    requirements: found.map(({ id, description, line }) => ({ id, description, line })),
    numberingComplete: found.length > 0 && missing.length === 0,
    missing,
  };
}
