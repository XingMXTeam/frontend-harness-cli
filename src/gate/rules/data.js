// Data dimension: hardcoded credentials, plain-http endpoints, storage
// key namespaces, i18n completeness. Secrets and patterns are matched
// on the masked code view; URLs are matched on literal contents (that
// is where URLs live) so prose in comments can no longer fabricate one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineAt, literalAfter } from "../mask.js";
import { check, violation } from "./shared.js";

function secretChecks(files, rules, ctx) {
  const checks = [];
  const secretRe = new RegExp(rules.secretPattern, "i");
  for (const file of files) {
    const lines = ctx.views.get(file.rel).code.split("\n");
    lines.forEach((line, i) => {
      if (secretRe.test(line)) {
        checks.push(
          violation("hardcoded-secret", "Possible hardcoded credential. Move it to an environment variable — generated code loves inventing plausible-looking keys.", `${file.rel}:${i + 1}`, 15)
        );
      }
    });
  }
  return checks;
}

function urlChecks(files, rules, ctx) {
  const checks = [];
  for (const file of files) {
    const view = ctx.views.get(file.rel);
    for (const lit of view.literals) {
      if (lit.value == null) continue;
      const urls = lit.value.match(/http:\/\/[^\s'")]+/g) || [];
      for (const url of urls) {
        if (rules.allowHttpLocalhost && /^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) continue;
        checks.push(
          violation("insecure-url", `Plain http:// URL (${url}). Use https:// outside local development.`, `${file.rel}:${lineAt(view.lineStarts, lit.start)}`, 5)
        );
      }
    }
  }
  return checks;
}

// Storage keys must be namespaced ({page}.{entity}.{field} shape):
// un-namespaced keys collide across pages and leak across features.
function storageChecks(files, ctx) {
  const checks = [];
  const callRe = /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*/g;
  for (const file of files) {
    const view = ctx.views.get(file.rel);
    for (const m of view.code.matchAll(callRe)) {
      const lit = literalAfter(view, m.index + m[0].length, ";)");
      if (!lit || lit.value == null) continue;
      if (!/^[\w-]+\.[\w-]+\.[\w-]+/.test(lit.value)) {
        checks.push(
          violation("storage-key-namespace", `Storage key "${lit.value}" is not namespaced. Use a {page}.{entity}.{field} shape so keys cannot collide across features.`, file.rel, 5)
        );
      }
    }
  }
  return checks;
}

function flattenKeys(obj, prefix, known) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flattenKeys(v, key, known);
    else known.add(key);
  }
}

// i18n completeness: keys called in code must exist in the resources.
// Needs the resource files as input — code alone cannot prove this.
function i18nChecks(files, ctx) {
  const i18n = ctx.inputs?.i18n;
  if (!i18n || !Array.isArray(i18n.resources)) return [];
  try {
    const known = new Set();
    for (const res of i18n.resources) {
      flattenKeys(JSON.parse(readFileSync(join(ctx.root, res), "utf8")), "", known);
    }
    const called = new Map();
    if (i18n.callPattern) {
      // A custom pattern runs on raw source, as before.
      const callRe = new RegExp(i18n.callPattern, "g");
      for (const file of files) {
        for (const m of file.content.matchAll(callRe)) {
          if (!called.has(m[1])) called.set(m[1], file.rel);
        }
      }
    } else {
      const callRe = /\b(?:t|\$t|i18n\.t)\(\s*/g;
      for (const file of files) {
        const view = ctx.views.get(file.rel);
        for (const m of view.code.matchAll(callRe)) {
          const lit = literalAfter(view, m.index + m[0].length, ";)");
          if (lit && lit.value != null && !called.has(lit.value)) {
            called.set(lit.value, file.rel);
          }
        }
      }
    }
    const checks = [];
    for (const [key, where] of called) {
      if (!known.has(key)) {
        checks.push(
          violation("i18n-missing-key", `i18n key "${key}" is called in code but missing from the resource files. A missing key renders as a raw string in production.`, where, 6)
        );
      }
    }
    if (checks.length === 0)
      checks.push(check("i18n-complete", true, `All ${called.size} called i18n key(s) exist in the resources.`));
    return checks;
  } catch (err) {
    return [check("i18n-complete", null, `i18n resources could not be loaded (${err.message}) — completeness unverified.`)];
  }
}

export function checkData(files, rules, ctx) {
  const checks = [
    ...secretChecks(files, rules, ctx),
    ...urlChecks(files, rules, ctx),
    ...storageChecks(files, ctx),
    ...i18nChecks(files, ctx),
  ];
  if (!checks.some((c) => c.passed === false))
    checks.push(check("data-rules", true, "No credential or endpoint violations found."));
  return checks;
}
