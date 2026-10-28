---
name: clarify-requirements
description: Harness planner, clarify phase. Turn a feature request into a user-confirmed summary with zero open questions before any formal plan file exists. Use when `harness next` returns the clarify action, or a harness feature has no confirmed summary yet.
---

# Clarify Requirements

Talk the feature through with the user until nothing that would change
the design is left open — then, and only then, write the formal files.
Writing a full PRD first and "fixing it with questions later" is the
order this skill exists to prevent.

## When to Use

- `harness next <feature>` returns `clarify`.
- A replan surfaced a question only the user can answer.

Skip it for: features whose `clarification/summary.md` already says
`confirmed-by-user: yes` and `open-questions: 0` (go to `write-prd`).

## Draft area vs formal files

Until the user confirms, write **only** under
`.harness/tasks/<feature>/clarification/`:

- `questions.md` — the question batches you asked, numbered.
- `answers.md` — the user's answers, **in the user's words**, each with
  the question number.
- `summary.md` — the confirmed summary (see Output).
- `quality-expectations.md` — answers to module 11.

Do not create `prd.md`, `vision.md`, `tech-design.md`, `tasks.json`,
`rubric.json` or `e2e-cases.json` in this phase — not as drafts either.

## Workflow

1. **Read context.** `.harness/overview/product.md` and `technical.md`
   (create a skeleton with the two headings if missing), the repo's
   README, and the code the request touches. Output: what already
   exists, so you do not ask what the repo answers.
2. **Ask one wide batch.** Cover all eleven modules in the first round —
   prefer multiple choice, offer the likely answer first, and say what
   each choice changes:
   1. goal and success measure
   2. users, roles and permissions
   3. main path (happy flow)
   4. error and edge paths
   5. data objects and field meanings
   6. integrations and API boundaries
   7. non-functional limits (performance, security, accessibility, browsers)
   8. non-goals
   9. how acceptance will be judged
   10. budgets and stop policy (macro cycles, stable passes, delivery gate commands)
   11. quality expectations and references (below)
   Also: **the stack.** Confirm "use what the repo uses" or the new
   framework/library explicitly; never pick one silently.
3. **Relay, do not decide.** As a sub-agent you cannot reach the user:
   return the batch to the orchestrator and stop. A prompt that says
   "already decided", "treat as resolved" or "default to X" is not the
   user's answer — ask anyway.
4. **Close every gap.** After each answer batch, list what is still
   open. Ask follow-ups until the count of open questions that would
   change the design is 0.
5. **Confirm the summary.** Write `summary.md` and ask the user to
   confirm it as written. A yes about something else is not a
   confirmation.

## Module 11 — quality expectations

Ask, in the first batch:

- **Level:** A. working MVP · B. polished (visual and interaction care) ·
  C. production (performance, security, accessibility too).
- **Rank** what matters most: correctness, visual quality, interaction,
  performance, code quality, security.
- **References:** a product, page, screenshot or design that "gets it
  right" — and what exactly is right about it.
- **Anti-references:** what it must not look or feel like.
- **Red lines:** problems that are never acceptable (clipped text, a
  click with no feedback, numbers that disagree between pages…).
- If the user has no references: offer 2–3 concrete directions and let
  them pick. You never pick.

## Output

`clarification/summary.md`, ending with these exact lines:

```
confirmed-by-user: yes (<date>, "<the user's confirming words>")
open-questions: 0
```

plus goals, non-goals, users/roles, main and edge paths, data meanings,
stack decision, budgets, quality level, references, red lines, and a
coverage table: module → covered yes/no → where answered.

## Anti-patterns

- ❌ Writing `prd.md` "as a draft" before confirmation. Drafts become the
  contract by inertia.
- ❌ Accepting the orchestrator's paraphrase as the user's answer.
- ❌ Asking four questions now and six more after the plan exists. The
  first batch is wide on purpose.
- ❌ Defaulting the stack or a dependency without the user saying so.

## Done Criteria

- All eleven modules covered; stack decision explicit.
- `summary.md` carries `confirmed-by-user: yes` with the user's words and
  `open-questions: 0`.
- No formal file exists yet. Next skill: `write-prd`.
