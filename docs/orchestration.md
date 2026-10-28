# Orchestration

How a feature moves from a one-line request to `phase: done`, who does
each step, what each step may read and write, and what happens after
every verdict. `harness init` copies this file to `.harness/docs/`.

The kernel (`harness`) owns state, gates and routing. It never calls a
model. Three role agents do the thinking — **planner**, **developer**,
**evaluator** — and one **orchestrator** (the main session, or
`harness run`) moves between them.

## 1. The orchestrator's boundary

The orchestrator:

- runs `harness next <feature>` first, every session, and does exactly
  the action it returns;
- dispatches the role agent that owns the action, giving it
  `harness packet <feature>` and nothing it would not otherwise see;
- runs kernel commands (`clarify-done`, `eval`, `gate`, `report`);
- relays the planner's clarification questions to the user **verbatim**
  and relays the user's answers back **verbatim**.

The orchestrator does not:

- write product code, plans, rubrics or judge evidence itself;
- answer a clarification question on the user's behalf, or describe an
  open question as "resolved", "assumed" or "defaulted" in a prompt —
  only the user's own words close a question;
- stop after a verdict with a summary. Every verdict has a next action
  (section 5). The turn ends only at `done`, `paused`, a clarification
  question waiting on the user, or a tool/environment blocker it reports;
- take over a role when an agent fails. It retries the dispatch, and
  after a second failure reports the blocker.

## 2. Phases and actions

```
clarify ──clarify-done──▶ implement ──eval──▶ verify ──eval──▶ done
   ▲                         │  ▲               │
   │                         │  └──remediate◀───┤ (fail)
   │                         │  └──replan◀──────┘ (fail + suggestions)
   │                         └──▶ paused (budget) ──resume──▶ implement
```

| Phase | `harness next` action | Role | Ends with |
| --- | --- | --- | --- |
| clarify | `clarify` | planner (+ the user) | `harness clarify-done` |
| implement | `implement-task` | developer | `harness task-done <f> <task> --sha <sha>` |
| implement | `replan` | planner | `harness replan-done <f>` |
| implement | `remediate` | developer | `harness remediate-done <f> --sha <sha>` |
| implement | `evaluate` | evaluator, then orchestrator | evidence files, then `harness eval <f>` |
| verify | `confirm-evaluation` | evaluator (fresh context), then orchestrator | regenerated evidence, then `harness eval <f>` |
| paused | `human-decision` | the user | `harness resume <f>` |
| done | `none` | — | `harness report <f>` |

Within `implement`, the order is fixed: answer refinement suggestions
(`replan`) → finish pending tasks → fix open items (`remediate`) →
evaluate. A task loop (implement → check → commit → `task-done`) never
advances the macro-cycle counter; only a failed evaluation does.

## 3. The authoring chain (clarify phase)

The planner writes the feature's contract in this order. Each step reads
only what earlier steps produced, so nothing depends on a file that does
not exist yet.

| Step | Skill | Writes (in `.harness/tasks/<f>/`) |
| --- | --- | --- |
| 1 | `clarify-requirements` | `clarification/questions.md`, `clarification/answers.md`, `clarification/summary.md` (drafts only) |
| 2 | `write-prd` | `prd.md` |
| 3 | `write-quality-vision` | `vision.md` (REF / ANTI / RL anchors) |
| 4 | `write-tech-design` | `tech-design.md`, `pages.json` (routes from the PRD) |
| 5 | `write-dev-plan` | `tasks.json`, `plan.md` (with an "Editable scope" section) |
| 6 | `write-acceptance-criteria` | `rubric.json`, `e2e-cases.json` |
| 7 | — | `harness clarify-done <f>` (coverage gate) |

Rules:

- Steps 2–6 start only after the user has confirmed the summary in
  `clarification/summary.md` and its open-question count is 0. Before
  that, formal files are not written — not as drafts, not "to be fixed
  later".
- `pages.json` is derived from the PRD's screens in step 4; step 6
  checks that every `uiJourney` E2E case visits a route in it. (The
  route list never waits on the test cases.)
- The project overview (`.harness/overview/`) is **read** by steps 1–4
  and **written** only by `sync-overview` (section 8).

## 4. Information isolation

Isolation is a property of the packet the kernel builds, not a request
in a prompt:

| Role | Gets | Never gets |
| --- | --- | --- |
| planner | requirements, rubric, vision, tasks, last report, pending refinement suggestions | — |
| developer | the task or open items (id + observed symptom), plan, vision, standards, tech design | `rubric.json` |
| evaluator | requirements, rubric, vision, e2e cases, pages, judge items and their evidence paths | commit SHAs, task attempts, developer reports, failure log, state history |

Mechanisms behind the table:

- `harness packet <f>` / `harness run` build packets from a whitelist per
  role; the driver refuses to dispatch an evaluator packet that contains
  an implementer record (tripwire, tested).
- Under `harness run`, each step carries `HARNESS_ROLE`. Kernel commands
  that record another role's result refuse to run in the wrong role:
  only the developer may `task-done` / `remediate-done`, only the planner
  may `replan-done`, and no role agent may `eval` — the orchestrator
  scores.
