# frontend-harness-cli

A host-agnostic **Harness kernel for long-running frontend AI coding**.

Why frontend? Because that is where the evidence is. The sensor's five
dimensions (structure / data / logic / **ui** / e2e), half the bundled
skills (`component-from-design`, `i18n-extract`), the stack packs
(**node / nextjs / vue**) and a decade of the author's production frontend
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
never calls an LLM. Host agents (Claude Code, Codex, Cursor, …) do the
planning, coding and judging; the CLI owns state, coverage, evaluation,
gates and budgets.

## The loop

```
clarify ──(user confirms; rubric coverage gate)──▶ implement
   ▲                                                  │  one task at a time:
   │                                                  │  implement → check →
   │                                                  │  precise commit → record SHA
   │                                                  ▼
   └──── remediate (open items only) ◀── evaluation (rubric + veto)
                                                     │ pass ×N stable
                                                     ▼
                                              delivery gate ──▶ done
        budget exhausted at any point ──▶ paused (human decides)
```

## Quick start

```bash
node bin/harness.js init --stack node --host claude-code   # or nextjs/vue, codex/generic
node bin/harness.js new checkout --title "Checkout flow"
# …clarify with the user; the planner writes .harness/tasks/checkout/rubric.json + tasks.json
node bin/harness.js clarify-done checkout    # coverage gate: every requirement needs an essential check
node bin/harness.js next checkout            # the only question a host agent ever needs to ask
node bin/harness.js task-done checkout TASK-1 --sha <commit>
node bin/harness.js eval checkout            # rubric evaluation; routes the loop itself
node bin/harness.js report checkout
```

Run the self-contained demo (includes a simulated mid-run interruption):

```bash
npm run demo
```

## One product, three layers (unified in v0.2)

This CLI began as three separate tools — a skills pack, a kernel, and a code
gate. They are one product now, because they were always three layers of the
same idea:

- **Behavior layer — the skills pack.** Eight field-tested skills
  (`plan-before-code`, `deterministic-eval`, `context-map`,
  `component-from-design`, `i18n-extract`, `state-schema-first`,
  `bug-root-cause`, `ship-checklist`), vendored from the former
  `harness-skills` repo. They ship as *data* in `templates/skills/`:
  `init --host claude-code` installs them next to the `harness` skill, and
  `harness skills list|install [--project|--dir <path>] [--only a,b]`
  manages them standalone. Skills guide the agent; they decide nothing.
- **Kernel layer — this CLI.** State, coverage, evaluation, budgets,
  auto-stop. The only place a verdict is ever produced.
- **Sensor layer — the gate engine.** The five-dimension deterministic
  scanner formerly published as `ai-code-gate` (structure / data / logic /
  ui / e2e, AST-level checks), vendored into `src/gate/` at v0.5.0.

Two rules keep the layers honest:

1. **Exactly one verdict authority.** Inside the loop, the sensor's scores
   are *inputs*: a rubric item of kind `scan` reads one dimension score and
   compares it against the item's own `minScore`. The sensor never passes or
   fails a feature — the rubric does.
2. **`harness scan` stands alone.** No init, no project state, zero config
   (it reads `gate.config.json` when present, defaults otherwise), exit code
   mirrors the sensor result for CI — exactly how `ai-gate` behaved.
   Equivalence tests pin the vendored engine to the original CLI's scores
   on both bundled fixtures (good: 100/pass; bad: 64/fail), so "unified"
   never quietly means "changed the ruler".

```bash
node bin/harness.js scan [--json] [path]        # standalone sensor report
node bin/harness.js skills list                 # the bundled pack
node bin/harness.js skills install --project    # into ./.claude/skills
```

A rubric item fed by the sensor looks like:

```json
{ "id": "RB-7", "requirement": "REQ-1", "level": "essential",
  "kind": "scan", "dimension": "structure", "minScore": 85, "weight": 2 }
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

`init` installs a standards pack (`node`, `nextjs`, `vue`) — the kernel is
stack-agnostic; the pack carries the conventions. Host support today:
`claude-code` (installs a `harness` skill + a session-start hook that injects
the active feature), `codex` / `generic` (instruction-file integration).

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
  `harness skills eval` emits a golden-set packet (20 bundled cases,
  80/20 should/should-not trigger), a fresh host session returns
  evidence, and the kernel scores trigger accuracy against a threshold.
  Editing a skill without re-running its eval is an ungraded change to
  the rules themselves.
- Visual regression is deliberately an external-tool route: the stack
  packs say how to wire a pixel-diff tool as a delivery-gate command.
  No baseline, no visual verdict — the kernel does not fake checks.

## Honest boundaries (v0.3)

- The CLI orchestrates and evaluates; it does not spawn agents. Your host
  agent executes the packets `harness next` returns.
- Judge-kind items depend on a real evaluator producing evidence; the kernel
  enforces the *format and the veto*, not the judge's taste.
- One host is fully wired (Claude Code). Codex/generic are instruction-level.

## Development

```bash
npm test        # 37 tests: the v0.1 kernel set (coverage gate, veto, pitfall,
                # judge evidence, resume, SHA verification, budget pause, full
                # loop to done) + v0.2 unification (scan-score equivalence with
                # the original ai-code-gate CLI, scan rubric items, skills-pack
                # install semantics) + v0.3 (vision anchors & waivers, e2e
                # category quotas, verify-zone / scope / scan history,
                # skills-eval scoring)
```

MIT License.
