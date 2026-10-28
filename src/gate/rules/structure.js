// Structure dimension: compile status, file/function size, architecture
// import rules, route isolation, import cycles, and the language layer
// (`any` / compiler suppressions). All content checks run on the masked
// code view, so strings and comments cannot fabricate violations.

import { globMatch } from "../config.js";
import { findFunctions } from "../imports.js";
import { check, violation } from "./shared.js";

// Fix guidance depends on what kind of file overflowed — a page, a
// component and a service split in different directions.
function splitSuggestion(rel) {
  if (/service\.[tj]sx?$/.test(rel))
    return "Split by domain into several service files, or move types into a types file.";
  if (/components?\//.test(rel))
    return "Extract complex logic into a sibling hook and split sub-views into their own components.";
  if (/(page|index)\.[tj]sx?$/.test(rel))
    return "Move sub-components into a components/ folder and business logic into hooks.";
  return "Split into smaller modules, each with a single responsibility.";
}

function compileCheck(ctx) {
  if (ctx.compiled === null) {
    return check("compile", null, "No compileCommand configured — compilation is unverified, not passed. Set compileCommand (e.g. \"npx tsc --noEmit\") to verify.");
  }
  return check(
    "compile",
    ctx.compiled,
    ctx.compiled ? "Compile command exited 0." : "Compile command failed — nothing else in this dimension matters until this is green.",
    { points: ctx.compiled ? 0 : 40 }
  );
}

function sizeChecks(files, rules, ctx) {
  const checks = [];
  for (const file of files) {
    const count = file.content.split("\n").length;
    if (count > rules.maxFileLines) {
      checks.push(
        violation("file-too-long", `File has ${count} lines (limit ${rules.maxFileLines}). ${splitSuggestion(file.rel)}`, `${file.rel}:${rules.maxFileLines + 1}`, 8)
      );
    }
    const view = ctx.views.get(file.rel);
    for (const fn of findFunctions(view)) {
      if (fn.length > rules.maxFunctionLines) {
        checks.push(
          violation("function-too-long", `Function spans ${fn.length} lines (limit ${rules.maxFunctionLines}). Long generated functions are where bugs hide.`, `${file.rel}:${fn.startLine}`, 6)
        );
      }
    }
  }
  return checks;
}

function layerChecks(files, rules, ctx) {
  const checks = [];
  for (const rule of rules.importRules || []) {
    for (const file of files) {
      if (!globMatch(rule.from, file.rel)) continue;
      for (const imp of ctx.views.get(file.rel).imports) {
        const hit = imp.candidates.find((c) => globMatch(rule.to, c));
        if (hit) {
          checks.push(
            violation("import-layer", rule.message, `${file.rel}:${imp.line} imports ${imp.spec}`, 10)
          );
        }
      }
    }
  }
  return checks;
}

function crossRouteChecks(files, rules, ctx) {
  const checks = [];
  const cr = rules.crossRoute;
  if (!cr || !files.some((f) => f.rel.startsWith(`${cr.root}/`))) return checks;
  const routeOf = (rel) => {
    const m = rel.match(new RegExp(`^${cr.root}/([^/]+)(/.*)?$`));
    if (!m) return null;
    // A segment followed by more path is a route directory. A bare
    // segment is one only when it cannot be a file (no extension) —
    // files sitting directly in the routes root (layout.tsx,
    // globals.css) belong to no route.
    if (!m[2] && m[1].includes(".")) return null;
    return cr.sharedDirs.includes(m[1]) ? null : m[1];
  };
  for (const file of files) {
    const ownRoute = routeOf(file.rel);
    if (!ownRoute) continue;
    for (const imp of ctx.views.get(file.rel).imports) {
      for (const cand of imp.candidates) {
        const other = routeOf(cand);
        if (other && other !== ownRoute) {
          checks.push(
            violation("cross-route-import", `Route "${ownRoute}" imports from route "${other}". Extract the shared piece into ${cr.sharedDirs.join(", ")}, hooks, or lib.`, `${file.rel}:${imp.line} imports ${imp.spec}`, 10)
          );
        }
      }
    }
  }
  return checks;
}

function cycleChecks(ctx) {
  return (ctx.cycles || []).map((cycle) =>
    violation("import-cycle", `Import cycle: ${cycle.join(" -> ")}. Cycles make module initialization order-dependent and defeat tree-shaking.`, cycle[0], 10)
  );
}

// A suppression directive must lead its comment (possibly after the
// comment opener or a block-comment continuation star). A prose
// *mention* of the directive mid-sentence is not a suppression.
function countSuppressions(commentsText) {
  let count = 0;
  for (const m of commentsText.matchAll(/@ts-(ignore|nocheck)\b/g)) {
    let j = m.index - 1;
    while (j >= 0 && (commentsText[j] === " " || commentsText[j] === "\t")) j--;
    if (j < 0 || commentsText[j] === "/" || commentsText[j] === "*" || commentsText[j] === "\n") {
      count++;
    }
  }
  return count;
}

function languageChecks(files, ctx) {
  const checks = [];
  for (const file of files) {
    const view = ctx.views.get(file.rel);
    const anys = (view.code.match(/:\s*any\b|as\s+any\b|<\s*any\s*>/g) || []).length;
    if (anys > 0) {
      checks.push(
        violation("no-any", `${anys} use(s) of \`any\`. Every \`any\` is a place the compiler was told to look away.`, file.rel, Math.min(6 * anys, 18))
      );
    }
    // Suppression directives live in comments — scan the comment view.
    const ignores = countSuppressions(view.comments);
    if (ignores > 0) {
      checks.push(
        violation("no-ts-suppress", `${ignores} @ts-ignore/@ts-nocheck suppression(s). Silencing the compiler is not fixing the error.`, file.rel, Math.min(8 * ignores, 16))
      );
    }
  }
  return checks;
}

export function checkStructure(files, rules, ctx) {
  const checks = [
    compileCheck(ctx),
    ...sizeChecks(files, rules, ctx),
    ...layerChecks(files, rules, ctx),
    ...crossRouteChecks(files, rules, ctx),
    ...cycleChecks(ctx),
    ...languageChecks(files, ctx),
  ];
  if (!checks.some((c) => c.passed === false))
    checks.push(check("structure-rules", true, "No structural violations found."));
  return checks;
}
