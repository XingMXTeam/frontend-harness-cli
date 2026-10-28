// Import graph + function-span analysis over masked code views.
//
// Everything here runs on the masker's code view, so braces, parens and
// keywords inside strings or comments can no longer distort spans or
// fabricate imports. Specifiers are recovered from the literal table.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { lineAt, literalAfter } from "./mask.js";

// --- character scanners (operate on the masked code view) -----------------

export function matchDelim(code, openIdx, open = "{", close = "}") {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipWs(code, i) {
  while (i < code.length && /\s/.test(code[i])) i++;
  return i;
}

// From just after a parameter list's closing paren, find the body brace,
// tolerating a TypeScript return-type annotation in between.
function bodyBraceAfter(code, closeParenIdx) {
  let i = skipWs(code, closeParenIdx + 1);
  if (code[i] === ":") {
    i++;
    let depth = 0;
    while (i < code.length) {
      const ch = code[i];
      if (ch === "{" && depth === 0) break;
      if (ch === "(" || ch === "[" || ch === "<") depth++;
      else if (ch === ")" || ch === "]" || ch === ">") depth--;
      else if ((ch === ";" || ch === "=") && depth === 0) return -1;
      i++;
    }
  }
  return code[i] === "{" ? i : -1;
}

// End offset of an expression-bodied arrow function: scan until the
// expression's own nesting closes or a statement separator appears.
function expressionEnd(code, start) {
  let depth = 0;
  let i = start;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return i;
      depth--;
    } else if ((ch === "," || ch === ";") && depth === 0) return i;
    else if (ch === "\n" && depth === 0) {
      const rest = code.slice(i + 1).trimStart();
      if (!/^[.&|?:]/.test(rest)) return i;
    }
    i++;
  }
  return i;
}

const CONTROL = new Set([
  "if", "for", "while", "switch", "catch", "return", "function", "with",
  "typeof", "new", "delete", "await", "yield", "else", "do",
]);

// Find function spans: { startLine, endLine, length } for every function
// in the file — size filtering is the caller's job.
export function findFunctions(view) {
  const code = view.code;
  const starts = view.lineStarts;
  const spans = [];
  const seen = new Set();
  const addSpan = (startIdx, endIdx) => {
    if (endIdx < startIdx) return;
    const startLine = lineAt(starts, startIdx);
    const endLine = lineAt(starts, endIdx);
    const key = `${startLine}:${endLine}`;
    if (seen.has(key)) return;
    seen.add(key);
    spans.push({ startLine, endLine, length: endLine - startLine + 1 });
  };
  collectDeclarations(code, addSpan);
  collectArrows(code, addSpan);
  collectMethods(code, addSpan);
  return spans;
}

