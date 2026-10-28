// Data dimension: hardcoded credentials, plain-http endpoints, storage
// key namespaces, i18n completeness, and — when a data spec is provided
// as an input — a field-level diff between the spec's interfaces and
// the TypeScript declarations in the code. Secrets and patterns are
// matched on the masked code view; URLs are matched on literal contents
// (that is where URLs live) so prose in comments can no longer fabricate
// one. The spec diff is a frontend-harness-cli extension: the vendored
// ai-code-gate engine had no contract artifact to compare against, so
// its data dimension could only check hygiene, never conformance.

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

// ─── Data-spec conformance ─────────────────────────────────────────────
// The spec is the contract artifact: { interfaces: [{ name, fields }] },
// where `fields` is either a name→type map ({ "id": "string" }) or a
// plain list of names. Code-side, `interface Name { … }` and
// `type Name = { … }` declarations are extracted from the masked code
// view (strings/comments are already blanked there, so brace matching
// is safe) and diffed field by field:
//   spec field missing in code    → the contract promises data the
//                                   frontend never models (8 pts)
//   code field absent from spec   → drift: a stale spec, or a field the
//                                   code invented (6 pts)
//   recognized types disagree     → silent runtime breakage (6 pts)
// Without a spec input there is nothing to diff against and the check
// stays silent (zero-config scans are unaffected). A spec that cannot
// be loaded, or a codebase with no declarations at all, reports
// neutral — unverified must never look verified.

// Reduce a declared type (TypeScript syntax or a spec-side word) to a
// comparable primitive bucket. Anything unrecognized returns null and
// is left out of the comparison rather than guessed at.
function normalizeType(raw) {
  if (typeof raw !== "string") return null;
  let t = raw.trim().replace(/;+$/, "").trim();
  t = t.replace(/\|\s*(null|undefined)\b/g, "").replace(/\b(null|undefined)\s*\|/g, "").trim();
  if (/\[\]$/.test(t) || /^Array\s*</.test(t) || t === "array") return "array";
  if (/^Date\b/.test(t) || t === "date" || t === "datetime") return "date";
  const m = t.match(/^(string|number|boolean|object)\b/);
  if (m) return m[1];
  if (t.startsWith("{")) return "object";
  return null;
}

function loadSpec(ctx) {
  const rel = ctx.inputs?.dataSpec;
  if (!rel) return { kind: "unset" };
  try {
    const raw = JSON.parse(readFileSync(join(ctx.root, rel), "utf8"));
    const list = Array.isArray(raw) ? raw : raw.interfaces;
    if (!Array.isArray(list)) throw new Error("expected { interfaces: [...] }");
    const interfaces = [];
    for (const entry of list) {
      if (!entry || typeof entry.name !== "string") continue;
      const fields = new Map();
      if (Array.isArray(entry.fields)) {
        for (const f of entry.fields) if (typeof f === "string") fields.set(f, null);
      } else if (entry.fields && typeof entry.fields === "object") {
        for (const [k, v] of Object.entries(entry.fields)) fields.set(k, normalizeType(v));
      }
      interfaces.push({ name: entry.name, fields });
    }
    if (interfaces.length === 0) throw new Error("no named interfaces found");
    return { kind: "ok", interfaces, rel };
  } catch (err) {
    return { kind: "error", message: err.message, rel };
  }
}

// Index just past the closing brace that matches the `{` at openIdx.
function blockEnd(code, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Split a declaration body into depth-0 members (`;`/newline separated)
// and pull out `name?: type` fields. Method shorthand (`save(): void`)
// cannot match the field pattern, index signatures start with `[`, and
// nested object types collapse to the "object" bucket.
function parseFields(body, absStart, lineStarts) {
  const fields = new Map();
  const segments = [];
  let depth = 0;
  let segStart = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    if (i === body.length || (depth === 0 && (ch === ";" || ch === "\n"))) {
      segments.push([segStart, i]);
      segStart = i + 1;
    }
  }
  const fieldRe = /^(?:readonly\s+|public\s+|private\s+|protected\s+)*([A-Za-z_$][\w$]*)\s*\??\s*:\s*([\s\S]+)$/;
  for (const [s, e] of segments) {
    const seg = body.slice(s, e);
    const m = seg.trim().match(fieldRe);
    if (!m) continue;
    const line = lineAt(lineStarts, absStart + s + seg.indexOf(m[1]));
    fields.set(m[1], { type: normalizeType(m[2]), line });
  }
  return fields;
}

