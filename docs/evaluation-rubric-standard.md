# Evaluation rubric standard

How a feature's `rubric.json` is built and scored. The idea follows the
"rubrics as rewards" line of work: replace one opaque judgment ("is it
good?") with many small, independently checkable criteria, each with an
importance, so the score explains itself and a model cannot average its
way past a dead core.

## 1. Principles

1. **Grounded.** Each item states a fact the feature must make true — a
   behavior, a value, a state — not a technique ("uses virtual
   scrolling" is a technique; "scrolling 10,000 rows stays above 30 fps"
   is a fact).
2. **Observable.** A third party can check it from outside: a command's
   exit code, a DOM query, a screenshot, a measured number.
3. **Self-contained.** One item, one check. No "and also"; no reference to
   another item's outcome.
4. **Weighted by importance.** Essentials, important items, optional
   polish and pitfalls are different things and are scored differently.
5. **Anchored.** Quality items (UI, interaction) cite an anchor in
   `vision.md` — a positive reference (REF-n), an anti-reference (ANTI-n)
   or a red line (RL-n). An unanchored quality item is a vibe.
6. **Deterministic first.** If a script can decide it, a script decides
   it (`command`, `file`, `grep`, `scan`). `judge` is for what only an
   evaluator can see, and is fenced (section 4).

## 2. Layers

| Layer | Concern | Weight | Typical sub-areas |
| --- | --- | --- | --- |
| L1 | Functional correctness | 0.40 | data logic, state, conditions, API integration |
| L2 | Robustness | 0.25 | boundary input, error handling, concurrency/timing, permissions |
| L3 | UI presentation | 0.20 | render completeness, layout, hierarchy, responsiveness, tokens |
| L4 | Interaction experience | 0.15 | feedback, loading, recovery, efficiency, accessibility |

Turn layering on in `rubric.json` with `"layerWeights": true` (the
weights above) or an explicit object `{ "L1": 0.4, ... }`. In layered
mode every item needs `"layer": "L1" | "L2" | "L3" | "L4"` (a suffix such
as `"L3-ui"` is fine). Without `layerWeights` the rubric is scored flat,
exactly as before v0.5.

## 3. Levels

| Level | Meaning | Default weight (layered mode) | Effect |
| --- | --- | --- | --- |
| essential | must hold for the feature to exist | 1.0 | score 0 → **veto** (fail at any total) |
| important | expected quality; missing it is visible | 0.7 | weighted |
| optional | polish that separates good from fine | 0.3 | weighted |
| pitfall | a named defect that must never ship | — | triggered → **veto** |

An explicit `"weight"` on an item overrides the default. Pitfalls are not
subtracted from the score: the kernel treats any triggered pitfall as a
veto, which is stricter than a deduction and cannot be outweighed. Write
pitfalls so the check **passes when the defect is absent** (e.g. a
`grep` with `"expect": "absent"`, a `command` that exits 0 when clean).

## 4. Scores

- Deterministic kinds score 0 or 1.
- `judge` items score exactly **1** (fully met), **0.5** (met with a
  visible but non-blocking flaw; the core works) or **0** (not met, or
  the item's defect is present). The evaluator writes
  `{ "score", "note", "artifacts": [paths], "heuristics": [ids] }` to the
  item's `evidence` path. The note says *why this score*, pointing at
  the artifact (screenshot, response, test output).
- A judge item with no evidence, stale evidence (older than the work or
  the previous evaluation), or evidence citing a missing artifact scores
  0. A judge item anchored on a red line checked by `screenshot` must
  cite at least one real PNG.

## 5. Formula

Flat mode: `score = Σ(score_i × weight_i) / Σ(weight_i)` over non-pitfall
items.

Layered mode:

```
layer_score(L) = Σ(score_i × weight_i) / Σ(weight_i)        for non-pitfall items in L
total          = Σ(layer_score(L) × layerWeight(L)) / Σ(layerWeight(L))   over layers that have items
```

Verdict, in order: any essential at 0 → fail; any pitfall triggered →
fail; `total < evaluation.passScore` (default 0.9) → fail; otherwise
pass. Finishing additionally needs `autoStop.requiredStablePasses`
consecutive passes (the later ones from a fresh evaluator) and a green
delivery gate.

## 6. Building the rubric (planner, `write-acceptance-criteria`)

Work in this order; each step has a source.

1. **L1 from the PRD's functional requirements.** At least one item per
   requirement; every requirement has at least one essential.
2. **L2 from the PRD's error and boundary cases** and the tech design's
   error-handling strategy. Name the timing and permission failures.
3. **L3 from the vision's design intent and key-screen descriptions.**
   Every REF-n produces at least one important or essential item.
4. **L4 from the vision's interaction model**, using
   `evaluation-heuristics.md` section 2 as the checklist.
5. **Pitfalls from the vision's red lines and anti-references.** Every
   RL-n maps to at least one pitfall (or an essential judge item that
   cites it).
6. **Cross-check:** every requirement → ≥ 1 L1 item; every design intent
   → ≥ 1 L3/L4 item; every red line → ≥ 1 pitfall.
7. **Quotas:** optional `policy.minEssentialPerLayer` (3 is a good bar for
   production work) and `policy.minPitfallsPerLayer` (1). A layer that
   genuinely does not apply — no UI — is excused with
   `policy.layerNA.L3: "<reason>"`.

### Item wording

| Part | Example |
| --- | --- |
| Observable behavior | "after Save, the new row is visible at the top of the list" |
| Threshold (when it applies) | "≤ 200 ms to visible feedback", "card gap 12–16 px" |
| How it is verified | `command` running a Playwright spec; `judge` with a screenshot |
| Anchor (L3/L4) | `"anchor": "REF-1"` |

Bad: `L3 essential: the page layout is reasonable.` Good: `L3 essential:
list page density matches REF-1 (one record per row, 12–16 px gaps, no
text truncation at 1280 px); judge with screenshot; anchor REF-1.`

## 7. `rubric.json` shape

```json
{
  "version": 1,
  "feature": "notice-list",
  "layerWeights": true,
  "policy": { "minEssentialPerLayer": 1, "minPitfallsPerLayer": 1, "minPitfallsPerRequirement": 0 },
  "requirements": [
    { "id": "REQ-1", "description": "Users see their unread notices, newest first." }
  ],
  "items": [
    { "id": "RB-1", "requirement": "REQ-1", "layer": "L1", "level": "essential", "kind": "command",
      "command": "node --test test/notice-list.test.js", "description": "newest-first ordering holds for mixed dates" },
    { "id": "RB-2", "requirement": "REQ-1", "layer": "L2", "level": "pitfall", "kind": "grep",
      "path": "src/notice-list.js", "pattern": "innerHTML\\s*=\\s*[^'\"`]", "expect": "absent",
      "description": "no unescaped HTML injection of notice text" },
    { "id": "RB-3", "requirement": "REQ-1", "layer": "L3", "level": "important", "kind": "judge",
      "anchor": "REF-1", "evidence": ".harness/tasks/notice-list/evaluation/judge-rb-3.json",
      "description": "list density and hierarchy match REF-1" }
  ],
  "qualityWaivers": [],
  "e2eCategories": { "core": 2, "negative": 2, "boundary": 1, "crossFeature": 1, "persistence": 1, "uiJourney": 1,
                     "na": { "crossFeature": "single isolated widget; no other feature reads its state" } }
}
```

`description` is free text for humans and evaluators; the kernel ignores
it. `e2e-cases.json` is an array of
`{ id, category, mapsTo, blocking, severity, steps, expect }` with
`category` one of core / negative / boundary / crossFeature /
persistence / uiJourney.

## 8. Gates

- **Coverage gate** (`clarify-done`, `replan-done`, `eval`): every
  requirement has an essential item; every requirement has an anchored
  judge item or a reasoned `qualityWaivers` entry; judge anchors exist in
  `vision.md`; `vision.md` has ≥ 1 REF, ≥ 1 ANTI, ≥ 2 RL with a declared
  check; declared E2E quotas are met (core and negative each with a
  blocking case) or excused with a reason; per-layer quotas when set.
- **Strict verdict:** veto beats score, always.
- **Stable finish:** N consecutive passes (default 2), the confirmation
  pass on regenerated evidence, then the delivery gate.
- **Monotone contract:** after `clarify-done`, the rubric may tighten on
  its own (new items, sharper thresholds, higher levels); loosening needs
  a human (`GATE_HUMAN_CONFIRM=yes` at `replan-done`).

## 9. Evolution

After every full evaluation the evaluator files
`rubricRefinementSuggestions` (`refine`, `add-verification`, `add`,
`regrade`); the planner answers each one at the next replan. See
`orchestration.md` section 6.
