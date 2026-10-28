---
name: verification-before-completion
description: Any harness role, before claiming a result. No "done", "passing" or "failing" without fresh command output that proves it, run after the last change. Use right before task-done, remediate-done, writing judge evidence, or reporting to the orchestrator.
---

# Verification Before Completion

A claim without fresh evidence is a guess. Evidence expires the moment
the code changes.

## The gate

Before any claim of success **or** failure:

1. Name the command that proves the claim.
2. Run it in full, now — after your last edit.
3. Read the whole output and the exit code.
4. Check the output actually says what you are about to say.
5. Only then make the claim, quoting the numbers.

## By role

| Role | Claim | Required evidence |
| --- | --- | --- |
| developer | task / fix done | the task's checks + its tests, fresh, with counts; `git rev-parse --short HEAD` |
| evaluator | API behavior verified | the real request and response, captured this run |
| evaluator | a journey works / a page looks right | a real browser run this session: Playwright spec output and `harness capture` screenshots (manifest status `pass`) |
| planner | contract complete | `harness clarify-done` / `replan-done` output |

A failure claim needs the same quality of evidence, quoted in the role's
report. The kernel appends to `failure-log.md` itself when a check or an
evaluation fails; no role writes a success there, or edits it.

## Not evidence

- A run from before your last edit.
- "It should work" / "probably fine" / a reading of the source.
- An API response offered as proof of what the page shows.
- A capture run with status `fallback` or `fail`.
- Another agent's report of a result you did not observe.

## Done Criteria

- Every claim in your handoff is backed by output you produced after the
  last change, quoted with numbers.
