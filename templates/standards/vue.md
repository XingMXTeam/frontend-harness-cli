# Standards pack: Vue 3 / TypeScript / Vite

Copied to `.harness/standards.md` by `harness init --stack vue`. The
planner cites it in the tech design; the developer reads it before every
task; the evaluator checks against it. **Edit it to match your project**
during `init` review. Lines marked *(gate)* are checked mechanically by
the bundled sensor (`harness scan`) or a delivery-gate command.

## 1. Stack baseline

- Vue 3 Composition API with `<script setup lang="ts">`; no Options API
  in new code.
- TypeScript `strict: true`; `npm run typecheck` (vue-tsc) passes after
  **every** task, not only at the end. *(gate: `gateCommands`)*
- New dependencies only when `tech-design.md` names them.

## 2. Layout

```
src/
  views/<Route>/         route-level views (one folder per route)
    <Route>View.vue      data wiring + layout
    components/          used only by this view
  components/            shared, route-agnostic components
  composables/           useThing.ts — shared logic with state
  services/ or api/      the only place that talks to the network
  stores/                Pinia stores with an explicit state type
  utils/                 pure helpers, no Vue
  router/                route table, guards
  styles/                tokens, globals
```

- Shared components and composables never import from `views/`; views
  never import each other. *(gate: `rules.structure.layers`)*
- Path alias `@/` → `src/`.
- Components PascalCase (`NoticeList.vue`), multi-word names; composables
  `useNotices.ts`.
- File ≤ 300 lines, function ≤ 50–100 lines; split with child
  components and composables. *(gate: `harness scan` structure)*

## 3. Components

- `defineProps` / `defineEmits` with type-only declarations; props are
  read-only — copy into local state when the component edits them.
- `v-model` via `defineModel` (or the explicit prop + emit pair).
- `v-for` always has a stable `:key` (an id, not the index for lists that
  reorder); never `v-if` and `v-for` on the same element.
- Template expressions stay simple; move logic into `computed`.
- Use slots for layout variation instead of boolean prop explosions.

## 4. Data and network

- Components never call `fetch`/axios directly; they call `services/`
  functions returning typed results and throwing typed errors.
- Every async view handles **loading, empty, error, no-permission**.
- Abort stale requests when inputs change or the view unmounts
  (`onScopeDispose` / `onBeforeUnmount`).
- Validate server shapes at the service boundary once.
- No secrets or environment-specific URLs in source; use `import.meta.env`
  and only expose `VITE_*` values that are safe in the browser.
  *(gate: `harness scan` data)*

## 5. State

- Local first; Pinia only for cross-view state.
- Every store declares its state interface and initial value in one
  place (`state-schema-first`); actions are the only writers.
- Use `storeToRefs` when destructuring; never destructure reactive state
  into plain variables.
- Persisted keys namespaced `<app>.<feature>.<field>`, versioned.

## 6. Reactivity

- `ref` for primitives and replaced values, `reactive` only for objects
  you never reassign; `computed` for derived values — do not mirror them
  with watchers.
- `watch` with explicit sources; clean up side effects with the
  `onCleanup` argument.

## 7. Styling and tokens

- `<style scoped>` or CSS Modules; tokens (CSS variables or the UI
  library theme) for color, spacing, radius, shadow, font size. No raw
  hex/rgb. *(gate: `harness scan` ui)*
- Spacing from one scale (4/8/12/16/24/32/48).
- Override library components through their theme API, not `:deep()`
  selectors on internal classes — and never globally.
- No inline styles except runtime-computed values.

## 8. UI library (if the project uses one)

- Use its components for forms, tables, dialogs, messages; register them
  on demand (auto-import or explicit imports), not the whole library.
- One message/notification API and one confirm pattern for destructive
  actions.

## 9. UI behavior

- Visible feedback within ~100 ms of every action; pending submits are
  disabled.
- Errors name the problem and the next step; forms keep input after an
  error and focus the first invalid field.
- Empty states say what to do next.
- Keyboard access and visible focus; `alt` on images, labels on inputs.
  *(gate: img alt)*
- Avoid unnecessary secondary labels and descriptions. Let the layout do
  the explaining.

## 10. Router

- Lazy-load route views; route guards check auth/permission and redirect
  with a reason the view can show.
- Params and query are validated before use.

## 11. i18n

- User-visible text through vue-i18n (or the project's equivalent) locale
  files; no hard-coded strings in templates. *(gate: i18n keys exist)*
- Dates and numbers through `Intl` with the user's locale and time zone.

## 12. Tests

- Unit tests for utils, composables and stores (Vitest).
- Component tests with Vue Test Utils / Testing Library; assert on what
  the user sees.
- Playwright specs for every blocking case in `e2e-cases.json`.
- A fix lands with the test that reproduced it.

## 13. Visual regression

- Core pages in the feature's `pages.json`; `harness capture` + `harness
  visual` (pixelmatch vs `.harness/baselines/`). No baseline is
  `no-baseline`, not a pass; adopting baselines is explicit and reviewed.

## 14. Never

1. Options API or mixins in new code.
2. Mutating props.
3. `v-if` with `v-for` on one element; index keys on reorderable lists.
4. Network calls from components.
5. Global or `:deep()` overrides of library internals.
6. Secrets or environment-specific URLs in source.
