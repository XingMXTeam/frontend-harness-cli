# Dev plan — notice-list

### TASK-1: Notice model
**Goal** — newest-first ordering and the unread count.
**Files** — Create: `src/notice-list.js` (model part) · Tests: `test/model.test.js`
**Contract** — `sortNotices(list)`: newest `createdAt` first, stable, non-mutating. `unreadCount(list)`.
**Verify** — `node --test test/model.test.js` — 3 passing.

### TASK-2: Render states
**Goal** — HTML for ready / empty / loading / error; all text escaped.
**Files** — Modify: `src/notice-list.js` · Create: `fixtures.js` · Tests: `test/render.test.js`
**Contract** — `renderNoticeList(view, { locale })`; error never renders the empty sentence; actions are `<button type="button">`.
**Verify** — `node --test test/render.test.js` — 5 passing.

### TASK-3: Styles and demo page
**Goal** — compact rows per REF-1, tokens only; a page that mounts each state by `?state=`.
**Files** — Create: `src/tokens.css`, `src/notice-list.css`, `index.html`, `scripts/serve.mjs`
**Contract** — no raw hex outside `src/tokens.css`.
**Verify** — the hex check in `tasks.json`; manual: `node scripts/serve.mjs`.

## Editable scope
- `src/**`
- `test/**`
- `fixtures.js`
- `index.html`
- `scripts/**`
