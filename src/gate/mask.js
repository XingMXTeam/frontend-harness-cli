// Code masker: the foundation of accurate (AST-grade) checks without a
// parser dependency. For each source file it produces three position-
// preserving views of the same text — every view has exactly the same
// length and the same line/column layout as the original:
//
//   code      string-literal and template-literal *contents*, regex
//             literals and comments are blanked to spaces (delimiters
//             stay). Template `${...}` expressions stay — they are
//             real code. Patterns like `any` or `console.log` can no
//             longer fire on words inside strings or comments.
//   comments  only comment text survives (checks whose subject lives
//             in comments: deferred-work markers, @ts-ignore).
//   strings   only literal *contents* survive (checks whose subject
//             lives in literals: URLs, hex colors, var(--token) uses).
//
// It also returns the literal table (position + value of every string)
// so import specifiers and call arguments can be recovered exactly.

const BLANK = (ch) => (ch === "\n" || ch === "\r" ? ch : " ");

function makeViews(source) {
  const n = source.length;
  const comments = new Array(n).fill(" ");
  const strings = new Array(n).fill(" ");
  for (let i = 0; i < n; i++) {
    if (source[i] === "\n") { comments[i] = "\n"; strings[i] = "\n"; }
  }
  return { code: source.split(""), comments, strings, literals: [] };
}

function finishViews(v) {
  return {
    code: v.code.join(""),
    comments: v.comments.join(""),
    strings: v.strings.join(""),
    literals: v.literals,
  };
}

function blankRange(view, from, to, source) {
  for (let k = from; k < to; k++) view.code[k] = BLANK(source[k]);
}

// Scanners: each consumes one construct starting at i and returns the
// index just past it. All mutate the views in place.
function scanLineComment(source, i, v) {
  let j = i;
  while (j < source.length && source[j] !== "\n") {
    v.comments[j] = source[j];
    v.code[j] = BLANK(source[j]);
    j++;
  }
  return j;
}

function scanBlockComment(source, i, v) {
  let j = i;
  while (j < source.length && !(source[j] === "*" && source[j + 1] === "/")) {
    v.comments[j] = source[j];
    v.code[j] = BLANK(source[j]);
    j++;
  }
  if (j < source.length) {
    for (const k of [j, j + 1]) {
      v.comments[k] = source[k];
      v.code[k] = BLANK(source[k]);
    }
    j += 2;
  }
  return j;
}

function scanQuoted(source, i, v) {
  const quote = source[i];
  const lit = { start: i, end: i + 1, value: "", quote };
  let j = i + 1;
  let value = "";
  while (j < source.length && source[j] !== quote && source[j] !== "\n") {
    if (source[j] === "\\" && j + 1 < source.length) {
      value += source[j] + source[j + 1];
      j += 2;
      continue;
    }
    value += source[j];
    j++;
  }
  lit.value = value;
  lit.end = Math.min(j + 1, source.length);
  for (let k = i + 1; k < j; k++) {
    v.strings[k] = source[k];
    v.code[k] = BLANK(source[k]);
  }
  v.literals.push(lit);
  return lit.end;
}

function scanRegex(source, i, v) {
  let j = i + 1;
  let inClass = false;
  while (j < source.length && source[j] !== "\n") {
    if (source[j] === "\\") { j += 2; continue; }
    if (source[j] === "[") inClass = true;
    else if (source[j] === "]") inClass = false;
    else if (source[j] === "/" && !inClass) break;
    j++;
  }
  blankRange(v, i, Math.min(j + 1, source.length), source);
  let e = j + 1;
  while (e < source.length && /[a-z]/i.test(source[e])) {
    v.code[e] = BLANK(source[e]);
    e++;
  }
  return e;
}

// A `/` starts a regex literal when the previous significant token
// cannot end an expression (standard heuristic).
function regexAllowed(last) {
  if (!last) return true;
  return !/[\w$\)\]\}]/.test(last);
}

