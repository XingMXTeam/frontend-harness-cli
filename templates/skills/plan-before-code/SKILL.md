---
name: plan-before-code
description: Turn a feature request into a testable functional-point checklist before writing any code. Use when starting a new feature, page, or non-trivial change.
---

# Plan Before Code

Never start from a vague sentence. Before writing code, negotiate what
"done" looks like and write it down as a checklist of functional points
(FPs) that a third party could verify one by one.

## When to Use

- The user asks for a new feature, page, flow, or screen.
- A request is one line long and hides real decisions ("add a settings
  page", "make checkout faster").
- The change touches more than one file, component, or data source.
- You catch yourself about to write code while the acceptance criteria
  only exist in your head.

Skip it for: one-line fixes, pure renames, and changes where the user has
already supplied a complete, testable spec.

## Workflow

1. **Restate the goal in one sentence.** Write down who does what, and
   what changes for them. Output: one sentence the user can confirm or
   correct.
2. **List the unknowns.** Scan the request for missing decisions: empty
   states, error handling, permissions, data source, edge cases. Output:
   a numbered list of questions or explicit assumptions.
3. **Resolve or assume.** Ask about unknowns that change the design;
   record assumptions for the rest. Output: each unknown is either
   answered or written down as an assumption next to the plan.
4. **Decompose into functional points.** Break the feature into FPs, each
   in the format `input -> action -> validation -> result`. Example:
   "FP-1: user enters a non-empty title -> clicks Add -> title is
   trimmed and checked -> item appears in the list and the input clears."
   Output: a numbered FP list where every item is independently testable.
5. **Name the non-goals.** Write what this change will deliberately NOT
   do. Output: an explicit out-of-scope list (at least one item).
6. **Define "done".** For each FP, state how completion is checked: a
   test, a manual step, a visible result. Output: a done-criterion per
   FP, not a single "it works".
7. **Confirm before building.** Show the plan to the user when any
   assumption is load-bearing, then stop. Output: an approved plan saved
   where the team keeps plans (file, issue, or PR description).

## Anti-patterns

- ❌ Starting to code from "build the homepage" — after six hours the
  user discovers you built the wrong six hours.
- ❌ Inventing missing requirements silently: picking your own error
  code, empty-state copy, or permission rule because the spec didn't
  mention it, instead of asking or logging an assumption.
- ❌ Writing FPs as implementation tasks ("create component X", "add
  hook Y"). Tasks describe your work; FPs must describe observable
  behavior a user or test can check.
- ❌ Treating the plan as ceremony: producing a beautiful plan, then
  coding something else and never comparing the result against it.

## Done Criteria

- A written plan exists with: goal sentence, FP list in
  input -> action -> validation -> result form, assumptions, non-goals,
  and a checkable done-criterion for every FP.
- No code was written before the plan existed.
- Every FP can be answered "pass / fail" by someone who did not write
  the code.
