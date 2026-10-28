# frontend-harness-cli

A host-agnostic **Harness kernel for long-running frontend AI coding**.

Why frontend? Because that is where the evidence is. The sensor's five
dimensions (structure / data / logic / **ui** / e2e), the frontend
skills (`component-from-design`, `i18n-extract`, `e2e-testing`), the
stack packs (**node / nextjs / vue / react**) and a decade of the author's production frontend
work all point the same way. The kernel itself stays stack-agnostic —
standards and defaults live in packs — but the product refuses to claim
territory it has not measured. Frontend first; generality is earned per
stack pack, not asserted.

Other tools sell you a workflow. This one sells you **proof**: a feature is
only "done" when a per-requirement rubric passes, no essential check failed,
no pitfall fired, the delivery gate is green, and the loop earned it across
the configured number of stable passes — with every transition recorded in
files you can audit, kill, and resume.

## Why

Long-running agents fail in predictable ways:

- They declare victory early — half the "features" are placeholders.
- They grade their own homework — the implementer writes the tests.
- Averages hide fatal flaws — one dead core function, ninety-nine green checks.
- State lives in chat memory — kill the process and the run is gone.
- Retries burn money — no budget, no pause, no human checkpoint.

`harness` is the deterministic kernel that removes those failure modes. It
never calls an LLM. Three role agents — **planner**, **developer**,
**evaluator** — do the planning, coding and judging inside any host
(Claude Code, Codex, …); the CLI owns state, coverage, evaluation, gates,
budgets, and what each role is allowed to see.

## The loop

```
clarify ──(user confirms; rubric coverage gate)──▶ implement            [planner]
   │  clarify-requirements → write-prd → write-quality-vision
   │  → write-tech-design → write-dev-plan → write-acceptance-criteria
   ▼                                                  │  one task at a time:   [developer]
 implement ◀──────────────────────────────────────────┤  test → code → check →
   │                                                  │  precise commit → task-done
   ▼                                                  │
 evaluation (evidence → rubric + veto)  [evaluator, fresh context; the kernel scores]
   │ fail + refinement suggestions ──▶ replan [planner] ──▶ remediate [developer]
   │ fail ──────────────────────────────────────────────▶ remediate [developer]
   │ pass ×N stable (fresh evidence each time)
   ▼
 delivery gate ──▶ done          budget exhausted at any point ──▶ paused (human decides)
```

## Quick start

```bash
node bin/harness.js init --stack react --host claude-code  # or node/nextjs/vue, codex/generic
node bin/harness.js new checkout --title "Checkout flow"
# planner: clarify with the user, then the write-* chain writes prd.md, vision.md,
# tech-design.md + pages.json, tasks.json, rubric.json + e2e-cases.json
node bin/harness.js clarify-done checkout    # coverage gate: every requirement needs an essential check
node bin/harness.js next checkout            # the only question the orchestrator ever needs to ask
node bin/harness.js packet checkout          # the role-scoped input for the agent that does it
node bin/harness.js task-done checkout TASK-1 --sha <commit>
node bin/harness.js capture checkout         # evaluator: Playwright screenshots of pages.json
node bin/harness.js eval checkout            # rubric evaluation; routes the loop itself
node bin/harness.js report checkout
```

Run the self-contained demos:

```bash
npm run demo       # one feature to done, with a simulated mid-run interruption
npm run example    # examples/notice-list: a real feature through fail → replan → fix → pass → done
```

## Evaluation with vetoes

A rubric is generated **per feature**, from its requirements:

```json
{ "id": "RB-1", "requirement": "REQ-1", "level": "essential",
  "kind": "command", "command": "npm test", "weight": 3 }
```

