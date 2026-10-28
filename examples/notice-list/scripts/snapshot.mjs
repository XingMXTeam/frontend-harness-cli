// Evaluator helper: render every state to a standalone HTML artifact the
// judge evidence can cite (a browser-free stand-in when Playwright is not
// available; with Playwright, cite the harness capture PNGs instead).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderNoticeList } from '../src/notice-list.js';
import fixtures from '../fixtures.js';

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const css = ['src/tokens.css', 'src/notice-list.css'].map((f) => readFileSync(f, 'utf8')).join('\n');
for (const [state, view] of Object.entries(fixtures)) {
  writeFileSync(path.join(out, `render-${state}.html`), `<!doctype html><style>${css}</style>${renderNoticeList(view)}\n`);
}
console.log(`wrote ${Object.keys(fixtures).length} renders to ${out}`);
