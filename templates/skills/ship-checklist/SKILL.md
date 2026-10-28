---
name: ship-checklist
description: Run the full pre-delivery check — types, lint, tests, build, blast radius, acceptance criteria — before calling work done. Use when finishing any task or PR.
---

# Ship Checklist

"Done" is a claim, and claims need evidence. Code that typechecks on
your machine, in your head, is not done. This skill is the final gate
between "I wrote it" and "it is finished": every item is run, read, or
explicitly marked not run — with the reason.

## When to Use

- Before declaring any task, feature, or fix complete.
- Before opening or merging a pull request.
- After a long session, when the list of what changed has outgrown
  your memory of it.
- When handing work to another person or agent for review.

## Workflow

1. **Types and lint.** Run the project's typecheck and lint commands
   in full (not only on changed files, unless the project defines
   that as the gate). Output: both exit clean, or the failures listed.
2. **Tests that exist, actually run.** Run the test suite or the
   subset the project defines; record real counts (passed / failed /
   skipped). Output: numbers from this run — never from memory or a
   previous run.
3. **Build.** Run the production build the way CI will. Output: build
   result; a dev-server smoke test is not a substitute if CI builds.
4. **Diff review.** Read your own complete diff as a reviewer would.
   Output: stray debug output, commented-out code, unrelated changes,
   and accidental file modifications found and removed.
5. **Blast radius list.** Enumerate what this change can affect:
   shared components touched, public APIs changed, other pages or
   features consuming the modified code. Output: a written list, each
   item either exercised, reasoned safe, or flagged as a risk.
6. **Acceptance criteria, one by one.** Walk the original plan or
   request item by item and mark each met / not met / descoped with
   the requester's agreement. Output: no criterion left at "probably
   done".
7. **Honest summary.** Write the delivery note: what shipped, check
   results with numbers, what was NOT verified and why, known risks.
   Output: a summary a reviewer can trust without re-running anything
   to check your honesty — only to check your work.

## Anti-patterns

- ❌ Reporting "tests pass" from a run that happened before your last
  three edits. Evidence expires the moment code changes.
- ❌ Treating a green typecheck as a green build: bundling, asset
  handling, and environment variables only fail in the real build.
- ❌ Quietly narrowing the definition of done — skipping the slow
  suite "just this once" and writing the summary as if it ran.
- ❌ Burying an unverified item in prose ("should be fine in
  production") instead of listing it under "not verified", where a
  reviewer can weigh it.

## Done Criteria

- Typecheck, lint, tests, and build were all run after the final
  edit, with results (including counts) recorded.
- The full diff was self-reviewed; no debris or unrelated changes
  remain.
- Blast radius is written down with a disposition per item.
- Every acceptance criterion is marked met, not met, or descoped —
  and anything not verified is named explicitly in the summary.
