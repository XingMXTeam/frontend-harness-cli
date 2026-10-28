import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { featureDir, harnessDir } from './config.js';

/**
 * Evidence capture: real screenshots of the routes a feature touches,
 * taken with Playwright, validated before they may count as evidence,
 * and compared against baselines with a pixel diff.
 *
 * Rules (each one is a defect seen in practice, now made impossible):
 *  - A capture that is not a PNG, or is smaller than minBytes, is a
 *    failed capture — a blank page compresses to almost nothing.
 *  - Placeholder images are never written unless --allow-fallback is
 *    passed, and then the manifest says so in a top-level status that no
 *    downstream check treats as a pass.
 *  - A page with no baseline is reported as "no-baseline", never as a
 *    match. Adopting a baseline is an explicit, recorded act.
 *  - The diff is pixel-based with a tolerance (pixelmatch), not a file
 *    hash: anti-aliasing must not fail a run, a changed layout must.
 *
 * Playwright, pixelmatch and pngjs are optional peer dependencies of the
 * project under test. Nothing here imports them until a command needs
 * them, and a missing one produces an install instruction, not a stack.
 */

export const DEFAULT_MIN_BYTES = 2048;
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
// 1x1 transparent PNG — only ever written under --allow-fallback.
const PLACEHOLDER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAukB9oL2rS8AAAAASUVORK5CYII=', 'base64');

export class MissingPeerError extends Error {}

export function pagesPath(root, feature) {
  return path.join(featureDir(root, feature), 'pages.json');
}
export function evidenceRoot(root, feature) {
  return path.join(featureDir(root, feature), 'evidence');
}
export function defaultBaselineDir(root) {
  return path.join(harnessDir(root), 'baselines');
}

/** Validate and normalize a pages config. Throws with an actionable message. */
export function normalizePages(raw, source = 'pages.json') {
  const cfg = Array.isArray(raw) ? { pages: raw } : raw ?? {};
  if (!Array.isArray(cfg.pages) || cfg.pages.length === 0) {
    throw new Error(`${source}: "pages" must be a non-empty array of {name, route}. The planner writes it during tech design (see write-tech-design).`);
  }
  const names = new Set();
  const outputs = new Set();
  const pages = cfg.pages.map((p, i) => {
    const route = String(p?.route ?? '').trim();
    const name = String(p?.name ?? '').trim();
    if (!route.startsWith('/')) throw new Error(`${source}: pages[${i}].route must start with "/" (got "${p?.route ?? ''}").`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`${source}: pages[${i}].name must be kebab-case (got "${p?.name ?? ''}").`);
    if (names.has(name)) throw new Error(`${source}: duplicate page name "${name}".`);
    const output = String(p.output ?? `${name}.png`);
    if (!output.toLowerCase().endsWith('.png')) throw new Error(`${source}: pages[${i}].output must end with .png.`);
    if (outputs.has(output)) throw new Error(`${source}: duplicate output "${output}".`);
    names.add(name);
    outputs.add(output);
    return { name, route, output, waitFor: p.waitFor ?? null };
  });
  const vp = cfg.viewport ?? DEFAULT_VIEWPORT;
  if (!(vp.width > 0 && vp.height > 0)) throw new Error(`${source}: viewport needs positive width and height.`);
  return {
    baseUrl: cfg.baseUrl ?? null,
    viewport: { width: vp.width, height: vp.height },
    fullPage: cfg.fullPage ?? false,
    waitUntil: cfg.waitUntil ?? 'load',
    baselineDir: cfg.baselineDir ?? null,
    pages,
  };
}

export function loadPages(root, feature, file = null) {
  const p = file ? path.resolve(root, file) : pagesPath(root, feature);
  if (!existsSync(p)) {
    throw new Error(`No pages config at ${path.relative(root, p)}. The planner writes it during tech design: {"pages": [{"name": "home", "route": "/"}]}.`);
  }
  let raw;
  try { raw = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw new Error(`${path.relative(root, p)} is not valid JSON: ${e.message}`); }
  return normalizePages(raw, path.relative(root, p));
}

/** {ok, bytes, reason} — the gate every captured file passes before it counts. */
export function checkPng(file, minBytes = DEFAULT_MIN_BYTES) {
  if (!existsSync(file)) return { ok: false, bytes: 0, reason: 'file was not written' };
  const buf = readFileSync(file);
  const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng) return { ok: false, bytes: buf.length, reason: 'not a PNG file' };
  if (buf.length < minBytes) return { ok: false, bytes: buf.length, reason: `PNG is ${buf.length}B < ${minBytes}B — the page most likely did not render` };
  return { ok: true, bytes: buf.length, reason: null };
}

