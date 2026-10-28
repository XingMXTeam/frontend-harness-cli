import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { featureDir } from './config.js';

/**
 * Quality vision: the per-feature answer to "what does GOOD look like here",
 * written during clarify, before any code. Anchors are numbered so rubric
 * judge items can cite them — a quality judgment without an anchor is just
 * a vibe, and vibes are how "layout is fine" passed review on ugly pages.
 *
 * Format (one anchor per line, anywhere in vision.md):
 *   REF-1:  <positive reference — what good looks like, and where to see it>
 *   ANTI-1: <anti-reference — what to avoid, and why>
 *   RL-1:   <red line — never acceptable> (check: screenshot|dom|command)
 */
export const ANCHOR_ID = /^(REF|ANTI|RL)-\d+$/;

export function visionPath(root, feature) {
  return path.join(featureDir(root, feature), 'vision.md');
}

export function parseVision(text) {
  const anchors = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:[-*]\s*)?(REF|ANTI|RL)-(\d+)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const id = `${m[1]}-${m[2]}`;
    if (!anchors.has(id)) anchors.set(id, { id, type: m[1], text: m[3].trim() });
  }
  return anchors;
}

export function loadVision(root, feature) {
  const file = visionPath(root, feature);
  if (!existsSync(file)) return null;
  return parseVision(readFileSync(file, 'utf8'));
}

/** Structural problems with the vision document itself. */
export function visionProblems(anchors) {
  const problems = [];
  const byType = (t) => [...anchors.values()].filter((a) => a.type === t);
  if (byType('REF').length < 1) problems.push('vision.md needs at least one REF-n anchor (a positive reference: what good looks like)');
  if (byType('ANTI').length < 1) problems.push('vision.md needs at least one ANTI-n anchor (an anti-reference: what to avoid)');
  const rls = byType('RL');
  if (rls.length < 2) problems.push('vision.md needs at least two RL-n red lines');
  for (const rl of rls) {
    if (!/check\s*:\s*(screenshot|dom|command)/i.test(rl.text)) {
      problems.push(`${rl.id}: a red line must declare how it is checked — append "(check: screenshot|dom|command)"`);
    }
  }
  return problems;
}
