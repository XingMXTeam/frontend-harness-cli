---
name: fix-from-report
description: Harness developer, remediation. Fix exactly the open items a failed harness evaluation listed — reproduce, root-cause, smallest fix, re-test, precise commit, then harness remediate-done. Use when harness next returns remediate.
---

# Fix from the Report

The evaluation failed and named open items. Fix those — only those —
and prove each fix changed the behavior.

## Inputs

- `harness packet <feature>` — `items` (rubric ids or `gate:<command>`)
  and `findings` (the observed symptom per item).
- The original task(s) in `plan.md`, `tech-design.md`, `vision.md`,
  `.harness/standards.md`.
- Your earlier reports under `developer/`.

You still do not read `rubric.json`; the finding tells you the symptom.

## Workflow

1. **Reproduce** each item: a failing test, a command, or a script that
   shows the symptom. Can't reproduce? Record exactly what you tried and
   report `blocked` for that item — do not "fix" blind.
2. **Root cause** (`systematic-debugging`): one hypothesis at a time.
3. **Smallest fix** that removes the cause. Widen scope only when
   correctness requires it, and say why.
4. **Prove it:** the reproduction now passes; the task's checks and the
   affected tests pass, fresh output in hand.
5. **Commit precisely:** `git add <paths of this fix>`;
   `git commit -m "fix(<item ids>): <cause>"`.
6. **Report:** append to the relevant `developer/<TASK-ID>-report.md` —
   item, root cause (one line), fix, SHA, test result counts.
7. **Record:** `harness remediate-done <feature> --sha <sha>`. Do not run
   `harness eval`; a fresh evaluator judges the fix.

`gate:<command>` items mean the delivery gate failed at that command:
run it, read the first failure, fix that.

## Rules

- No fix without a reproduction; no commit without fresh passing output.
- Never commit unrelated files; never `git add -A`.
- A fix that is not committed is not a fix: `remediate-done` needs the SHA.

## Done Criteria

- Every listed item reproduced, root-caused, fixed and re-tested — or
  reported blocked with what was tried.
- `harness remediate-done` accepted the SHA.