- Judge evidence must be newer than the latest work it judges and than
  the previous evaluation. A confirmation pass therefore cannot reuse the
  first pass's notes: stale evidence scores 0.

## 5. Verdict → next step (fixed)

`harness routes` prints this table; `harness eval` prints the next action
after every run.

| Evaluation result | Phase after | Next action | Who |
| --- | --- | --- | --- |
| pass, stable passes still needed | verify | `confirm-evaluation` | evaluator, fresh context |
| pass, stable passes met, delivery gate green | done | `none` | report to the user |
| pass, delivery gate red | implement | `remediate` (`gate:<cmd>`) | developer |
| fail (veto or below passScore) + refinement suggestions | implement | `replan`, then `remediate` | planner, then developer |
| fail (veto or below passScore), no suggestions | implement | `remediate` | developer |
| fail, macro-cycle budget exhausted | paused | `human-decision` | the user |

There is no "conditional pass" in the kernel: a score between 0.8 and the
pass score is a fail with open items, and a single essential at 0 or a
triggered pitfall is a fail at any score. Evaluators may describe a run
as "close", but routing reads only the verdict.

**Never stop at a summary.** After `harness eval` prints its verdict, the
orchestrator dispatches the next action in the same turn. Asking the user
"shall I continue?" between two rows of this table is a stop, and it is
not allowed. The legitimate stops are `done`, `paused`, a clarification
question, and a blocker the orchestrator cannot clear.

## 6. Rubric evolution

The evaluator is the only actor that sees where the rubric was too vague
to score, missed a defect, or weighted something wrong. It writes
suggestions into any judge evidence file (or
`evaluation/rubric-refinements.json`):

```json
"rubricRefinementSuggestions": [
  { "type": "refine", "item": "RB-7", "problem": "\"readable\" is unscorable", "suggestion": "body text contrast >= 4.5:1 measured on the list page" },
  { "type": "add", "item": "NEW", "layer": "L2", "level": "pitfall", "suggestion": "double-submit on slow network creates two records" }
]
```

Types: `refine` (sharpen wording/threshold), `add-verification` (name how
to prove it), `add` (new item), `regrade` (change level). The kernel:

1. records each suggestion with a stable id (`RS-n`) in
   `state.pendingRefinements` and in the evaluation report;
2. on a failing evaluation, routes to `replan` before any remediation;
3. at `harness replan-done`, requires a decision for every pending id in
   `replan-decisions.json` (`accepted`, or `rejected` with a reason),
   requires the rubric or tasks to actually change when anything was
   accepted, re-runs the coverage gate, and refuses any change that
   **loosens** the locked rubric (removing an essential or pitfall item,
   downgrading a level) unless a human sets `GATE_HUMAN_CONFIRM=yes`.

Suggestions filed on a passing run stay recorded and appear in
`harness report`; they feed the next feature's planner.

## 7. Evidence

- `harness capture <f>` takes real Playwright screenshots of every route
  in `pages.json` into `evidence/<run-id>/` with a `manifest.json`. A
  file that is not a PNG or is under `--min-bytes` (default 2048) fails
  the capture. Placeholder images are written only with
  `--allow-fallback`, and that run's status is `fallback` — never
  evidence.
- `harness visual <f>` pixel-diffs the latest run against
  `.harness/baselines/<page>.png` with pixelmatch. A page without a
  baseline is reported as `no-baseline` (exit 2), not as a match.
  Baselines are adopted explicitly with `--update-baseline`, and only from
  a clean run.
- Judge evidence cites its artifacts (`"artifacts": [...]`). A cited file
  that does not exist scores the item 0. A judge item anchored on a red
  line declared `(check: screenshot)` must cite at least one real PNG.
- Playwright is the one browser tool: the library behind `capture`, the
  test runner for scripted E2E (`@playwright/test`), and optionally a
  Playwright MCP server for exploratory sessions. An API call is never
  evidence for a browser journey.

## 8. Long-lived memory: the overview

Two short files carry what stays true across features:

- `.harness/overview/product.md` — capability areas, users, boundaries;
- `.harness/overview/technical.md` — modules, boundaries, constraints.

The planner reads both before clarifying and designing. Only
`sync-overview` writes them, once per feature when it reaches `done`
(and optionally after a replan that changed a boundary). They hold
summaries only — no task ids, case ids, SHAs, commands or file lists. A
cycle with no stable change records "no overview change" with the date
rather than inventing one.

## 9. Files per feature

```
.harness/tasks/<feature>/
  state.json                 kernel only — never edited by hand
  clarification/             planner drafts (questions, answers, summary)
  prd.md  vision.md  tech-design.md  pages.json
  plan.md  tasks.json        dev plan (human-readable + kernel-readable)
  rubric.json  e2e-cases.json
  developer/<task>-report.md implementer notes (withheld from the evaluator)
  evaluation/                judge-*.json, report.json, eval-<cycle>.md, rubric-refinements.json
  evidence/<run-id>/         screenshots + manifest.json (+ comparison.json)
  replan-decisions.json      planner's answers to RS-n suggestions
  failure-log.md             append-only
```