- `level`: `essential | important | optional | pitfall`
- `kind`: `command | file | grep | judge | scan` — the first three and `scan`
  are deterministic and decided by scripts, never by a model. `judge` is for
  what scripts cannot decide: an evaluator writes
  `{ "score": 0|0.5|1, "note": "…" }` to an evidence file; no evidence means
  score 0. `scan` reads a dimension score from the vendored gate engine.

  The bundled five-dimension scanner also runs standalone —
  `harness scan [--json] [path]`, no init, zero config, CI exit codes —
  and `harness skills list|install` manages the bundled skills pack. Each bundled skill (and the `harness`
  protocol skill) ships with a Chinese reading edition — `SKILL.zh-CN.md`
  beside the operative English `SKILL.md`, which stays the file hosts load.
  A sensor-fed rubric item looks like:

  ```json
  { "id": "RB-7", "requirement": "REQ-1", "level": "essential",
    "kind": "scan", "dimension": "structure", "minScore": 85, "weight": 2 }
  ```
- **Veto rule**: any essential item at 0, or any pitfall triggered, fails the
  verdict *no matter how high the weighted score is*. Averages never bury a
  fatal flaw.
- **Coverage gate**: implementation cannot start until every requirement maps
  to at least one essential item. You cannot game the denominator by not
  writing checks for the hard parts.

## Long-running by design

- All state in `.harness/tasks/<feature>/state.json`; `harness next` derives
  the next action from state alone — kill the agent, start a new session,
  resume exactly where it stopped.
- Per-task commits with SHAs verified by `git rev-parse --verify`.
  Placeholder SHAs are rejected.
- Budgets: macro cycles and per-task retries are capped in
  `harness.config.json`; exhaustion **pauses** the feature for a human
  instead of burning more tokens.
- Auto-stop: finishing requires the configured number of *stable* passes —
  the confirming evaluation must come from a fresh evaluator context.
- Advisory locking prevents two invocations from interleaving state writes.

## Stack packs & hosts

`init` installs a standards pack (`node`, `nextjs`, `vue`, `react`) — the
kernel is stack-agnostic; the pack carries the conventions (layering,
size, data/network, state, tokens, UI behavior, tests, visual
regression). Host support today: `claude-code` (installs the `harness`
protocol skill, the three role agents, the skills pack, and a
session-start hook that injects the orchestrator rules and the active
feature), `codex` / `generic` (instruction-level role files + protocol in
`.harness/`).

## Quality vision: anchored, not vibes (v0.3)

Coverage proves a feature *works*; it cannot prove it is *good*. Every
feature therefore carries a `vision.md`, written during clarify:

```
REF-1:  the settings page of <product> — dense, calm, one primary action.
ANTI-1: a card wall of equal-weight boxes; everything shouts, nothing leads.
RL-1:   the primary action is visible without scrolling. (check: screenshot)
RL-2:   no raw hex colors outside the token file. (check: command)
```

Rules the kernel enforces at `clarify-done` and again at `eval`:

- vision.md must exist with ≥1 REF, ≥1 ANTI, ≥2 RL, and every red line
  must declare how it is checked (`screenshot | dom | command`).
- Every `judge` rubric item must cite an anchor (`"anchor": "RL-1"`) that
  exists in vision.md. An unanchored quality judgment is rejected when the
  rubric loads — it is a vibe, not a check.
- Every requirement needs a judge item, or an explicit `qualityWaivers`
  entry with a reason. Silence is not a waiver.

## Governance: the gate may not rewrite its own rules (v0.3)

The vendored gate engine always contained a protected zone and a plan
scope guard; v0.3 wires them as commands:

```bash
node bin/harness.js verify-zone [path]   # protected files (gate.config.json by
                                         # default) changed? blocked unless a
                                         # human re-runs with GATE_HUMAN_CONFIRM=yes
node bin/harness.js scope plan.md [path] # changes outside the plan's declared
                                         # "Editable scope" section are blocked
node bin/harness.js scan --history <dir> # append-only scan reports + trend vs
                                         # the previous run
```

## E2E denominators and skill self-evaluation (v0.3)

- A pass rate is only as honest as its denominator. Declare
  `e2eCategories` minimums in the rubric (core / negative / boundary /
  crossFeature / persistence / uiJourney) and the coverage gate checks
  `e2e-cases.json` against them — N/A needs a written reason, core and
  negative need a blocking case. `policy.minPitfallsPerRequirement`
  likewise forces fatal flaws to be named in advance.
