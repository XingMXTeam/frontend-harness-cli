# Standards pack: Vue 3 / TypeScript / Vite

Replace this file with your project's real conventions during `harness init`
review. The planner and implementer must read it before writing code.

- Vue 3 Composition API with `<script setup lang="ts">`; TypeScript strict; `npm run typecheck` (vue-tsc) must pass per task, not just at the end.
- Styling via the project's token system / scoped CSS; no raw hex colors, no hand-written shadows or radii.
- Respect the layering rules of the repo (shared components/composables never import route views; views never import each other).
- Single file <= 300 lines, single function <= 100 lines; extract components/composables instead of growing.
- Loading, empty, error and no-permission states are part of "done" for every async view.
- State lives in Pinia stores or composables with an explicit schema — never in ad-hoc reactive objects passed down by props.
- i18n strings go through the locale files; no hard-coded user-visible text in components.
