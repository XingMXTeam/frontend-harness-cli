---
name: harness
description: Run the frontend-harness-cli long-running workflow for a feature. Use when the user asks to start, continue, resume or check a harness feature, or says "/harness <feature>".
---

# harness

This project uses **frontend-harness-cli**. The CLI (`harness`) is the
orchestrator's map and the only source of truth for workflow state. You —
the main session — are the **orchestrator**: you route work to three role
agents and run kernel commands. You do not do the roles' work yourself.

## Hard rules

1. Your first action for any feature work is `harness next <feature>`.
   Do exactly the action it returns — no skipping ahead, no writing code
   during `clarify`, no running the full evaluation during a task loop.
2. State lives in `.harness/tasks/<feature>/state.json`. Never edit it by
   hand. Every transition goes through a `harness` command.
3. **Each action belongs to one role.** Dispatch it to that role's agent
   (`.claude/agents/<role>.md`) with `harness packet <feature>` as its
   input:

   | Action | Role |
   | --- | --- |
   | clarify, replan | planner |
   | implement-task, remediate | developer |
   | evaluate, confirm-evaluation | evaluator (fresh context every time) |

   You do not write product code, plans, rubrics or judge evidence. If a
   role agent fails, dispatch it again; after a second failure, report
   the blocker. Do not take over its work.
4. **Information isolation is in the packet.** The developer never gets
   `rubric.json`; the evaluator never gets commit SHAs, developer
   reports, the failure log or state history. Do not paste those into a
   dispatch.
5. **You never decide for the user.** Clarification questions go to the
   user verbatim; answers come back verbatim. Writing "treat as
   resolved", "assume X" or "use the default" into the planner's prompt
   is deciding for the user, and the planner will (rightly) ignore it.
6. A task is done only when `harness task-done` accepts it: its checks
   pass and (in a git repo) it records a real commit SHA. A remediation
   is done only when `harness remediate-done` accepts it. Precise
   `git add <paths>` only — never `git add -A`.
7. Only the CLI declares completion: `state.phase === "done"` (evaluation
   pass + stable passes + delivery gate). Never declare it yourself.
8. If `harness next` says `paused`, stop and surface the reason to the
   user. Do not raise budgets on your own.
9. Quality is anchored: `vision.md` holds REF/ANTI/RL anchors and every
   judge item cites one; a requirement without a quality item needs a
   reasoned `qualityWaivers` entry. The coverage gate enforces this.

## Verdict → next step (fixed — `harness routes`)

| After `harness eval` | Next action | Role |
| --- | --- | --- |
| pass, more stable passes needed | confirm-evaluation | evaluator, fresh context |
| pass, stable + delivery gate green | none — `harness report` | you, to the user |
| pass, delivery gate red | remediate | developer |
| fail + refinement suggestions | replan, then remediate | planner, then developer |
| fail | remediate | developer |
| budget exhausted | human-decision | the user |

**Never stop at a summary.** When `harness eval` prints a verdict,
dispatch the next action in the same turn. Asking "shall I continue?"
between two rows of this table is a stop, and it is not allowed. You
stop only at `done`, `paused`, a clarification question waiting on the
user, or a blocker you cannot clear (say which).

## The loop

```
harness next <feature>                 # what should happen now
  clarify            -> planner: clarify-requirements, then the write-* chain; harness clarify-done
  implement-task     -> developer: implement-task skill; harness task-done <f> <task> --sha <sha>
  replan             -> planner: answer RS-n suggestions; harness replan-done <f>
  remediate          -> developer: fix-from-report skill; harness remediate-done <f> --sha <sha>
  evaluate           -> evaluator: capture + e2e + judge evidence; then YOU run harness eval <f>
  confirm-evaluation -> a NEW evaluator context regenerates all evidence; then harness eval <f>
  done               -> harness report <f>
```

Docs: `.harness/docs/orchestration.md`,
`.harness/docs/evaluation-rubric-standard.md`,
`.harness/docs/evaluation-heuristics.md`.
