# Design notes — what this kernel is and is not

## Decisions

1. **Files are the state, never chat memory.** Every transition is a CLI
   command writing `state.json` (write-then-rename). `harness next` is a pure
   function of state + config, which is what makes long runs resumable and
   testable across processes.
2. **The kernel never calls an LLM.** Planning, implementing and judging are
   host-agent work dispatched via `next` packets. This keeps the kernel
   deterministic, cheap, and portable across hosts whose agent loops improve
   faster than any hand-rolled runtime would.
3. **Deterministic first, judge last.** Rubric kinds `command/file/grep` are
   decided by scripts. `judge` exists only for what scripts cannot decide,
   and is fenced: fixed score set {0, 0.5, 1}, evidence file required,
   missing evidence = 0.
4. **Veto over averages.** Essential=0 or pitfall triggered ⇒ fail,
   regardless of the weighted score. This is the single most important rule
   in the system; it exists because agents reliably produce high averages
   with dead cores.
5. **The denominator is gated.** Coverage (every requirement ≥ 1 essential
   item) is checked before implementation starts and again at eval time.
6. **Information isolation is a protocol property, not a hope.** The
   implementer packet never includes `rubric.json`; the evaluator works from
   requirements + rubric, not implementer reasoning; the confirmation pass
   required for auto-stop must regenerate judge evidence in a fresh context.
   The kernel cannot force a host to comply — it can and does record which
   context produced each artifact, so violations are auditable.
7. **Budgets pause, they don't kill.** Exhaustion moves the feature to
   `paused` with a reason; only a human `harness resume` restarts the cycle
   counter. No silent infinite remediation loops.
8. **Generic kernel, stack packs.** Anything stack-shaped (standards,
   default gate commands) lives in packs chosen at `init`. The kernel code
   contains zero stack-specific rules.

## Not in v0.1 (deliberately)

- Agent spawning / multi-agent scheduling inside the CLI.
- A UI. Reports are Markdown/JSON on purpose.
- Skill self-evaluation (grading changes to the workflow's own skills
  against a golden set) — the natural v0.2, because an ungraded
  self-improvement loop poisons its own rules over time.
- Token accounting. Budgets are cycles/retries today; token budgets need
  host cooperation and belong in the host integration layer.

## Validation standard for calling this "generic"

The claim is only earned when the same kernel, unchanged, completes a real
feature in two unrelated repositories (different stacks), including:
a mid-run kill + resume, and a planted fatal defect that the veto catches.
The bundled tests simulate both; the two-repo run is the release gate for
v1.0, not a launch-day claim.
