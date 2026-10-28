import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { globMatch } from "./config.js";

// For single-file components (.vue / .svelte), only the <script> blocks
// are code the checks understand. Everything outside them is blanked to
// spaces — positions and line numbers stay identical to the real file,
// so evidence still points at the true line.
export function extractScriptBlocks(content) {
  const chars = content.split("");
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  const keep = new Array(content.length).fill(false);
  for (const m of content.matchAll(scriptRe)) {
    const start = m.index + m[0].indexOf(m[1]);
    for (let i = start; i < start + m[1].length; i++) keep[i] = true;
  }
  for (let i = 0; i < chars.length; i++) {
    if (!keep[i] && chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  }
  return chars.join("");
}

// Recursively collect source files under root, honoring the ignore list
// (directory names) and the exclude globs (project-relative paths).
export function collectFiles(root, config) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (config.ignore.includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (config.extensions.includes(extname(entry.name))) {
        const rel = relative(root, full);
        if ((config.exclude || []).some((g) => globMatch(g, rel))) continue;
        let content = readFileSync(full, "utf8");
        if (extname(entry.name) === ".vue" || extname(entry.name) === ".svelte") {
          content = extractScriptBlocks(content);
        }
        files.push({ path: full, rel, content });
      }
    }
  };
  walk(root);
  return files;
}

export function isTestFile(rel) {
  return /(\.test|\.spec)\.[^.]+$/.test(rel) || /(^|\/)(tests|__tests__)\//.test(rel);
}
