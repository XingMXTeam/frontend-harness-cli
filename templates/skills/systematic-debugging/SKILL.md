---
name: systematic-debugging
description: Harness developer. When a task check, test or remediation item fails and the cause is not obvious, find the root cause one hypothesis at a time before changing code, and record it in the task report. For general bugs outside a harness task, bug-root-cause covers the same method.
---

# Systematic Debugging

No guess-and-patch. A fix you cannot explain is a second bug waiting.

## Workflow

1. **Reproduce reliably.** One command that shows the failure every
   time. Flaky? Find what makes it flaky first (timing, order, data).
2. **Collect evidence:** the full error, stack, logs, inputs, and what
   changed since it last worked (`git log -p`, `git diff`).
3. **One hypothesis at a time.** Write it down, design the observation
   that would prove it wrong, run it. Keep a short log:
   `hypothesis → test → result`.
4. **Confirm the root cause** — you can make the failure appear and
   disappear on purpose.
5. **Smallest fix** at the cause, not at the symptom.
6. **Re-verify:** the reproduction, then the task's checks, then the
   wider suite the change could affect.
7. **Record** one line in the task report: `root cause: …`.

## Rules

- Never mix unrelated changes into a debugging commit.
- Never silence the symptom (catch-and-ignore, a skipped test, a
  widened timeout) and call it fixed.
- After three hypotheses fail, step back: re-read the contract and the
  tech design — the bug may be in the plan. Report it to the
  orchestrator rather than rewriting the design yourself.

## Done Criteria

- Root cause stated and demonstrated; fix verified with fresh output;
  the line is in the report.
