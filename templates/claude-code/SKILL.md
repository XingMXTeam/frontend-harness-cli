---
name: harness
description: Run the harness-cli long-running workflow for a feature. Use when the user asks to start, continue, resume or check a harness feature, or says "/harness <feature>".
---

# harness

This project uses **harness-cli**. The CLI (`harness`) is the orchestrator and
the only source of truth for workflow state. You are a host agent: you do the
planning / coding / judging work it dispatches, you never invent state.

## Hard rules

1. Your first action for any feature work is `harness next <feature>`.
   Do exactly the action it returns — no skipping ahead, no writing code
   during `clarify`, no running the full evaluation during a task loop.
2. State lives in `.harness/tasks/<feature>/state.json`. Never edit it by
   hand. Every transition goes through a `harness` command.
3. Information isolation: the implementer works from the plan and the task,
   NOT from `rubric.json`. The evaluator works from `rubric.json` and the
   requirements, NOT from the implementer's reasoning. If you are asked to
   evaluate work you implemented in this same context, say so — that run is
   a debug run, not a formal score.
4. A task is done only when `harness task-done` accepts it: its checks pass
   and (in a git repo) it records a real commit SHA that
   `git rev-parse --verify` can resolve. Precise `git add <paths>` only —
   never `git add -A`.
5. Never declare completion yourself. Only `state.phase === "done"` counts,
   and only the CLI sets it (evaluation pass + delivery gate pass +
   stable-pass requirement).
6. If `harness next` says `paused`, stop and surface the reason to the user.
   Do not raise budgets on your own.

## The loop

```
harness next <feature>          # what should happen now
  clarify   -> ask the user, then write rubric.json + tasks, harness clarify-done
  implement -> one task at a time: implement, check, commit, harness task-done
  remediate -> fix only the listed open items, commit, harness eval
  evaluate  -> harness eval (deterministic items run as commands;
               judge items need fresh evidence JSON written by an evaluator)
  verify    -> get a fresh independent evaluation, harness eval again
  done      -> report from `harness report <feature>`
```