- The workflow's own skills are no longer exempt from evaluation:
  `harness skills eval` emits a golden-set packet (36 bundled cases,
  ~80/20 should/should-not trigger, every bundled skill covered), a fresh host session returns
  evidence, and the kernel scores trigger accuracy against a threshold.
  Editing a skill without re-running its eval is an ungraded change to
  the rules themselves.
- Visual regression: since v0.5 the kernel ships `harness capture` and
  `harness visual` (below). No baseline is still no visual verdict — the
  kernel does not fake checks.

## True long-running: `harness run` (v0.4)

The kernel never calls an LLM — that has not changed. What v0.4 adds is
the missing **driver**: a loop with no intelligence of its own that asks
the kernel what happens next, runs kernel steps (`clarify-done`, `eval`)
directly, and dispatches agent steps to a host agent CLI, headless:

```bash
node bin/harness.js run checkout --agent claude-code   # or codex
node bin/harness.js run checkout --agent-cmd "my-agent --headless {prompt}"
node bin/harness.js run checkout --max-steps 20 --max-minutes 240
npm run demo:run   # unattended run with a stand-in agent, incl. a driver restart
```

Stop conditions are explicit, never silent: **done**, **paused** (kernel
budget — a human decides), **needs-human** (clarification: the driver
will not fabricate user answers), **max-steps / timeout** (re-run to
continue — the driver holds no state, the kernel's files resume the
work), **agent-failing** (host CLI keeps erroring), and **stalled** —
an agent step that changes nothing in the state signature counts
against the run; two in a row end it. That last one is the "no
stagnation" rule, enforced mechanically instead of by exhortation.

## The agent layer (v0.5)

v0.4 could drive a loop; v0.5 says who does each step, what they may
see, and how they write the contract the kernel enforces.

**Three roles, isolation as a mechanism.** `init --host claude-code`
installs `.claude/agents/planner.md`, `developer.md`, `evaluator.md`
(hard boundaries, input/output contracts, handoff fields); codex/generic
get the same text in `.harness/agents/`. Each action belongs to one role:
clarify/replan → planner, implement-task/remediate → developer,
evaluate/confirm-evaluation → evaluator. The kernel builds each role's
packet from a whitelist (`harness packet <feature>`): the developer never
gets `rubric.json`; the evaluator never gets commit SHAs, developer
reports, the failure log or state history — `harness run` refuses to send
an evaluator packet that would. Under `run`, every step carries
`HARNESS_ROLE`, and kernel commands refuse the wrong role (only the
developer records `task-done` / `remediate-done`, only the planner
`replan-done`, nobody but the orchestrator runs `eval`). Judge evidence
must be newer than the work it judges and the previous evaluation, so
the confirmation pass really is fresh.

**An authoring chain that makes `clarify-done` pass honestly.** Thirteen
new skills (English operative + Chinese reading edition each):
`clarify-requirements` → `write-prd` → `write-quality-vision` →
`write-tech-design` (+ `pages.json`) → `write-dev-plan` →
`write-acceptance-criteria` (layered `rubric.json` + six-category
`e2e-cases.json`), then `implement-task`, `fix-from-report`,
`systematic-debugging`, `verification-before-completion` for the
developer, `e2e-testing` and `api-testing` for the evaluator, and
`sync-overview` for long-term memory. Docs installed to `.harness/docs/`:
`orchestration.md`, `evaluation-rubric-standard.md`,
`evaluation-heuristics.md`.

**Fixed verdict routes, no stopping at a summary.** `harness routes`
prints the verdict → next-step table; `harness eval` prints the next
action every time; the protocol skill and the session-start hook tell the
orchestrator to dispatch it in the same turn and never to answer a
clarification question for the user.

**Layered rubrics.** `"layerWeights": true` scores L1 correctness / L2
robustness / L3 UI / L4 interaction at 0.40 / 0.25 / 0.20 / 0.15 with
level weights 1 / 0.7 / 0.3; vetoes still beat any score. Optional
per-layer quotas (`policy.minEssentialPerLayer`, `minPitfallsPerLayer`).

