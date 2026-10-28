import { execSync } from "node:child_process";
import { globMatch } from "./config.js";

function gitChangedFiles(root) {
  try {
    const out = execSync("git status --porcelain", { cwd: root, encoding: "utf8" });
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return null; // not a git repository
  }
}

// Protected zone: files an automated agent must not change on its own.
// If any protected path has uncommitted changes and a human has not
// confirmed (GATE_HUMAN_CONFIRM=yes), the run is blocked. The gate must
// never be able to quietly rewrite its own rules.
export function verifyZone(root, config) {
  const changed = gitChangedFiles(root);
  if (changed === null) {
    return { ok: false, reason: "not a git repository — cannot verify the protected zone", touched: [] };
  }
  const touched = changed.filter((f) =>
    (config.protectedPaths || []).some((p) => globMatch(p, f))
  );
  if (touched.length === 0) return { ok: true, touched: [] };
  if (process.env.GATE_HUMAN_CONFIRM === "yes") {
    return { ok: true, touched, note: "protected files changed, human confirmation present" };
  }
  return {
    ok: false,
    touched,
    reason:
      "Protected files were changed without human confirmation. A human must review the diff, then re-run with GATE_HUMAN_CONFIRM=yes.",
  };
}
