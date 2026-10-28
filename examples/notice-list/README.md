# Example: notice-list

A minimal but real feature — a notice list with ready / empty / loading /
error states — taken through the whole harness loop. Every file the
planner, developer and evaluator would produce is here, and
`run.sh` replays the loop against the kernel in a scratch copy.

```bash
bash examples/notice-list/run.sh            # replay; ends in phase "done"
bash examples/notice-list/run.sh --record   # also rewrite trajectory/
node examples/notice-list/scripts/serve.mjs # the feature at http://localhost:5173/?state=ready|empty|error
```

## What is where

| Role | Files |
| --- | --- |
| planner (authoring chain) | `.harness/tasks/notice-list/clarification/summary.md` → `prd.md` → `vision.md` → `tech-design.md` + `pages.json` → `plan.md` + `tasks.json` → `rubric.json` + `e2e-cases.json` |
| developer | `src/`, `test/`, `fixtures.js`, `index.html`, `scripts/serve.mjs` |
| evaluator | `scripts/snapshot.mjs` (renders each state), `replay/cycle1/` and `replay/cycle2/` (judge evidence + narrative reports `eval-1.md`, `eval-2.md`) |
| planner (replan) | `replay/replan-decisions.json` |
| kernel output of one run | `trajectory/` — `state.json`, `evaluation/report-{1,2,3}.json`, `failure-log.md`, `report.md` (timestamps scrubbed) |

## The run

1. **clarify-done** — the coverage gate checks the layered rubric
   (L1–L4 weights, ≥ 1 essential and ≥ 1 pitfall per layer), the vision
   anchors, the E2E category quotas (two categories excused with
   reasons) and that every uiJourney route is in `pages.json`.
2. **task-done × 3** — each task's own checks run inside the command.
3. **Cycle 1** — the developer's first stylesheet keeps titles on one
   line with an ellipsis. The evaluator scores RB-6 (essential, anchored
   on REF-1) **0** and files a refinement suggestion. `harness eval`:
   **FAIL** at score 0.882 with a veto on RB-6 → route **replan**.
4. **Replan** — the planner accepts RS-1 and sharpens RB-6 (names the
   viewports and the measurement); `replan-done` checks every suggestion
   was answered, the rubric actually changed, and nothing was loosened.
5. **Fix** — titles wrap; `remediate-done`.
6. **Cycle 2** — fresh evidence → PASS (route **confirm-evaluation**);
   the confirmation pass regenerates every evidence file (stale evidence
   would score 0) → PASS + delivery gate (`npm test`) → **done**.
   Two new suggestions (RS-2, RS-3) stay recorded for the next planner.

## Honest limits

- The judge evidence cites rendered HTML, not screenshots: the
  environment this trajectory was recorded in had no browser. The red
  lines are therefore command-checked. With Playwright installed,
  `node scripts/serve.mjs` + `harness capture notice-list` produces the
  PNGs that RS-2 asks for.
- The evaluator's evidence is replayed from files so the run is
  deterministic; in a real run a fresh evaluator context writes it.
- Not a git repository, so `requireCommitPerTask` is off in
  `harness.config.json`; in a real project every task and fix records a
  verified SHA.
