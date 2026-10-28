---
name: bug-root-cause
description: Fix bugs at the root cause: reproduce, narrow, build an evidence chain, then change the cause — never patch the symptom. Use for any non-trivial bug fix.
---

# Bug Root Cause

The fastest fix is usually a patch over the symptom: a null check
where the value shouldn't be null, a retry where the call shouldn't
fail, a special case where the rule is wrong. The bug then returns in a
different costume. This skill enforces the slower start that makes the
fix final.

## When to Use

- Any bug whose cause is not already proven.
- A bug that "came back" after a previous fix.
- Intermittent failures, race conditions, and "works on my machine"
  reports.
- A fix you're about to make in code you don't fully understand yet.

## Workflow

1. **Reproduce it.** Get a deterministic or near-deterministic
   reproduction: exact steps, input, environment, and observed vs.
   expected behavior. Output: a reproduction someone else can run. If
   you cannot reproduce it, gathering the reproduction is the task —
   do not start fixing.
2. **Narrow the scope.** Bisect inputs, code paths, and history
   (disable halves, git bisect, strip the failing case down) until the
   smallest failing case remains. Output: a minimal failing example.
3. **Build the evidence chain.** State hypotheses and test each one
   with an observation (log, debugger, failing test), keeping the
   hypothesis that survives contact with evidence. Output: the chain
   from symptom to cause, each link observed — not "probably".
4. **Name the root cause in one sentence.** It must explain every
   observed symptom, including the intermittent ones. Output: a
   sentence of the form "X happens because Y, under condition Z."
5. **Fix the cause, at the cause.** Make the smallest change at the
   point where the wrong value, state, or assumption originates.
   Output: a diff that would look wrong if placed anywhere else.
6. **Check the blast radius.** Search for other callers, siblings, and
   copies of the same pattern; state whether they share the defect.
   Output: an impact list — fixed here, also affected, not affected
   (with how you checked).
7. **Lock it with a test where feasible.** Add or identify the test
   that fails without the fix and passes with it. Output: the test
   name, or an explicit note on why it can't be automated.
8. **Write it up.** Record root cause, evidence, fix, and blast
   radius in the commit message or issue. Output: a future reader can
   audit the reasoning without redoing the investigation.

## Anti-patterns

- ❌ Guarding the crash site: adding `?.` or a null check where the
  value arrived already broken, so the real corruption continues
  silently upstream.
- ❌ Fixing by folklore: changing timeouts, adding retries, or bumping
  a version because "that fixed a similar thing once", with no
  evidence it addresses this cause.
- ❌ Stopping at the first plausible explanation and coding the fix
  before any observation distinguishes it from the second plausible
  explanation.
- ❌ Fixing only the reported instance when the same defect pattern
  exists in three sibling components — and not even checking.

## Done Criteria

- A reproduction existed before the fix, and no longer fails after it.
- The root cause is written in one sentence that explains all
  symptoms, backed by cited observations.
- The change is at the origin of the defect, not at the crash site.
- Blast radius was checked and reported; a regression test was added
  or its absence explained.
