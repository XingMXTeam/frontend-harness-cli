// Shared plumbing for the rule modules.
//
// Every check returns:
// { name, passed: true | false | null, message, evidence?, points }
// passed === null means "neutral": the check could not be verified in
// this environment. A neutral check deducts nothing — but it is printed,
// because an unverified check must never be silently counted as a pass.

import { globMatch } from "../config.js";
import { lineStarts, maskSource } from "../mask.js";
import {
  extractImports,
  findCycles,
  loadAliases,
  resolveToFile,
  specifierCandidates,
} from "../imports.js";

export function check(name, passed, message, extra = {}) {
  return { name, passed, message, points: 0, ...extra };
}

export function violation(name, message, evidence, points) {
  return { name, passed: false, message, evidence, points };
}

export function countOccurrences(content, regex) {
  return (content.match(regex) || []).length;
}

// Build the shared analysis context once per run: a masked view per
// file, the project's path aliases, the resolved import graph, and its
// cycles. Rule modules consume this instead of re-deriving it.
export function buildContext(root, config, files) {
  const aliases = loadAliases(root);
  const fileSet = new Set(files.map((f) => f.rel));
  const views = new Map();
  const graph = new Map();
  for (const file of files) {
    const masked = maskSource(file.content, file.rel);
    const view = { ...masked, lineStarts: lineStarts(masked.code) };
    views.set(file.rel, view);
    const edges = new Set();
    view.imports = extractImports(view).map((imp) => {
      const candidates = specifierCandidates(file.rel, imp.spec, aliases);
      const target = resolveToFile(candidates, fileSet, config.extensions);
      if (target) edges.add(target);
      return { ...imp, candidates, target };
    });
    graph.set(file.rel, edges);
  }
  return {
    root,
    inputs: config.inputs,
    compiled: null,
    aliases,
    views,
    graph,
    cycles: findCycles(graph),
  };
}

// Apply config exemptions: a failed check whose name matches an
// exemption for its evidence path becomes neutral (visible, not
// counted). An exemption without a reason is just a hole.
export function applyExemptions(dimChecks, exemptions) {
  if (!exemptions || exemptions.length === 0) return dimChecks;
  return dimChecks.map((c) => {
    if (c.passed !== false) return c;
    const path = (c.evidence || "").split(":")[0];
    const hit = exemptions.find(
      (e) => globMatch(e.path, path) && (e.rules.includes("*") || e.rules.includes(c.name))
    );
    if (!hit) return c;
    return {
      ...c,
      passed: null,
      points: 0,
      message: `${c.message} [exempted: ${hit.reason || "no reason given"}]`,
    };
  });
}