// ─── optional peers ──────────────────────────────────────────────────────────

const INSTALL_HINT = {
  playwright: 'npm i -D playwright && npx playwright install chromium',
  pixelmatch: 'npm i -D pixelmatch pngjs',
  pngjs: 'npm i -D pixelmatch pngjs',
};

/** Import an optional peer from the project under test (not from this package). */
export async function loadPeer(root, names, label) {
  const envKey = `HARNESS_${label.toUpperCase()}_MODULE`;
  const override = process.env[envKey];
  const candidates = override ? [override] : names;
  const req = createRequire(path.join(root, 'package.json'));
  for (const name of candidates) {
    let resolved;
    try {
      resolved = path.isAbsolute(name) ? name : req.resolve(name);
    } catch {
      continue;
    }
    const mod = await import(pathToFileURL(resolved).href);
    return { mod, name: override ? `${label} (${envKey})` : name };
  }
  throw new MissingPeerError(`${label} is not installed in this project (${root}). It is an optional peer of frontend-harness-cli, needed only for this command.\nInstall: ${INSTALL_HINT[label] ?? `npm i -D ${label}`}`);
}

async function probe(url, timeoutMs = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(`Cannot reach ${url}: ${e.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : e.message}\nStart the app first (the dev server named in tech-design.md), or pass --base-url.`);
  } finally {
    clearTimeout(timer);
  }
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Capture every configured page. Returns the manifest (also written to
 * <runDir>/manifest.json and evidence/latest.json).
 */
export async function capturePages(root, feature, opts = {}) {
  const cfg = loadPages(root, feature, opts.pagesFile);
  const baseUrl = String(opts.baseUrl ?? cfg.baseUrl ?? process.env.BASE_URL ?? '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('No base URL: pass --base-url, set BASE_URL, or put "baseUrl" in pages.json.');
  const minBytes = opts.minBytes ?? DEFAULT_MIN_BYTES;
  const runId = opts.runId ?? stamp();
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error(`run id "${runId}" must be [A-Za-z0-9._-]+`);

  const { mod, name: tool } = await loadPeer(root, ['playwright', '@playwright/test'], 'playwright');
  const chromium = mod.chromium ?? mod.default?.chromium;
  if (!chromium) throw new MissingPeerError('The installed playwright module exposes no chromium launcher.');
  if (!opts.skipProbe) await probe(baseUrl);

  const runDir = path.join(evidenceRoot(root, feature), runId);
  mkdirSync(runDir, { recursive: true });
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');

  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    throw new MissingPeerError(`Playwright is installed but could not launch Chromium: ${String(e.message).split('\n')[0]}\nInstall the browser: npx playwright install chromium`);
  }
  const results = [];
  try {
    const page = await browser.newPage({ viewport: cfg.viewport });
    for (const target of cfg.pages) {
      const file = path.join(runDir, target.output);
      const url = `${baseUrl}${target.route}`;
      let check;
      let error = null;
      try {
        await page.goto(url, { waitUntil: cfg.waitUntil, timeout: opts.timeoutMs ?? 30000 });
        if (target.waitFor) await page.waitForSelector(target.waitFor, { timeout: opts.timeoutMs ?? 30000 });
        await page.screenshot({ path: file, fullPage: cfg.fullPage });
        check = checkPng(file, minBytes);
        if (!check.ok) error = check.reason;
      } catch (e) {
        check = { ok: false, bytes: 0 };
        error = String(e.message ?? e).split('\n')[0];
      }
      let usedFallback = false;
      if (!check.ok && opts.allowFallback) {
        writeFileSync(file, PLACEHOLDER_PNG);
        usedFallback = true;
      }
      results.push({ name: target.name, route: target.route, url, file: rel(file), bytes: check.bytes, ok: check.ok, usedFallback, error });
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const anyFail = results.some((r) => !r.ok);
  const anyFallback = results.some((r) => r.usedFallback);
  const manifest = {
    feature,
    runId,
    status: anyFallback ? 'fallback' : anyFail ? 'fail' : 'pass',
    note: anyFallback ? 'Placeholder images were written for failed pages (--allow-fallback). This run is NOT evidence.' : null,
    tool,
    baseUrl,
    viewport: cfg.viewport,
    fullPage: cfg.fullPage,
    minBytes,
    generatedAt: new Date().toISOString(),
    dir: rel(runDir),
    pages: results,
  };
  writeFileSync(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(evidenceRoot(root, feature), 'latest.json'), `${JSON.stringify({ runId, status: manifest.status, dir: manifest.dir }, null, 2)}\n`);
  return manifest;
}

export function loadRunManifest(root, feature, runId = 'latest') {
  let id = runId;
  if (!id || id === 'latest') {
    const latest = path.join(evidenceRoot(root, feature), 'latest.json');
    if (!existsSync(latest)) throw new Error(`No capture run for "${feature}" yet. Run: harness capture ${feature}`);
    id = JSON.parse(readFileSync(latest, 'utf8')).runId;
  }
  const file = path.join(evidenceRoot(root, feature), id, 'manifest.json');
  if (!existsSync(file)) throw new Error(`No manifest for run "${id}" (${path.relative(root, file)}).`);
  return { manifest: JSON.parse(readFileSync(file, 'utf8')), runDir: path.dirname(file) };
}

/**
 * Compare a run against baselines. `load` lazily returns {pixelmatch, PNG}
 * and is only called when at least one baseline exists, so "no baseline"
 * is reported even where the diff libraries are not installed.
 */
export async function comparePages({ pages, runDir, baselineDir, maxDiffRatio, threshold, load }) {
  const results = [];
  let libs = null;
  for (const p of pages) {
    const actual = path.join(runDir, path.basename(p.file));
    const baseline = path.join(baselineDir, `${p.name}.png`);
    if (!existsSync(baseline)) {
      results.push({ name: p.name, route: p.route, status: 'no-baseline', baseline: null });
      continue;
    }
    libs ??= await load();
    const { pixelmatch, PNG } = libs;
    const a = PNG.sync.read(readFileSync(baseline));
    const b = PNG.sync.read(readFileSync(actual));
    if (a.width !== b.width || a.height !== b.height) {
      results.push({ name: p.name, route: p.route, status: 'size-mismatch', detail: `baseline ${a.width}x${a.height} vs actual ${b.width}x${b.height}` });
      continue;
    }
    const diff = new PNG({ width: a.width, height: a.height });
    const mismatched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold });
    const ratio = mismatched / (a.width * a.height);
    const diffFile = path.join(runDir, `${p.name}-diff.png`);
    writeFileSync(diffFile, PNG.sync.write(diff));
    results.push({ name: p.name, route: p.route, status: ratio <= maxDiffRatio ? 'match' : 'diff', ratio: Math.round(ratio * 10000) / 10000, mismatched, maxDiffRatio, diffImage: diffFile });
  }
  const failed = results.filter((r) => r.status === 'diff' || r.status === 'size-mismatch');
  const missing = results.filter((r) => r.status === 'no-baseline');
  return {
    verdict: failed.length ? 'fail' : missing.length ? 'no-baseline' : 'pass',
    failed: failed.map((r) => r.name),
    noBaseline: missing.map((r) => r.name),
    results,
  };
}