function collectDeclarations(code, addSpan) {
  const fnRe = /\bfunction\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*\(/g;
  for (const m of code.matchAll(fnRe)) {
    const parenEnd = matchDelim(code, m.index + m[0].length - 1, "(", ")");
    if (parenEnd < 0) continue;
    const brace = bodyBraceAfter(code, parenEnd);
    if (brace < 0) continue;
    const end = matchDelim(code, brace);
    if (end >= 0) addSpan(m.index, end);
  }
}

function collectArrows(code, addSpan) {
  const arrowRe = /=>/g;
  for (const m of code.matchAll(arrowRe)) {
    const bodyStart = skipWs(code, m.index + 2);
    if (code[bodyStart] === "{") {
      const end = matchDelim(code, bodyStart);
      if (end >= 0) addSpan(m.index, end);
    } else if (bodyStart < code.length) {
      addSpan(m.index, expressionEnd(code, bodyStart));
    }
  }
}

function collectMethods(code, addSpan) {
  const methodRe = /(?:^|[\s{;,])((?:async\s+)?(?:get\s+|set\s+)?)([A-Za-z_$][\w$]*)\s*\(/gm;
  for (const m of code.matchAll(methodRe)) {
    if (CONTROL.has(m[2])) continue;
    // `function name(...)` is a declaration, not a method — the
    // declaration pass already recorded it.
    const before = code.slice(0, m.index).trimEnd();
    if (/\bfunction\s*\*?$/.test(before)) continue;
    const parenIdx = m.index + m[0].length - 1;
    const parenEnd = matchDelim(code, parenIdx, "(", ")");
    if (parenEnd < 0) continue;
    const brace = bodyBraceAfter(code, parenEnd);
    if (brace < 0) continue;
    const end = matchDelim(code, brace);
    if (end >= 0) addSpan(m.index, end);
  }
}

// --- import extraction ------------------------------------------------------

const IMPORT_PATTERNS = [
  { re: /\bimport\s*\(/g, kind: "dynamic" },
  { re: /\bimport\s+(?!\()/g, kind: "static" },
  { re: /\bexport\s+(?:\*[\s\S]{0,40}?|\{[^}]*\})\s+from\s*/g, kind: "export" },
  { re: /\brequire\s*\(\s*/g, kind: "require" },
];

export function extractImports(view) {
  const found = [];
  for (const { re, kind } of IMPORT_PATTERNS) {
    for (const m of view.code.matchAll(re)) {
      if (kind === "static" && view.code[m.index + 6] === ".") continue; // import.meta
      const lit = literalAfter(view, m.index + m[0].length);
      if (!lit || lit.value == null) continue;
      found.push({ spec: lit.value, line: lineAt(view.lineStarts, m.index), kind });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

// --- module resolution ------------------------------------------------------

const TRAILING_COMMA = new RegExp(",(" + "\\s*[}\\]])", "g");

// tsconfig/jsconfig parsing that tolerates JSONC (comments, trailing
// commas) — real-world configs are rarely strict JSON.
export function parseJsonc(text) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === "\\") { out += text[i + 1] || ""; i++; }
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return JSON.parse(out.replace(TRAILING_COMMA, "$1"));
}

// Read path aliases from tsconfig.json / jsconfig.json at the root.
// Returns [{ pattern, targets: [root-relative templates] }].
export function loadAliases(root) {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    try {
      const cfg = parseJsonc(readFileSync(path, "utf8"));
      const opts = cfg.compilerOptions || {};
      const baseUrl = (opts.baseUrl || ".").replace(/^\.\//, "").replace(/\/$/, "");
      const aliases = [];
      for (const [pattern, targets] of Object.entries(opts.paths || {})) {
        aliases.push({
          pattern,
          targets: (targets || []).map((t) => {
            const rel = t.replace(/^\.\//, "");
            return baseUrl && baseUrl !== "." ? `${baseUrl}/${rel}` : rel;
          }),
        });
      }
      return aliases;
    } catch {
      return [];
    }
  }
  return [];
}

function normalizePath(path) {
  const parts = [];
  for (const seg of path.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

// Candidate root-relative paths a specifier may refer to (before
// extension/index probing). Empty array = external package.
export function specifierCandidates(fromRel, spec, aliases) {
  if (spec.startsWith(".")) {
    return [normalizePath(`${dirname(fromRel)}/${spec}`)];
  }
  for (const alias of aliases || []) {
    const star = alias.pattern.indexOf("*");
    if (star === -1) {
      if (spec === alias.pattern) return alias.targets.map(normalizePath);
      continue;
    }
    const prefix = alias.pattern.slice(0, star);
    const suffix = alias.pattern.slice(star + 1);
    if (spec.startsWith(prefix) && spec.endsWith(suffix)) {
      const mid = spec.slice(prefix.length, spec.length - suffix.length || undefined);
      return alias.targets.map((t) => normalizePath(t.replace("*", mid)));
    }
  }
  // Convention fallback (Next.js-style): "@/x" means "src/x".
  if (spec.startsWith("@/")) return [`src/${spec.slice(2)}`];
  return [];
}

// Resolve candidates against the scanned file set: exact file, then
// extension probing, then directory index. Returns the file's rel path
// or null when nothing on disk matches.
export function resolveToFile(candidates, fileSet, extensions) {
  for (const cand of candidates) {
    if (fileSet.has(cand)) return cand;
    for (const ext of extensions) if (fileSet.has(cand + ext)) return cand + ext;
    for (const ext of extensions) {
      const idx = `${cand}/index${ext}`;
      if (fileSet.has(idx)) return idx;
    }
  }
  return null;
}

// Detect import cycles over the resolved graph (Map rel -> Set rel).
// Returns up to `limit` cycles, each a list of rel paths (start repeated
// at the end for display).
export function findCycles(graph, limit = 5) {
  const color = new Map();
  const cycles = [];
  const stack = [];
  const visit = (node) => {
    if (cycles.length >= limit) return;
    color.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      if (cycles.length >= limit) break;
      const c = color.get(next) || 0;
      if (c === 1) cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (c === 0) visit(next);
    }
    stack.pop();
    color.set(node, 2);
  };
  for (const node of graph.keys()) {
    if ((color.get(node) || 0) === 0) visit(node);
    if (cycles.length >= limit) break;
  }
  return cycles;
}