// One state-machine step inside a template literal. Returns the index
// to continue from.
function stepTemplate(source, i, v, state) {
  const frame = state.stack[state.stack.length - 1];
  const ch = source[i];
  if (ch === "\\") {
    v.strings[i] = source[i];
    v.code[i] = BLANK(source[i]);
    if (i + 1 < source.length) {
      v.strings[i + 1] = source[i + 1];
      v.code[i + 1] = BLANK(source[i + 1]);
    }
    return i + 2;
  }
  if (ch === "`") {
    frame.literal.end = i + 1;
    v.literals.push(frame.literal);
    state.stack.pop();
    state.last = "`";
    return i + 1;
  }
  if (ch === "$" && source[i + 1] === "{") {
    state.stack.push({ type: "expr", depth: 0 });
    return i + 2;
  }
  v.strings[i] = source[i];
  v.code[i] = BLANK(source[i]);
  return i + 1;
}

// One step in code context (top level or a template `${...}` frame).
function stepCode(source, i, v, state) {
  const ch = source[i];
  const frame = state.stack[state.stack.length - 1];
  if (ch === "/" && source[i + 1] === "/") return scanLineComment(source, i, v);
  if (ch === "/" && source[i + 1] === "*") return scanBlockComment(source, i, v);
  if (ch === "'" || ch === '"') {
    state.last = ch;
    return scanQuoted(source, i, v);
  }
  if (ch === "`") {
    state.stack.push({
      type: "template",
      literal: { start: i, end: source.length, value: null, quote: "`" },
    });
    return i + 1;
  }
  if (ch === "/" && regexAllowed(state.last)) {
    state.last = "/";
    return scanRegex(source, i, v);
  }
  if (frame.type === "expr") {
    if (ch === "{") frame.depth++;
    else if (ch === "}") {
      if (frame.depth === 0) { state.stack.pop(); return i + 1; }
      frame.depth--;
    }
  }
  if (!/\s/.test(ch)) state.last = ch;
  return i + 1;
}

export function maskJs(source) {
  const v = makeViews(source);
  const state = { stack: [{ type: "code" }], last: "" };
  let i = 0;
  while (i < source.length) {
    const top = state.stack[state.stack.length - 1];
    i = top.type === "template"
      ? stepTemplate(source, i, v, state)
      : stepCode(source, i, v, state);
  }
  // An unterminated template literal at EOF still closes out.
  for (const f of state.stack) if (f.type === "template") v.literals.push(f.literal);
  v.literals.sort((a, b) => a.start - b.start);
  return finishViews(v);
}

// CSS-flavoured masking: no line comments, no template literals, no
// regex literals — only /* */ comments and quoted strings are masked.
export function maskCss(source) {
  const v = makeViews(source);
  let i = 0;
  while (i < source.length) {
    if (source[i] === "/" && source[i + 1] === "*") i = scanBlockComment(source, i, v);
    else if (source[i] === "'" || source[i] === '"') i = scanQuoted(source, i, v);
    else i++;
  }
  return finishViews(v);
}

export function maskSource(source, rel = "") {
  if (/\.(css|scss|sass|less)$/.test(rel)) return maskCss(source);
  return maskJs(source);
}

// Line-start offsets for offset -> line conversion (1-based lines).
export function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

export function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// The first literal at or after `pos` within the same statement: the
// code between `pos` and the literal's opening quote must not cross a
// stop character (`;` by default — statement end; call sites also stop
// at `)` so a later argument is never mistaken for the first one).
// Because the code view has strings blanked, a `;` or `)` seen here is
// always real code, never string content.
export function literalAfter(view, pos, stopChars = ";") {
  for (const lit of view.literals) {
    if (lit.start < pos) continue;
    const between = view.code.slice(pos, lit.start);
    if ([...stopChars].some((c) => between.includes(c))) return null;
    return lit;
  }
  return null;
}
