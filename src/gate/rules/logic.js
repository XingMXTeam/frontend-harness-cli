// Logic dimension: deferred-work markers, debug residue, forbidden
// patterns, plan functional-point coverage. Markers are counted on the
// comment view (that is where they live); code patterns on the code
// view (so a string mentioning a marker no longer counts as one).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, countOccurrences, violation } from "./shared.js";

function todoChecks(files, rules, ctx) {
  const checks = [];
  for (const file of files) {
    const todos = countOccurrences(ctx.views.get(file.rel).comments, /\b(TODO|FIXME|HACK)\b/g);
    if (todos > rules.maxTodosPerFile) {
      checks.push(
        violation("too-many-todos", `${todos} TODO/FIXME markers in one file (limit ${rules.maxTodosPerFile}). AI code defers decisions with TODOs — resolve them instead.`, file.rel, 4)
      );
    }
  }
  return checks;
}

function residueChecks(files, rules, ctx) {
  const checks = [];
  const forbidden = (rules.forbiddenPatterns || []).map((p) => new RegExp(p, "g"));
  for (const file of files) {
    const view = ctx.views.get(file.rel);
    const consoles = countOccurrences(view.code, /console\.log\s*\(/g);
    if (consoles > 0) {
      checks.push(
        violation("console-log", `${consoles} console.log statement(s) left in code. Debug output is not a logging strategy.`, file.rel, Math.min(3 * consoles, 12))
      );
    }
    view.code.split("\n").forEach((line, i) => {
      for (const re of forbidden) {
        if (re.test(line)) {
          checks.push(
            violation("forbidden-pattern", `Forbidden pattern ${re.source} must not ship.`, `${file.rel}:${i + 1}`, 10)
          );
        }
      }
    });
  }
  return checks;
}

// FP coverage: the plan's functional points are the contract. Each FP
// id in the plan must be referenced somewhere in code or tests — an FP
// with no reference was planned and silently not built.
function fpChecks(files, ctx) {
  if (!ctx.inputs?.plan) return [];
  try {
    const planText = readFileSync(join(ctx.root, ctx.inputs.plan), "utf8");
    const fpIds = [...new Set([...planText.matchAll(/\bFP-\d+(?:-\d+)?\b/g)].map((m) => m[0]))];
    if (fpIds.length === 0) {
      return [check("fp-coverage", null, "Plan configured but contains no FP ids — coverage unverified.")];
    }
    const corpus = files.map((f) => f.content).join("\n");
    const missing = fpIds.filter((id) => !corpus.includes(id));
    const checks = missing.map((id) =>
      violation("fp-not-covered", `Plan functional point ${id} is not referenced anywhere in code or tests. Either it was not built, or it is not traceable — both fail the contract.`, ctx.inputs.plan, 8)
    );
    if (missing.length === 0)
      checks.push(check("fp-coverage", true, `All ${fpIds.length} plan functional point(s) are referenced in code/tests.`));
    return checks;
  } catch (err) {
    return [check("fp-coverage", null, `Plan could not be read (${err.message}) — coverage unverified.`)];
  }
}

export function checkLogic(files, rules, ctx) {
  const checks = [
    ...todoChecks(files, rules, ctx),
    ...residueChecks(files, rules, ctx),
    ...fpChecks(files, ctx),
  ];
  if (!checks.some((c) => c.passed === false))
    checks.push(check("logic-rules", true, "No leftover debug output or deferred-work pile-ups found."));
  return checks;
}
