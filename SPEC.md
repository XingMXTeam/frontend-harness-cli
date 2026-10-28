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
9. **One verdict; sensors and skills are not verdicts (v0.2 unification).**
   The former `ai-code-gate` engine is vendored into `src/gate/` as a pure
   sensor: inside the loop its dimension scores are inputs to rubric items
   of kind `scan`, never a parallel pass/fail. (Two scoring systems with
   two thresholds each is exactly the lint-vs-gate double standard this
   project exists to remove.) Standalone `harness scan` keeps the sensor's
   own report + exit code for CI, clearly labelled as sensor output.
   The former `harness-skills` pack is vendored as *data* under
   `templates/skills/` and distributed by `init` / `harness skills` —
   skills shape behavior, they contain no kernel logic, and they can be
   revised without touching the state machine. Equivalence is enforced,
   not asserted: tests pin the vendored engine's scores to the original
   CLI's output on both fixtures, and pin the installer's semantics
   (install-all / skip-existing / --only / unknown-name error).

10. **Frontend-first positioning (renamed from harness-cli, v0.2).**
    The product is named and sold as a *frontend* harness. The kernel
    staying stack-agnostic is an implementation property; the claim is
    frontend, because every piece of hard evidence behind the product —
    the sensor's ui dimension, the design-token and i18n skills, the
    stack packs (node / nextjs / vue; the token python pack was removed),
    and the author's production history — is frontend evidence. A stack
    joins the supported list when a pack plus a real run earns it.

11. **Quality is anchored, governance is wired (v0.3).** Every feature
    carries a `vision.md` of REF/ANTI/RL anchors; judge items must cite
    an anchor, and a requirement without a quality item needs a reasoned
    waiver — enforced by the same coverage gate, not by reviewer memory.
    The gate engine's protected zone and plan-scope guard are first-class
    commands (`verify-zone`, `scope`), and `scan --history` keeps an
    append-only record with trends. E2E honesty is denominator-first:
    declared category quotas are checked at clarify-done. Skill changes
    are graded by `skills eval` (golden set + fresh-session evidence +
    deterministic scoring) — the workflow's own rules are no longer the
    one unmeasured part of the system. Visual regression stays an
    external-tool route via gate commands: the kernel never fakes a
    check it cannot run.

12. **A driver, not a runtime (v0.4).** `harness run` closes the loop
    without violating decision 2: the kernel still never calls an LLM.
    The driver is a separate, deliberately stupid layer — it reads the
    next action from state, runs kernel steps itself, dispatches agent
    steps to a host agent CLI (`claude -p`, `codex exec`, or any
    `--agent-cmd`), and stops on explicit conditions only (done /
    paused / needs-human / budgets / agent-failing / stalled). It holds
    no state, so killing and restarting the driver is a non-event.
    Clarification remains a human stop in driver mode too: automating
    the user's answers would corrupt every anchor downstream.

13. **Roles are kernel-scoped, not prompt-scoped (v0.5).** Decision 6
    said isolation was a protocol property the kernel could only audit.
    v0.5 moves as much of it as possible into mechanism without the
    kernel calling a model: (a) the kernel builds every agent packet from
    a per-role whitelist, and the driver refuses to send an evaluator
    packet that contains an implementer record; (b) agent steps carry
    `HARNESS_ROLE` and kernel commands refuse the wrong role, so the
    evaluator cannot record work and no role can score itself; (c) judge
    evidence older than the work it judges, or than the previous
    evaluation, scores 0 — a confirmation pass that reuses notes fails
    by construction; (d) remediation ends in `remediate-done`, and a
    fresh evaluator — not the developer — produces the next evidence.
    What remains a protocol property (an agent with a shell can still
    open a file) is named as such in the README.

14. **The contract may tighten itself, never loosen itself (v0.5).**
    Evaluators file rubric refinement suggestions; the kernel records
    them and routes a failed evaluation to `replan` before remediation.
    `replan-done` requires a decision per suggestion, a real change for
    every acceptance, a passing coverage gate, and a human for any
    change that removes an essential/pitfall item or lowers a level.
    The rubric gets sharper with use; it cannot be quietly negotiated
    down by the agents it constrains.

15. **Evidence is captured, validated, and never faked (v0.5).**
    `capture` and `visual` move visual evidence into the kernel's
    vocabulary while keeping decision 2: Playwright, pixelmatch and
    pngjs are optional peers of the project under test, loaded only by
    the commands that need them. A blank or non-PNG capture fails;
    placeholders exist only behind `--allow-fallback` and mark the run
    as not-evidence; a missing baseline is `no-baseline`, not a match;
    baselines are adopted explicitly. Screenshot-checked red lines must
    be judged from a real PNG.

## Not in v0.5 (deliberately)

