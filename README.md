# harness-cli

A generic, host-agnostic **Harness kernel** for long-running AI coding.

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
node bin/harness.js init --stack node --host claude-code   # or nextjs/python, codex/generic
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

`init` installs a standards pack (`node`, `nextjs`, `python`) — the kernel is
stack-agnostic; the pack carries the conventions. Host support today:
`claude-code` (installs a `harness` skill + a session-start hook that injects
the active feature), `codex` / `generic` (instruction-file integration).

## Honest boundaries (v0.2)

- The CLI orchestrates and evaluates; it does not spawn agents. Your host
  agent executes the packets `harness next` returns.
- Judge-kind items depend on a real evaluator producing evidence; the kernel
  enforces the *format and the veto*, not the judge's taste.
- One host is fully wired (Claude Code). Codex/generic are instruction-level.

## Development

```bash
npm test        # 21 tests: the v0.1 kernel set (coverage gate, veto, pitfall,
                # judge evidence, resume, SHA verification, budget pause, full
                # loop to done) + scan-score equivalence with the original
                # ai-code-gate CLI, scan rubric items, and skills-pack
                # install semantics (all / skip-existing / --only / unknown)
```

MIT License.
