import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Plan-scope guard: a plan document may declare an editable scope — a
// section titled "Editable scope" (or "可改范围") whose bullet lines carry
// backticked path globs. Any changed file outside that scope is flagged:
// agents (and humans) should only touch what the plan said they would.

export function parseEditableScope(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) =>
    /^##\s+(?:\d+\.\s*)?(Editable scope|可改范围)\s*$/i.test(line)
  );
  if (start < 0) return null; // legacy plan without a scope section: not blocked
  const paths = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    if (!line.trim().startsWith("-")) continue;
    const tick = line.match(/`([^`]+)`/);
    if (tick) paths.push(tick[1].replace(/^\.\//, ""));
  }
  return paths;
}

export function matchScope(file, pattern) {
  const norm = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const target = file.replace(/\\/g, "/");
  if (norm.endsWith("/**")) {
    const prefix = norm.slice(0, -3);
    return target === prefix || target.startsWith(`${prefix}/`);
  }
  if (norm.endsWith("/*")) {
    const prefix = norm.slice(0, -2);
    if (!target.startsWith(`${prefix}/`)) return false;
    return !target.slice(prefix.length + 1).includes("/");
  }
  return target === norm;
}

export function checkScope(root, planPath) {
  const patterns = parseEditableScope(readFileSync(planPath, "utf8"));
  if (patterns === null) {
    return { ok: true, note: "plan has no editable-scope section — nothing enforced", outside: [] };
  }
  let changed;
  try {
    const out = execSync("git status --porcelain", { cwd: root, encoding: "utf8" });
    changed = out.split("\n").filter(Boolean).map((l) => l.slice(3).trim()).filter(Boolean);
  } catch {
    return { ok: false, reason: "not a git repository — cannot compute the change set", outside: [] };
  }
  const outside = changed.filter(
    (f) => !patterns.some((p) => matchScope(f, p))
  );
  return {
    ok: outside.length === 0,
    outside,
    patterns,
    reason:
      outside.length > 0
        ? "Changed files outside the plan's editable scope. Either the plan grows (with a human's agreement) or the change shrinks."
        : undefined,
  };
}
