---
name: write-acceptance-criteria
description: Harness planner, authoring step 5 (last). Write rubric.json (L1–L4 layered items with essential/important/optional/pitfall levels, anchored judge items) and e2e-cases.json (six categories) so harness clarify-done passes. Use after write-dev-plan.
---

# Write the Acceptance Criteria

Turn the PRD and the vision into the two files the evaluation runs on:
`rubric.json` (what is scored, and how) and `e2e-cases.json` (which user
journeys must work). The standard is
`.harness/docs/evaluation-rubric-standard.md`; the checklist for L3/L4
is `.harness/docs/evaluation-heuristics.md`.

## Gate

- `prd.md`, `vision.md`, `tech-design.md`, `tasks.json` exist; summary
  confirmed.

## Build `rubric.json` in this order

1. **Requirements:** copy `REQ-n` ids and sentences from the PRD into
   `requirements`.
2. **L1 (correctness):** at least one item per requirement, at least one
   of them `essential`. Prefer `command` items that run a real test.
3. **L2 (robustness):** from the PRD's error/edge paths and the tech
   design's error handling. Name timing and permission failures.
4. **L3 (UI):** from the vision's design intent and key screens. Every
   REF-n yields at least one important/essential `judge` item with
   `"anchor": "REF-n"`.
5. **L4 (interaction):** from the vision's interaction model, using the
   heuristics' section 2 as the checklist.
6. **Pitfalls:** every RL-n becomes at least one `pitfall` item (a check
   that passes when the defect is absent), or an essential `judge` item
   anchored on it. Every ANTI-n is worth a pitfall too.
7. **Cross-check** the three coverage lines below, then set quotas in
   `policy` if the user asked for production level.

Coverage lines: every REQ → an L1 essential; every design intent → an
L3/L4 item; every RL → a pitfall or anchored essential judge.

### Item kinds

| Kind | Use for | Required fields |
| --- | --- | --- |
| `command` | tests, Playwright specs, scripts | `command` (exit 0 = met) |
| `file` | a deliverable exists, is not a stub | `path`, `minBytes` |
| `grep` | a pattern must / must not be present | `path`, `pattern`, `expect: present|absent` |
| `scan` | a sensor dimension threshold | `dimension`, `minScore`, optional `path` |
| `judge` | what only an evaluator can see | `anchor` (REF/ANTI/RL-n), `evidence` path |

Every item: `id`, `requirement`, `layer` (L1–L4), `level`, `kind`, and a
`description` stating the observable behavior and threshold. Evidence
paths go under `.harness/tasks/<feature>/evaluation/judge-<id>.json`.

### Top-level fields

```json
{
  "version": 1,
  "feature": "<feature>",
  "layerWeights": true,
  "policy": { "minEssentialPerLayer": 1, "minPitfallsPerLayer": 1 },
  "requirements": [ … ],
  "items": [ … ],
  "qualityWaivers": [ { "requirement": "REQ-3", "reason": "<why there is no quality surface>" } ],
  "e2eCategories": { "core": 2, "negative": 2, "boundary": 1, "crossFeature": 1, "persistence": 1, "uiJourney": 1, "na": { } }
}
```

A requirement with no judge item needs a `qualityWaivers` entry with a
reason. A layer that does not apply needs `policy.layerNA.<L>` with a
reason.

## Build `e2e-cases.json`

An array of cases:

```json
{ "id": "E2E-1", "category": "core", "mapsTo": "REQ-1", "blocking": true, "severity": "critical",
  "route": "/notices", "steps": ["open /notices", "…"], "expect": ["newest notice is first", "…"] }
```

| Category | Minimum | What it proves |
| --- | --- | --- |
| core | 2 | the main journey works end to end |
| negative | 2 | bad input, empty data, no permission, network failure |
| boundary | 1 | large data, extreme input, pagination edges, concurrency |
| crossFeature | 1 | an action here is visible where it should be elsewhere |
| persistence | 1 | data survives reload / reopen |
| uiJourney | 1 | loading, empty, feedback, responsive behavior |

- `core` and `negative` each need at least one `blocking: true` case.
- A category that does not apply goes in `e2eCategories.na` with a
  reason — never a silently lower minimum.
- Every `uiJourney` case's `route` must be in `pages.json`; if one is
  missing, add the page there (it is the planner's file).

## Then

Run `harness clarify-done <feature>`. Fix every gap it lists by adding
or sharpening items — never by deleting the requirement or lowering a
level to make the gate pass.

## On replan

Apply each accepted refinement suggestion here (sharper description or
threshold, new verification, new item, new level), add E2E cases for the
evaluator's exploratory findings, and record decisions in
`replan-decisions.json`.

## Done Criteria

- `harness clarify-done` passes.
- Every judge item's anchor exists; every RL is covered; E2E quotas met
  or excused with reasons.
