# Clarification summary — notice-list

Recorded by the planner from the user's answers (`answers.md`, not
included in this example). Formal files were written only after the two
lines at the bottom were true.

- **Goal:** a user opening the app sees their notices, newest first, and
  can tell at a glance which are unread and how many.
- **Users:** any signed-in user; no roles differ for this view.
- **Main path:** open the list → scan → (out of scope: open a notice).
- **Edge paths:** no notices; still loading; the load failed (must offer
  retry and must not look like "no notices").
- **Data:** `{ id, title, createdAt (ISO, UTC), read }`; titles are
  user-generated text and may contain markup characters.
- **Stack:** as the repo — plain ES modules, no framework, `node:test`.
- **Non-goals:** marking as read, pagination, opening a notice, push.
- **Budgets:** 3 macro cycles, 2 stable passes, gate = `npm test`.
- **Quality:** level B (polished). References: a code-host notification
  inbox (REF-1: one row per item, unread bold + dot, muted timestamp);
  ANTI-1: a card grid with shadows and avatars for one-line items.
  Red lines: unescaped text; an error that looks like an empty list.

confirmed-by-user: yes (2026-03-01, "yes, that's the scope — ship it with retry on errors")
open-questions: 0
