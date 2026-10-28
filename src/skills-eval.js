/**
 * Skill self-evaluation scoring.
 *
 * The kernel cannot watch a host session and see which skill fired — so,
 * exactly like judge rubric items, it administers the protocol and scores
 * the evidence deterministically:
 *
 *   1. `harness skills eval` emits the case packet (golden set).
 *   2. A FRESH host session (never the one that wrote/edited the skills)
 *      runs each prompt with the pack installed and records which bundled
 *      skill, if any, it invoked.
 *   3. The evidence file comes back; this module scores it.
 *
 * A skill change that ships without this loop is an ungraded edit to the
 * workflow's own rules — the exact failure mode that poisons a harness
 * over time (one incident becomes a global rule, nobody checks the blast
 * radius). Cases should stay near 80% should-trigger / 20% should-not.
 */
export function scoreSkillEval(cases, results, minAccuracy = 0.9) {
  const byId = new Map(results.map((r) => [r.id, r.triggered ?? null]));
  let correct = 0;
  const missed = [];
  const falseTriggers = [];
  const perSkill = {};
  for (const c of cases) {
    const got = byId.has(c.id) ? byId.get(c.id) : undefined;
    const key = c.expect ?? '(none)';
    perSkill[key] = perSkill[key] ?? { total: 0, correct: 0 };
    perSkill[key].total += 1;
    if (got === c.expect) {
      correct += 1;
      perSkill[key].correct += 1;
    } else if (c.expect === null) {
      falseTriggers.push({ id: c.id, triggered: got ?? null });
    } else {
      missed.push({ id: c.id, expect: c.expect, got: got ?? null });
    }
  }
  const total = cases.length;
  const accuracy = total === 0 ? 0 : correct / total;
  return {
    total,
    correct,
    accuracy: Math.round(accuracy * 1000) / 1000,
    minAccuracy,
    missed,
    falseTriggers,
    perSkill,
    unevidenced: cases.filter((c) => !byId.has(c.id)).map((c) => c.id),
    verdict: accuracy >= minAccuracy ? 'pass' : 'fail',
  };
}
