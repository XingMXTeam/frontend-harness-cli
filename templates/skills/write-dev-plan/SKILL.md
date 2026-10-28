---
name: write-dev-plan
description: Harness planner, authoring step 4. Split the tech design into small, ordered, independently verifiable tasks — tasks.json for the kernel and plan.md for humans and the scope guard. Use after write-tech-design.
---

# Write the Dev Plan

Break the design into tasks a developer can finish, test and commit one
at a time, in dependency order. A task the developer has to interpret is
a task the evaluator will fail.

## Gate

- `prd.md`, `vision.md`, `tech-design.md` exist; summary confirmed.

## `tasks.json` (read by the kernel)

```json
[
  {
    "id": "TASK-1",
    "title": "Notice list model: sort newest first, unread count",
    "requirements": ["REQ-1"],
    "checks": ["node --test test/notice-model.test.js"]
  }
]
```

- `id` unique and stable — later replans append, never renumber.
- `requirements` lists the `REQ-n` ids this task advances.
- `checks` are shell commands that must exit 0 for `harness task-done`
  to accept the task. Use the task's own tests, not the whole suite,
  unless the task is the integration step.

## `plan.md` (read by people and by `harness scope`)

For every task:

```markdown
### TASK-1: Notice list model

**Goal** — what this task delivers, one sentence.

**Files**
- Create: `src/notices/model.ts`
- Modify: `src/notices/index.ts`
- Tests: `src/notices/model.test.ts`

**Contract**
- `sortNotices(list: Notice[]): Notice[]` — newest `createdAt` first; stable for ties.
- `unreadCount(list: Notice[]): number`

**Verify**
- Unit: `npx vitest run src/notices/model.test.ts` — expect 6 passing
- API / integration: N/A — pure module
```

End the file with the scope section the plan-scope guard reads:

```markdown
## Editable scope
- `src/notices/**`
- `test/notices/**`
```

## Rules

- Each task is small (one commit, roughly ≤ 300 changed lines) and
  verifiable on its own.
- Exact paths, exact signatures, exact commands with expected results.
  No TODO, TBD, "as needed", "etc.".
- Order by dependency: data and contracts first, UI after, integration
  last. A task never depends on a later one.
- Loading, empty, error and no-permission states are tasks (or parts of
  one), not afterthoughts.
- Task details stay in the plan — never in `.harness/overview/`.

## Done Criteria

- Every `REQ-n` in the PRD appears in at least one task.
- Every task has files, contract, checks; `tasks.json` and `plan.md`
  agree on ids and titles.
- Next skill: `write-acceptance-criteria`.
