# Standards pack: Next.js / React / TypeScript

Replace this file with your project's real conventions during `harness init`
review. The planner and implementer must read it before writing code.

- Next.js App Router + TypeScript strict; `npm run typecheck` must pass per task, not just at the end.
- Styling via the project's token system / CSS Modules; no raw hex colors, no hand-written shadows or radii.
- Respect the layering rules of the repo (shared code never imports route modules; routes never import each other).
- Single file <= 300 lines, single function <= 100 lines; extract components/hooks instead of growing.
- Loading, empty, error and no-permission states are part of "done" for every async view.
