---
name: write-prd
description: Harness planner, authoring step 1. Write .harness/tasks/<feature>/prd.md from the user-confirmed clarification summary. Use only after clarify-requirements finished with confirmed-by-user yes and zero open questions.
---

# Write the PRD

Turn the confirmed summary into the product contract: the problem, who
has it, what the feature must do, and what it will not do — in words a
tester can check.

## Gate

- `clarification/summary.md` exists with `confirmed-by-user: yes` and
  `open-questions: 0`. Otherwise stop and return to
  `clarify-requirements`.
- Read `.harness/overview/product.md` and `technical.md` and check the
  scope against existing capabilities and boundaries.

## Structure of `prd.md`

1. **Problem** — whose problem, in their terms, and why now.
2. **Users and scenarios** — roles and the situations they are in.
3. **User stories** — "As a … I want … so that …".
4. **Requirements** — numbered `REQ-1`, `REQ-2`, … one testable
   sentence each. These ids become `rubric.json` requirements verbatim.
5. **Non-functional requirements** — measurable (time, size, browsers,
   accessibility level).
6. **What good looks like** — 2–3 sentences per key screen and per core
   interaction describing the target the user agreed to (see below).
7. **Non-goals** — what is explicitly out.
8. **Success measures** — how anyone will know it worked.
9. **Overview deltas** — new capability areas or boundary changes, one
   line each, for `sync-overview` to pick up later (or "none").

## "What good looks like"

Make the quality target concrete enough that a developer and an
evaluator would picture the same screen.

- Bad: "The list page should look clean and modern."
- Good: "The list shows one notice per row, newest first, unread rows
  with a bold title and a dot; 12–16 px between rows; an empty list shows
  one sentence and a 'Refresh' button."

This section is the summary; `vision.md` holds the full anchors. Keep
them consistent.

## Rules

- One feature per PRD. No implementation detail (frameworks, file
  names) — that is the tech design.
- Every requirement must be checkable by someone who did not write it.
- Use the user's terms from `answers.md`; do not rename concepts.
- No TODO / TBD. An open question means you are not in this skill yet.
- Do not write to `.harness/overview/` — list deltas in section 9.

## Done Criteria

- `prd.md` has all nine sections; requirements are numbered `REQ-n`.
- Every requirement traces to the summary; every non-goal is explicit.
- Next skill: `write-quality-vision`.