function extractDeclarations(files, ctx) {
  const decls = new Map();
  const declRe = /\b(?:interface\s+([A-Za-z_$][\w$]*)|type\s+([A-Za-z_$][\w$]*)\s*=)\s*\{/g;
  for (const file of files) {
    if (!/\.tsx?$/.test(file.rel)) continue;
    const view = ctx.views.get(file.rel);
    for (const m of view.code.matchAll(declRe)) {
      const name = m[1] || m[2];
      if (decls.has(name)) continue;
      const openIdx = m.index + m[0].length - 1;
      const end = blockEnd(view.code, openIdx);
      if (end < 0) continue;
      decls.set(name, {
        file: file.rel,
        line: lineAt(view.lineStarts, m.index),
        fields: parseFields(view.code.slice(openIdx + 1, end), openIdx + 1, view.lineStarts),
      });
    }
  }
  return decls;
}

function specChecks(files, ctx) {
  const spec = loadSpec(ctx);
  if (spec.kind === "unset") return [];
  if (spec.kind === "error")
    return [check("data-spec", null, `Data spec could not be loaded (${spec.message}) — field diff unverified.`)];
  const decls = extractDeclarations(files, ctx);
  if (decls.size === 0)
    return [
      check(
        "data-spec",
        null,
        `Data spec ${spec.rel} declares ${spec.interfaces.length} interface(s), but no TypeScript interface/type declarations were found in the code — field diff unverified.`
      ),
    ];
  const checks = [];
  for (const iface of spec.interfaces) {
    const decl = decls.get(iface.name);
    if (!decl) {
      checks.push(
        violation(
          "data-spec-interface-missing",
          `Data spec interface "${iface.name}" has no matching type declaration in the code. The contract exists on paper only — nothing in the frontend models it.`,
          spec.rel,
          8
        )
      );
      continue;
    }
    for (const [field, specType] of iface.fields) {
      const codeField = decl.fields.get(field);
      if (!codeField) {
        checks.push(
          violation(
            "data-spec-field-missing",
            `Field "${iface.name}.${field}" is defined in the data spec but missing from the code declaration. The contract promises this field; the frontend never models it.`,
            `${decl.file}:${decl.line}`,
            8
          )
        );
      } else if (specType && codeField.type && specType !== codeField.type) {
        checks.push(
          violation(
            "data-spec-type-mismatch",
            `Field "${iface.name}.${field}" is typed "${codeField.type}" in code but "${specType}" in the data spec. Type drift across the contract boundary fails silently at runtime.`,
            `${decl.file}:${codeField.line}`,
            6
          )
        );
      }
    }
    for (const [field, codeField] of decl.fields) {
      if (!iface.fields.has(field)) {
        checks.push(
          violation(
            "data-spec-field-undeclared",
            `Field "${iface.name}.${field}" is declared in code but does not exist in the data spec. Either the spec is stale or the code invented a field — update one of them.`,
            `${decl.file}:${codeField.line}`,
            6
          )
        );
      }
    }
  }
  if (!checks.some((c) => c.passed === false)) {
    const total = spec.interfaces.reduce((n, i) => n + i.fields.size, 0);
    checks.push(
      check("data-spec-conformant", true, `All ${spec.interfaces.length} data-spec interface(s) match the code declarations (${total} field(s) compared).`)
    );
  }
  return checks;
}

export function checkData(files, rules, ctx) {
  const checks = [
    ...secretChecks(files, rules, ctx),
    ...urlChecks(files, rules, ctx),
    ...storageChecks(files, ctx),
    ...i18nChecks(files, ctx),
    ...specChecks(files, ctx),
  ];
  if (!checks.some((c) => c.passed === false))
    checks.push(check("data-rules", true, "No credential or endpoint violations found."));
  return checks;
}
