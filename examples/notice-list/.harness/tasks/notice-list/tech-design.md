# Tech design — notice-list

1. **Stack:** plain ES modules, no framework (as the repo). Tests with `node:test`. No new dependencies.
2. **Architecture:** `src/notice-list.js` exports pure functions; `index.html` mounts the rendered HTML; styles in `src/notice-list.css` on top of `src/tokens.css`.
3. **Modules:** model (`sortNotices`, `unreadCount`), rendering (`renderNoticeList`, `escapeHtml`). Rendering depends on the model; nothing depends on rendering.
4. **Data flow / state:** `view = { status: 'loading' | 'error' | 'ready', notices? }` → HTML string. Empty is `ready` with zero notices — a distinct branch from `error`.
5. **Contracts:** `sortNotices(list): Notice[]` (newest first, stable), `unreadCount(list): number`, `renderNoticeList(view, { locale }): string`.
6. **Errors:** the error state shows a message and a Retry button; it never falls through to the empty branch.
7. **Tests:** unit tests for the model and each render state; evidence capture of the three screens with Playwright.
8. **Run:** `node scripts/serve.mjs 5173` → `http://localhost:5173/?state=ready|empty|error`.
9. **Trade-offs:** string rendering keeps every state testable without a DOM; escaping is centralized in `escapeHtml`.
10. **Overview deltas:** none.