export async function loadDiffLibs(root) {
  const pm = await loadPeer(root, ['pixelmatch'], 'pixelmatch');
  const pj = await loadPeer(root, ['pngjs'], 'pngjs');
  const pixelmatch = typeof pm.mod.default === 'function' ? pm.mod.default : pm.mod;
  const PNG = pj.mod.PNG ?? pj.mod.default?.PNG;
  if (typeof pixelmatch !== 'function' || !PNG) throw new MissingPeerError('pixelmatch / pngjs loaded but did not expose the expected API (pixelmatch function, PNG class).');
  return { pixelmatch, PNG };
}

/** Adopt a run's screenshots as the baselines. Only a clean run may become a baseline. */
export function adoptBaselines(root, manifest, runDir, baselineDir) {
  if (manifest.status !== 'pass') throw new Error(`Run ${manifest.runId} has status "${manifest.status}" — only a clean capture can become a baseline.`);
  mkdirSync(baselineDir, { recursive: true });
  const adopted = [];
  for (const p of manifest.pages) {
    copyFileSync(path.join(runDir, path.basename(p.file)), path.join(baselineDir, `${p.name}.png`));
    adopted.push(p.name);
  }
  const mf = path.join(baselineDir, 'manifest.json');
  const prev = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : { pages: {} };
  for (const name of adopted) prev.pages[name] = { fromFeature: manifest.feature, fromRun: manifest.runId, viewport: manifest.viewport, adoptedAt: new Date().toISOString() };
  writeFileSync(mf, `${JSON.stringify(prev, null, 2)}\n`);
  return adopted;
}

export function fileBytes(p) {
  return existsSync(p) ? statSync(p).size : 0;
}
