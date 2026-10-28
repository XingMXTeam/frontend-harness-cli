---
name: write-tech-design
description: Harness planner, authoring step 3. Write .harness/tasks/<feature>/tech-design.md and pages.json (the routes evidence capture will screenshot). Use after write-quality-vision, before write-dev-plan.
---

# Write the Tech Design

Decide how the feature is built inside this repository, and which pages
the evaluator will capture. Follow the codebase's existing patterns; a
new pattern needs a reason the user agreed to.

## Gate

- `prd.md` and `vision.md` exist; the clarification summary is confirmed.
- Read `.harness/overview/technical.md`, `.harness/standards.md`, and
  the code the feature touches.

## Sections of `tech-design.md`

1. **Stack and key dependencies** — what is used, confirmed in
   clarification ("as the repo" or the explicit new choice). The
   developer may not add anything not named here.
2. **Architecture overview** — where the feature lives; a diagram in
   text is enough.
3. **Modules and boundaries** — new and changed modules, what each owns,
   what may import what.
4. **Data flow and state** — sources, stores, the state shape (see
   `state-schema-first`), loading / empty / error / no-permission states.
5. **API / interface contracts** — endpoints or function signatures with
   request, response and error shapes.
6. **Error handling** — per failure mode: what the user sees, what is
   retried, what is logged.
7. **Test strategy** — unit, component, API, E2E (Playwright): what is
   tested at which level.
8. **Run instructions** — the command that starts the app for
   evaluation, its URL, and the frontend working directory.
9. **Risks and trade-offs** — options considered and why this one.
10. **Overview deltas** — for `sync-overview` (or "none").

## `pages.json`

If the feature has UI, write `.harness/tasks/<feature>/pages.json` now,
from the PRD's key screens and the app's router — not from test cases,
which do not exist yet.

```json
{
  "baseUrl": "http://localhost:5173",
  "viewport": { "width": 1280, "height": 800 },
  "fullPage": false,
  "pages": [
    { "name": "notices", "route": "/notices", "waitFor": "[data-testid=notice-list]" },
    { "name": "notices-empty", "route": "/notices?fixture=empty" }
  ]
}
```

- `name` kebab-case and unique; `route` starts with `/` and is unique;
  `waitFor` is a selector that only exists once the page has rendered.
- Cover every key screen in `vision.md`, plus the states (empty, error)
  that have their own URL or fixture switch.
- If several apps or route sets could apply and you cannot tell which,
  ask the user once.
- No UI: skip the file and write `ui-evidence: N/A — <reason>` in
  section 7.

## Rules

- Prefer the simplest boundary that can be tested in isolation.
- Name the exact files that will change; the dev plan's tasks reuse them.
- No TODO / TBD. A genuinely unknown choice goes back to the user.
- Do not write to `.harness/overview/`; list deltas in section 10.

## Done Criteria

- All sections present; the stack section matches the clarification.
- `pages.json` validates (`harness capture` checks it) and covers every
  key screen, or the N/A is stated.
- Next skill: `write-dev-plan`.