- Multi-agent scheduling / parallel task execution. The loop is
  sequential by design; parallelism multiplies every failure mode the
  kernel exists to contain.
- A UI. Reports are Markdown/JSON on purpose.
- Token accounting. Budgets are cycles/retries/steps/minutes today;
  token budgets need host cooperation and belong in the host
  integration layer.
- Deleting the old repos. `ai-code-gate` and `harness-skills` stay up
  until the unified CLI has public mileage; then they get a pointer README
  and an archive, not a silent disappearance.

## Validation standard for the frontend claim

The claim is only earned when the same kernel, unchanged, completes a real
feature in two unrelated **frontend** repositories (different stacks —
e.g. one Next.js app and one Vue app), including:
a mid-run kill + resume, and a planted fatal defect that the veto catches.
The bundled tests simulate both; the two-repo run is the release gate for
v1.0, not a launch-day claim.

## Changelog

- v0.6.0 — the scan data dimension gains a reference artifact: with
  `inputs.dataSpec` pointing at a contract JSON
  (`{ interfaces: [{ name, fields }] }`), TypeScript interface/type
  declarations in the code are diffed against the spec field by field —
  a spec field missing in code deducts 8, a recognized type mismatch 6,
  a code field the spec does not declare 6. No spec input means the
  dimension behaves exactly as before (the ai-code-gate equivalence
  fixtures pin this); an unloadable spec, or a codebase with no type
  declarations at all, reports neutral instead of silently passing.
  This is deliberately the first dimension to move from reference-free
  hygiene checks to contract comparison; structure and e2e still do
  not execute builds or test suites inside `scan`.
- v0.5.0 — the agent layer.
  - Roles: `templates/claude-code/agents/{planner,developer,evaluator}.md`
    installed to `.claude/agents/` (claude-code) or `.harness/agents/`
    (codex/generic, instruction-level, with `.harness/protocol.md`).
    `src/roles.js` maps actions to roles and builds whitelisted packets;
    `harness run` prepends the role definition, sets `HARNESS_ROLE`,
    dispatches an evaluator before every eval of a rubric with judge
    items, and trips on evaluator packets that would leak implementer
    records. New `harness packet <feature>`.
  - Kernel: `remediate-done` (remediation ends in a recorded fix; the
    evaluator judges it), `replan-done` + the `replan` action (refinement
    suggestions answered before remediation; tighten-only rubric with a
    human override), `routes` (fixed verdict table). `eval` now refuses
    with pending tasks, prints the next action, and records
    `rubricRefinementSuggestions`. Judge evidence: freshness rule,
    `artifacts` must exist, screenshot-checked red lines need a real PNG.
    Layered rubrics (`layerWeights`, L1–L4 0.40/0.25/0.20/0.15, level
    weights 1/0.7/0.3) and per-layer quotas. uiJourney E2E routes must
    be in `pages.json`. `clarify-done` locks a rubric baseline.
  - Evidence: `harness capture` (Playwright, PNG + size validation,
    `--allow-fallback` recorded as non-evidence, `manifest.json`,
    `latest.json`) and `harness visual` (pixelmatch ratio vs threshold,
    `no-baseline` exit 2, explicit `--update-baseline`). Playwright,
    pixelmatch, pngjs declared as optional peer dependencies.
  - Skills: 13 new (authoring chain clarify-requirements → write-prd →
    write-quality-vision → write-tech-design → write-dev-plan →
    write-acceptance-criteria; implement-task, fix-from-report,
    systematic-debugging, verification-before-completion; e2e-testing,
    api-testing; sync-overview), each with a Chinese reading edition;
    golden set extended to 36 cases covering every bundled skill.
  - Docs: `docs/orchestration.md`, `docs/evaluation-rubric-standard.md`,
    `docs/evaluation-heuristics.md`, installed to `.harness/docs/`.
  - Protocol + session-start hook: orchestrator boundary, verdict →
    next-step map, never stop at a summary, never decide for the user.
  - Standards: node / nextjs / vue rewritten to working size; new
    `react` stack pack.
  - Example: `examples/notice-list` — a real feature replayed through
    fail (veto) → replan → fix → pass → confirm → done, with the recorded
    trajectory (`npm run example`).
  - Behavior changes: the confirmation pass needs regenerated judge
    evidence; `remediate`'s instruction now ends in `remediate-done`
    instead of `eval`; `eval` refuses while any task is pending.

- v0.4.1 — docs: every bundled skill and the harness protocol skill ship a
  Chinese reading edition (`SKILL.zh-CN.md` beside the operative English
  `SKILL.md`; hosts keep loading the English file). Tests pin their presence.
- Earlier releases (v0.1–v0.4.0) are recorded in the git history and in the
  decisions above.
