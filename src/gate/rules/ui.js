// UI dimension: image alt text, inline-style sprawl, raw hex colors,
// design-token validity, screenshot evidence, and — when a visual
// comparison report is provided as an input — pixel-level fidelity
// against adopted baselines. Color literals in JS/TS live inside
// strings by nature, so hex and var(--*) are matched on the code view
// *and* literal contents; in stylesheets they are code.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { globMatch } from "../config.js";
import { check, countOccurrences, violation } from "./shared.js";

const UI_FILE = /\.(jsx|tsx|css|scss)$/;
const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

function imgChecks(file, view) {
  const checks = [];
  for (const m of view.code.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt\s*=/.test(m[0])) {
      const line = view.code.slice(0, m.index).split("\n").length;
      checks.push(
        violation("img-missing-alt", "<img> without an alt attribute. Accessibility is part of the UI contract, not an afterthought.", `${file.rel}:${line}`, 5)
      );
    }
  }
  return checks;
}

function styleChecks(file, view, rules) {
  const checks = [];
  const styles = countOccurrences(view.code, /style=\{\{/g);
  if (styles > rules.maxInlineStylesPerFile) {
    checks.push(
      violation("too-many-inline-styles", `${styles} inline style objects in one file (limit ${rules.maxInlineStylesPerFile}). Let the design system carry styling; inline styles are how generated UI drifts apart.`, file.rel, 4)
    );
  }
  return checks;
}

function hexChecks(file, view, rules) {
  const isTokenFile = (rules.tokenFilePatterns || []).some((p) => globMatch(p, file.rel));
  if (isTokenFile) return [];
  const hexes =
    countOccurrences(view.code, HEX_RE) + countOccurrences(view.strings, HEX_RE);
  if (hexes > rules.maxRawHexPerFile) {
    return [
      violation("raw-hex-colors", `${hexes} raw hex colors outside design-token files (limit ${rules.maxRawHexPerFile}). A raw hex looks right and silently forks the palette — use a token.`, file.rel, 4),
    ];
  }
  return [];
}

// Design-token validity: var(--x) usages must exist in the token
// source. Needs the token file as input — a made-up token name
// compiles fine and silently renders as nothing.
function tokenChecks(files, uiFiles, ctx) {
  if (!ctx.inputs?.designTokens) return [];
  try {
    const tokenPath = join(ctx.root, ctx.inputs.designTokens);
    const raw = readFileSync(tokenPath, "utf8");
    const known = new Set();
    if (ctx.inputs.designTokens.endsWith(".css")) {
      for (const m of raw.matchAll(/(--[\w-]+)\s*:/g)) known.add(m[1]);
    } else {
      const parsed = JSON.parse(raw);
      const collect = (node) => {
        if (Array.isArray(node)) node.forEach((v) => (typeof v === "string" ? known.add(v) : collect(v)));
        else if (node && typeof node === "object")
          for (const [k, v] of Object.entries(node)) {
            if (k.startsWith("--")) known.add(k);
            collect(v);
          }
      };
      collect(parsed);
    }
    const checks = [];
    const reported = new Set();
    for (const file of uiFiles) {
      const view = ctx.views.get(file.rel);
      const haystacks = [view.code, view.strings];
      for (const hay of haystacks) {
        for (const m of hay.matchAll(/var\(\s*(--[\w-]+)/g)) {
          if (!known.has(m[1]) && !reported.has(`${file.rel}:${m[1]}`)) {
            reported.add(`${file.rel}:${m[1]}`);
            checks.push(
              violation("unknown-design-token", `var(${m[1]}) is used but not defined in the design-token source. An undefined token renders as an empty value.`, file.rel, 5)
            );
          }
        }
      }
    }
    if (reported.size === 0)
      checks.push(check("token-validity", true, `All var(--*) usages resolve against ${known.size} token(s) in the token source.`));
    return checks;
  } catch (err) {
    return [check("token-validity", null, `Design-token source could not be loaded (${err.message}) — validity unverified.`)];
  }
}

// Screenshot evidence: a pass claim backed by a near-empty PNG is
// backed by a blank page. Tiny screenshots are not evidence.
function evidenceChecks(ctx) {
  if (!ctx.inputs?.uiEvidenceDir) return [];
  const dir = join(ctx.root, ctx.inputs.uiEvidenceDir);
  const minBytes = ctx.inputs.uiEvidenceMinBytes ?? 8192;
  if (!existsSync(dir)) {
    return [check("ui-evidence", null, `UI evidence directory ${ctx.inputs.uiEvidenceDir} does not exist — screenshot evidence unverified.`)];
  }
  const pngs = readdirSync(dir).filter((f) => f.endsWith(".png"));
  if (pngs.length === 0) {
    return [check("ui-evidence", null, "No screenshots in the UI evidence directory — nothing was evidenced.")];
  }
  const checks = [];
  for (const png of pngs) {
    const size = statSync(join(dir, png)).size;
    if (size < minBytes) {
      checks.push(
        violation("blank-screenshot-evidence", `Screenshot ${png} is ${size} bytes (< ${minBytes}). A page that renders compresses larger than this — this is a blank page filed as evidence.`, `${ctx.inputs.uiEvidenceDir}/${png}`, 8)
      );
    }
  }
  return checks;
}

// Visual fidelity: pixel-diff results against adopted baselines, in the
// comparison.json shape `harness visual` writes ({ results: [{ name,
// status, ratio, maxDiffRatio }] }). The comparison already applied its
// own tolerance, so this check trusts each page's status:
//   diff / size-mismatch → the rendered page no longer matches the
//                          design baseline it was approved against (8 pts)
//   no-baseline          → NOT a failure and NOT a pass: that page is
//                          unverified, reported neutral (mirrors the
//                          verdict semantics of `harness visual` itself)
//   match                → verified
// Without the input there is nothing to compare against and the check
// stays silent. inputs.visualCommand lets the scan refresh the report
// itself before scoring; the file remains the source of truth.
function visualChecks(ctx) {
  const rel = ctx.inputs?.visualResults;
  const vr = ctx.visualRun;
  if (!rel && !vr) return [];
  let data = null;
  let loadNote = null;
  if (rel) {
    try {
      data = JSON.parse(readFileSync(join(ctx.root, rel), "utf8"));
      if (!data || !Array.isArray(data.results)) {
        loadNote = `Visual results file ${rel} has no results array (expected the comparison.json shape written by harness visual) — visual diff unverified.`;
        data = null;
      }
    } catch (err) {
      loadNote = `Visual results could not be loaded (${err.message}) — visual diff unverified.`;
    }
  }
  if (!data) {
    if (vr?.error)
      return [check("visual-diff", null, `Visual command "${vr.command}" could not complete (${vr.error}) — visual diff unverified.`)];
    if (loadNote) return [check("visual-diff", null, loadNote)];
    if (vr)
      return [check("visual-diff", null, `Visual command "${vr.command}" exited ${vr.exitCode} but no visualResults file was produced — visual diff unverified.`)];
    return [];
  }
  const checks = [];
  let compared = 0;
  const noBaseline = [];
  for (const r of data.results) {
    if (!r || typeof r.name !== "string") continue;
    if (r.status === "match") {
      compared++;
    } else if (r.status === "diff") {
      compared++;
      checks.push(
        violation("visual-diff", `Page "${r.name}" no longer matches its design baseline: pixel diff ratio ${r.ratio} exceeds the allowed ${r.maxDiffRatio}. Either the change is intended (review and re-adopt the baseline) or the UI drifted.`, rel, 8)
      );
    } else if (r.status === "size-mismatch") {
      compared++;
      checks.push(
        violation("visual-size-mismatch", `Page "${r.name}" changed dimensions vs its baseline (${r.detail || "size-mismatch"}). A viewport-sized change is a structural layout break, not a styling drift.`, rel, 8)
      );
    } else if (r.status === "no-baseline") {
      noBaseline.push(r.name);
    }
  }
  if (noBaseline.length > 0) {
    checks.push(
      check("visual-baseline-missing", null, `${noBaseline.length} page(s) have no baseline (${noBaseline.join(", ")}) — unverified, not passed. Review the screenshots and adopt baselines explicitly (harness visual --update-baseline).`)
    );
  }
  if (compared > 0 && !checks.some((c) => c.passed === false)) {
    checks.push(check("visual-diff", true, `All ${compared} compared page(s) match their design baselines within tolerance.`));
  }
  return checks;
}

export function checkUi(files, rules, ctx) {
  const uiFiles = files.filter((f) => UI_FILE.test(f.rel));
  const checks = [];
  for (const file of uiFiles) {
    const view = ctx.views.get(file.rel);
    checks.push(...imgChecks(file, view), ...styleChecks(file, view, rules), ...hexChecks(file, view, rules));
  }
  checks.push(...tokenChecks(files, uiFiles, ctx), ...evidenceChecks(ctx), ...visualChecks(ctx));
  if (!checks.some((c) => c.passed === false))
    checks.push(check("ui-rules", true, "No accessibility or design-token violations found."));
  return checks;
}
