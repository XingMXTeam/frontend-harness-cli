# Standards pack: Next.js (App Router) / React / TypeScript

Copied to `.harness/standards.md` by `harness init --stack nextjs`. The
planner cites it in the tech design; the developer reads it before every
task; the evaluator checks against it. **Edit it to match your project**
during `init` review. Lines marked *(gate)* are checked mechanically by
the bundled sensor (`harness scan`) or a delivery-gate command.

## 1. Stack baseline

- Next.js App Router, React 18+, TypeScript `strict: true`.
- `npm run typecheck` and `npm run lint` pass after **every** task.
  `npm run build` passes before evaluation — server/client boundary
  errors only show up there. *(gate: `gateCommands`, e.g. `npm run gate`)*
- No `any` / `@ts-ignore` without a reason in a comment.
- New dependencies only when `tech-design.md` names them.

## 2. Layout

```
src/app/
  (group)/<route>/
    page.tsx            server component by default: data + layout
    loading.tsx         loading state for the segment
    error.tsx           error boundary ("use client")
    not-found.tsx       when the segment has a 404 state
    _components/        pieces used only by this route
  _components/          shared across routes (never imports a route)
src/lib/                server-safe helpers, data access, validation
src/services/           network calls (one place)
src/styles/             tokens, globals
```

- Routes never import another route's files; shared code never imports
  a route. *(gate: `rules.structure.layers`)*
- Path alias `@/` → `src/`.
- File ≤ 300 lines, function ≤ 50–100 lines; split into components and
  hooks. *(gate: `harness scan` structure)*

## 3. Server and client components

- Components are server components unless they need state, effects,
  event handlers or browser APIs; then `"use client"` goes on the
  smallest leaf that needs it, not on the page.
- Never import server-only modules (database, secrets, `fs`) into a
  client component; mark them `import 'server-only'`.
- Pass serializable props across the boundary; no functions, class
  instances or Dates without conversion.
- Fetch data in server components or route handlers; client fetching is
  for user-driven refreshes, and goes through `services/`.

## 4. Data, caching, mutations

- State the caching decision for every fetch (`cache`, `revalidate`, or
  `no-store`) in code and in the tech design. "Default" is a decision only
  if written down.
- Mutations: server actions or route handlers; validate input on the
  server (schema), return typed results, revalidate the affected paths.
- Every async view has **loading, empty, error, no-permission** states —
  `loading.tsx` / `error.tsx` per segment where it applies.
- Environment variables: server-only by default; only `NEXT_PUBLIC_*`
  reaches the browser, and never a secret. *(gate: `harness scan` data)*

## 5. Navigation and routing

- Links with `next/link`; programmatic navigation with `useRouter` from
  `next/navigation`. No `window.location` for in-app routes.
- Route params and search params are validated before use.
- Feature flags gate routes at the server, not by hiding links only.

## 6. State

- Server state stays on the server (or in a query cache); client state
  is local first, lifted when needed, stored only when cross-route.
- Stores declare their state type and initial value in one place
  (`state-schema-first`). Persisted keys are namespaced
  `<app>.<feature>.<field>`.

## 7. Styling and tokens

- Tokens for color, spacing, radius, shadow, font size (CSS variables or
  the UI library theme). No raw hex/rgb in components. *(gate: `harness scan` ui)*
- CSS Modules (`*.module.css|scss`) or the project's CSS-in-JS; with a
  CSS-in-JS UI library, use its App Router registry so styles render on
  the server without a flash.
- No inline styles except runtime-computed values.
- Images via `next/image` with explicit size and `alt`. *(gate: img alt)*
- Fonts via `next/font`; no layout shift from late fonts.

## 8. UI behavior

- Visible feedback within ~100 ms of every action; pending submits are
  disabled (`useFormStatus` / a pending flag).
- Error messages name the problem and the next step; forms keep input.
- Empty states say what to do next.
- Keyboard access and focus states for every interactive element.
- Avoid unnecessary secondary labels and descriptions. Let the layout do
  the explaining.

## 9. i18n

- User-visible strings through the locale files; dates and numbers
  through `Intl` with the user's locale and time zone.

## 10. Tests

- Unit tests for `lib/` and services; component tests for client
  components (Testing Library); Playwright for journeys against
  `next build && next start` (not only `next dev`) before delivery.
- A fix lands with the test that reproduced it.

## 11. Visual regression

- Core routes in the feature's `pages.json`; `harness capture`
  screenshots them against a running build; `harness visual` diffs
  against `.harness/baselines/` (pixelmatch). No baseline is
  `no-baseline`, not a pass; adopting baselines is explicit and reviewed.

## 12. Never

1. `"use client"` on a whole page to make one button interactive.
2. Secrets or server-only imports reachable from client code.
3. An uncached/cached decision left implicit for data the user edits.
4. `fetch` in a component outside `services/` (client) or the data layer (server).
5. Hand-written colors, shadows or radii instead of tokens.
6. Shipping without `npm run build` having passed.