**Rubric evolution.** Evaluators attach `rubricRefinementSuggestions`
to judge evidence; the kernel records them (`RS-n`), routes a failed
evaluation to `replan` first, and `replan-done` requires an answer for
each one, a real change for anything accepted, and a human
(`GATE_HUMAN_CONFIRM=yes`) for anything that loosens the locked rubric.

**Evidence capture and pixel diff.** `harness capture <feature>` takes
Playwright screenshots of the routes in `pages.json`; a non-PNG or a file
under `--min-bytes` (2 KB) fails, and placeholders exist only with
`--allow-fallback` (status `fallback`, never evidence). `harness visual`
diffs against `.harness/baselines/` with pixelmatch; a missing baseline
is `no-baseline` (exit 2), not a pass. A judge item anchored on a
screenshot-checked red line must cite a real PNG. Playwright, pixelmatch
and pngjs are **optional peer dependencies** — not installed, the
commands say exactly what to install.

## Data-spec conformance: the data dimension gets a reference (v0.6)

A scanner that only reads code can check hygiene — hardcoded secrets,
plain-http URLs, un-namespaced storage keys — but it cannot check the
thing that actually breaks at runtime: whether the code's view of the
data matches the contract. Point `inputs.dataSpec` in `gate.config.json`
at a contract file:

```json
{ "interfaces": [{ "name": "Campaign",
  "fields": { "id": "string", "startsAt": "date", "tags": "array" } }] }
```

and `harness scan` diffs the matching TypeScript `interface`/`type`
declarations against it, field by field: a spec field missing from the
code deducts 8, a type that disagrees (string vs date) deducts 6, a
field the code declares but the spec does not deducts 6. No spec input,
no change — zero-config scans behave exactly as before. A spec that
cannot be loaded, or a codebase with no type declarations at all,
reports *neutral*: unverified never poses as verified.

## Honest boundaries (v0.5)

- The kernel orchestrates and evaluates; it never calls an LLM.
  `harness run` dispatches packets to a host agent CLI (Claude Code,
  Codex, or any command via `--agent-cmd`) — the intelligence is the
  host's, the discipline is the kernel's. Without `run`, a host session
  drives the same loop interactively via `harness next`.
- Judge-kind items depend on a real evaluator producing evidence; the kernel
  enforces the *format and the veto*, not the judge's taste.
- One host is fully wired (Claude Code). Codex/generic are instruction-level.
- Isolation is enforced on what the kernel hands out and what it accepts;
  an agent with shell access can still open a file it was not given.
  The packet, the role guard and the freshness rule make that a
  deliberate violation, not an accident.
- The clarification gate (user confirmed, zero open questions) is a
  skill-level rule recorded in `clarification/summary.md`; the kernel
  enforces the rubric coverage that follows from it, not the
  conversation itself.
- The bundled example was recorded without a browser; its judge
  evidence cites rendered HTML. `harness capture` is tested against a
  Playwright stand-in and a real Playwright install (browser missing →
  clear error), not against a live browser in CI yet.

## Development

```bash
npm test        # 76 tests: the v0.1 kernel set (coverage gate, veto, pitfall,
                # judge evidence, resume, SHA verification, budget pause, full
                # loop to done) + v0.2 unification (scan-score equivalence with
                # the original ai-code-gate CLI, scan rubric items, skills-pack
                # install semantics) + v0.3 (vision anchors & waivers, e2e
                # category quotas, verify-zone / scope / scan history,
                # skills-eval scoring) + v0.4 run driver (unattended run to
                # done, driver restart resume, needs-human stop, agent
                # failure and stall detection) + v0.5 agent layer (role
                # packets and isolation tripwire, role guard, evidence
                # freshness and artifacts, layered scoring, refinement →
                # replan, capture/visual, the notice-list example replay)
                # + v0.6 data-spec conformance (field diff pass/deductions,
                # neutral on unloadable spec or missing declarations)
```

MIT License.
