# Standards pack: React / TypeScript / Vite

Copied to `.harness/standards.md` by `harness init --stack react`. The
planner cites it in the tech design; the developer reads it before every
task; the evaluator checks against it. **Edit it to match your project**
during `init` review — a rule here that the project does not follow is
worse than no rule. Lines marked *(gate)* are what the bundled sensor
(`harness scan`) or a delivery-gate command checks mechanically.

## 1. Stack baseline

- React 18+ function components and hooks; no class components.
- TypeScript `strict: true`; `npm run typecheck` passes after **every**
  task, not only at the end. *(gate: put typecheck in `gateCommands`)*
- No `any`, `as any`, `@ts-ignore` without a comment naming the reason
  and a follow-up. Prefer `unknown` + a narrowing function.
- New runtime dependencies only when `tech-design.md` names them.

## 2. Layout of the code

```
src/
  app/ or pages/        route-level screens (one folder per route)
    <route>/
      index.tsx         the screen: data wiring + layout only
      components/       pieces used only by this screen
  components/           shared, route-agnostic components
  hooks/                shared hooks (use*.ts)
  services/ or api/     the only place that talks to the network
  stores/               shared state with an explicit schema
  lib/ or utils/        pure helpers, no React
  styles/               tokens, global styles
```

- Layering: `components/`, `hooks/`, `lib/` never import from a route
  folder; routes never import each other. *(gate: `rules.structure.layers` in gate.config.json)*
- Path alias `@/` → `src/`; no `../../../` chains across layers.
- One component per file; file name = component name (PascalCase);
  hooks `useThing.ts`; helpers camelCase.
- Prefer named exports for components and hooks (`export function
  NoticeList`) — they rename-refactor and grep reliably.

## 3. Size

- File ≤ 300 lines, function ≤ 50–100 lines (pick one and configure it).
  Split by extracting a child component or a hook, not by moving code
  into a "utils" dumping ground. *(gate: `harness scan` structure)*
- A component with more than ~5 `useState` calls wants a reducer or a
  store with a schema.

## 4. Data and network

- Components never call `fetch` directly; they call functions in
  `services/` that return typed results and throw typed errors.
- Every async view handles four states: **loading, empty, error,
  no-permission**. Each is visible, designed and tested.
- Cancel in-flight requests on unmount or input change
  (`AbortController`); ignore late responses.
- Never trust the server shape: validate at the boundary
  (a schema or a narrowing function) once, then use the typed value.
- No secrets, tokens or environment-specific URLs in source; read
  configuration from env at build time. *(gate: `harness scan` data)*

## 5. State

- Local first: keep state in the component that owns it; lift only when
  two siblings need it; use a store only for cross-route state.
- Every store declares its state type and initial value in one place
  (see the `state-schema-first` skill).
- Persisted keys are namespaced: `<app>.<feature>.<field>`, and
  versioned when the shape can change.

## 6. Hooks and effects

- Complete dependency arrays — never silence `react-hooks/exhaustive-deps`.
- Effects synchronize with something outside React; derived values are
  computed during render (or `useMemo` when measured slow), not stored.
- Async work in an effect: define the async function inside and call it;
  clean up timers, subscriptions and controllers.
- List keys are stable ids, never the index for lists that reorder.

## 7. Styling and design tokens

- Colors, spacing, radius, shadow and font sizes come from tokens (CSS
  variables or the component library's theme). No raw hex/rgb in
  components. *(gate: `harness scan` ui — raw hex; design-token validity)*
- Spacing from one scale (4/8/12/16/24/32/48).
- Scoped styles (CSS Modules or the project's CSS-in-JS); no global
  selectors that restyle library components.
- No inline `style={{…}}` except for values computed at runtime (a
  width from data). *(gate: `maxInlineStylesPerFile`)*
- Avoid `transition: all` and large `backdrop-filter` areas.

## 8. Component library (if the project uses one)

- Use the library's components for buttons, inputs, tables, dialogs,
  messages — do not rebuild them.
- Import icons from one icon set only.
- Feedback goes through the library's message/notification API with one
  wording style; destructive actions use its confirm pattern.
- Customize through the theme/token API, not by overriding internal
  class names.

## 9. UI behavior

- Every click gets visible feedback within ~100 ms; submits disable
  while pending (no double submit).
- Errors tell the user what happened and what to do; forms keep input
  after an error and focus the first invalid field.
- Empty states say what to do next.
- Keyboard: every interactive element reachable with Tab, visible focus;
  images have `alt`, inputs have labels. *(gate: `harness scan` ui — img alt)*
- Avoid unnecessary secondary labels and descriptions. Let the layout do
  the explaining.

## 10. i18n

- User-visible text goes through the locale files; no hard-coded
  strings in components (see `i18n-extract`). *(gate: i18n keys exist)*
- Format dates, numbers and currency with `Intl`, in the user's locale
  and time zone.

## 11. Tests

- Pure logic: unit tests next to the module.
- Components: render + interact with Testing Library; assert on what the
  user sees (role, text), not on implementation details.
- Journeys: Playwright specs for every `e2e-cases.json` case marked
  blocking.
- A bug fix lands with the test that reproduced it.

## 12. Visual regression

- Core pages are listed in the feature's `pages.json`;
  `harness capture` screenshots them and `harness visual` diffs them
  against `.harness/baselines/` with pixelmatch. No baseline is reported
  as `no-baseline`, never as a pass; adopting one is explicit
  (`--update-baseline`), reviewed, and committed with the change.

## 13. Never

1. `fetch('/api/…')` inside a component.
2. Class components, or new code on a deprecated API.
3. Missing effect dependencies.
4. Reading response data after a redirect/auth failure was handled.
5. Global CSS that restyles library components.
6. Environment-specific URLs or secrets in source.
