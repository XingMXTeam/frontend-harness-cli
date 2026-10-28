import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { featureDir } from './config.js';

export const LEVELS = ['essential', 'important', 'optional', 'pitfall'];
export const KINDS = ['command', 'file', 'grep', 'judge', 'scan'];
export const SCAN_DIMENSIONS = ['structure', 'data', 'logic', 'ui', 'e2e'];

export function rubricPath(root, feature) {
  return path.join(featureDir(root, feature), 'rubric.json');
}

export function loadRubric(root, feature) {
  const file = rubricPath(root, feature);
  if (!existsSync(file)) {
    throw new Error(`No rubric.json for "${feature}" (${file}). The planner must write it before implementation starts.`);
  }
  const rubric = JSON.parse(readFileSync(file, 'utf8'));
  validateRubric(rubric);
  return rubric;
}

export function validateRubric(rubric) {
  if (!Array.isArray(rubric.requirements) || rubric.requirements.length === 0) {
    throw new Error('rubric.requirements must be a non-empty array.');
  }
  if (!Array.isArray(rubric.items) || rubric.items.length === 0) {
    throw new Error('rubric.items must be a non-empty array.');
  }
  const reqIds = new Set();
  for (const r of rubric.requirements) {
    if (!r.id) throw new Error('Every requirement needs an id.');
    if (reqIds.has(r.id)) throw new Error(`Duplicate requirement id: ${r.id}`);
    reqIds.add(r.id);
  }
  const itemIds = new Set();
  for (const it of rubric.items) {
    if (!it.id) throw new Error('Every rubric item needs an id.');
    if (itemIds.has(it.id)) throw new Error(`Duplicate rubric item id: ${it.id}`);
    itemIds.add(it.id);
    if (!LEVELS.includes(it.level)) throw new Error(`Item ${it.id}: level must be one of ${LEVELS.join('/')}.`);
    if (!KINDS.includes(it.kind)) throw new Error(`Item ${it.id}: kind must be one of ${KINDS.join('/')}.`);
    if (it.requirement && !reqIds.has(it.requirement)) {
      throw new Error(`Item ${it.id}: maps to unknown requirement "${it.requirement}".`);
    }
    if (it.kind === 'command' && !it.command) throw new Error(`Item ${it.id}: kind=command needs a command.`);
    if (it.kind === 'file' && !it.path) throw new Error(`Item ${it.id}: kind=file needs a path.`);
    if (it.kind === 'grep' && (!it.path || !it.pattern)) throw new Error(`Item ${it.id}: kind=grep needs path and pattern.`);
    if (it.kind === 'judge' && !it.evidence) throw new Error(`Item ${it.id}: kind=judge needs an evidence file path (the evaluator writes {score, note} there).`);
    if (it.kind === 'scan') {
      if (!SCAN_DIMENSIONS.includes(it.dimension)) throw new Error(`Item ${it.id}: kind=scan needs dimension one of ${SCAN_DIMENSIONS.join('/')}.`);
      if (typeof it.minScore !== 'number') throw new Error(`Item ${it.id}: kind=scan needs a numeric minScore.`);
    }
    it.weight = typeof it.weight === 'number' && it.weight > 0 ? it.weight : 1;
  }
  return rubric;
}

/**
 * Coverage gate: implementation may not start until every requirement is
 * mapped by at least one scoring item AND at least one essential item.
 * This is what stops the denominator of the score being gamed by simply
 * not writing checks for the hard requirements.
 */
export function coverageGaps(rubric) {
  const gaps = [];
  for (const req of rubric.requirements) {
    const mapped = rubric.items.filter((i) => i.requirement === req.id && i.level !== 'pitfall');
    if (mapped.length === 0) gaps.push({ requirement: req.id, problem: 'no rubric item maps to this requirement' });
    else if (!mapped.some((i) => i.level === 'essential')) gaps.push({ requirement: req.id, problem: 'no essential item maps to this requirement' });
  }
  return gaps;
}
