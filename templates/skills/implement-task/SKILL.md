---
name: implement-task
description: Harness developer. Implement exactly one task from a harness feature's plan — test first, minimal code, one precise commit, a short report, then harness task-done with the real SHA. Use when harness next returns implement-task.
---

# Implement a Task

One task, start to finish: failing test, code, passing test, commit,
record. The kernel accepts the task only with passing checks and a
commit SHA that exists.

## Read first (do not skip)

1. `harness packet <feature>` — the task id, title, requirements.
2. The task in `plan.md` / `tasks.json`: files, contract, checks.
3. `tech-design.md` — stack and boundaries. Anything not named there
   (framework, store, runtime, package) is off limits: stop and report
   `blocked` instead of adding it.
4. `.harness/standards.md`.
5. `vision.md` — the target state of the screens this task touches and
   every red line (RL-n). Code against the red lines on purpose.

You do not read `rubric.json`: you build to the plan and the vision, not
to the test.

## Workflow

1. **Failing test.** Write the test the task's contract implies. Run it;
   watch it fail for the right reason. Output: the failing output.
2. **Minimal code.** Make that test pass and nothing more.
3. **Green.** Run the test and the task's `checks`. All pass, fresh
   output in hand.
4. **Refactor** without changing behavior; re-run.
5. **States.** If the task renders data: loading, empty, error and
   no-permission states exist and are tested.
6. **Commit precisely.**
   ```bash
   git status --short
   git add <exact paths of this task>
   git commit -m "feat(<TASK-ID>): <title>"
   git rev-parse --short HEAD
   ```
   Never `git add -A` / `git add .`; never commit unrelated files.
7. **Report.** Write `.harness/tasks/<feature>/developer/<TASK-ID>-report.md`:
   what changed (files), the commit SHA, the test command and its result
   counts, decisions made within the contract, anything you could not
   do. (The evaluator never sees this file; it is for the next developer
   and for remediation.)
8. **Record.** `harness task-done <feature> <TASK-ID> --sha <sha>`. If it
   rejects (a check failed, a SHA does not verify), fix the cause and
   repeat from the failing step — do not fake the SHA.

If a test or check fails and the cause is not obvious, switch to
`systematic-debugging`. Before saying "done", run
`verification-before-completion`.

## Anti-patterns

- ❌ Writing the code first and a test that merely restates it.
- ❌ "While I'm here" changes to other tasks' files.
- ❌ Claiming completion from a test run that predates your last edit.
- ❌ A new dependency because it was convenient.

## Done Criteria

- `harness task-done` accepted the task with a real SHA.
- The report exists with the SHA and fresh test counts.
