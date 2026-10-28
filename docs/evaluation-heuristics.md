# Evaluation heuristics

Checklists the evaluator uses to score judge items with a reason rather
than a mood. Every check has an id; when a finding drives a score, cite
the id in the judge evidence (`"heuristics": ["H-UI-3.1"]`) and attach
the artifact that shows it. Where a check is measurable, the measurement
and a way to take it with Playwright are given — measure instead of
eyeballing whenever you can.

You do not have to record every check. You do have to cite one for every
score below 1.

Three perspectives, mapped to the rubric layers:

| Perspective | Layer | Section |
| --- | --- | --- |
| UI design | L3 | 1 |
| Interaction / UX | L4 | 2 |
| Product | L1 (+ L2 for edge cases) | 3 |

Task-level checks (one task, between implementation steps) use section 3
only. A full evaluation uses all three.

## Measuring in the page

Run these inside `page.evaluate` (Playwright) on the captured route.

```js
// H-UI-6.4 overflow: elements whose text is clipped horizontally
[...document.querySelectorAll('body *')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').length

// H-UI-4.1 alignment / H-UI-6.5 overlap: two boxes intersect
const r = (s) => document.querySelector(s).getBoundingClientRect();
const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

// H-UI-2.3 contrast: read color + background-color, compute the WCAG ratio
// L = 0.2126 R + 0.7152 G + 0.0722 B (linearized); ratio = (L1 + 0.05) / (L2 + 0.05)
```

## 1. UI design (L3)

### 1.1 Hierarchy
- **H-UI-1.1** Type scale: each heading step is ≥ 1.2× the next level
  down; body text ≥ 14 px on desktop, ≥ 16 px on mobile.
- **H-UI-1.2** One primary action per view, visibly heavier (fill,
  weight or size) than secondary actions.
- **H-UI-1.3** The eye has a start point: the page title or the primary
  data is the first thing in reading order and the largest text block.

### 1.2 Color
- **H-UI-2.1** One color per meaning (success, warning, error, info)
  across the product; no new hues for the same status.
- **H-UI-2.2** Colors come from tokens / theme variables; no raw hex in
  components (the `scan` ui dimension measures this).
- **H-UI-2.3** Contrast ≥ 4.5:1 for body text, ≥ 3:1 for text ≥ 18 px
  (or 14 px bold) and for meaningful icons and input borders.
- **H-UI-2.4** No status conveyed by color alone (pair with text or icon).

### 1.3 Spacing
- **H-UI-3.1** Spacing values come from one scale (multiples of 4:
  4/8/12/16/24/32/48); count off-scale values in computed styles.
- **H-UI-3.2** Proximity: space inside a group < space between groups.
- **H-UI-3.3** Same component, same padding, everywhere it appears.

### 1.4 Alignment
- **H-UI-4.1** Items in one row or column share an edge (±1 px).
- **H-UI-4.2** Table columns: numbers right-aligned, text left, status
  centered or left consistently; header alignment matches its column.
- **H-UI-4.3** One grid / max content width per page type.

### 1.5 Density
- **H-UI-5.1** Density matches the vision's stated target (compact /
  balanced / airy); compare against the REF screenshot, not taste.
- **H-UI-5.2** No screen asks the user to compare more than ~7 unrelated
  groups at once.

### 1.6 Completeness and polish
- **H-UI-6.1** Loading, empty, error and no-permission states exist and
  are designed (an empty state says what to do next).
- **H-UI-6.2** Radius, border and shadow come from tokens and match
  across components.
- **H-UI-6.3** One icon family and style (outline or filled, not both).
- **H-UI-6.4** No clipped or overflowing text at the target viewports
  (measure, see above).
- **H-UI-6.5** No overlapping interactive elements.
- **H-UI-6.6** Layout holds at every viewport the vision names (at least
  one mobile width when mobile is in scope).

### 1.7 Against the anchors
- **H-UI-7.1** Side-by-side with each REF-n: name the concrete gap
  (spacing, hierarchy, density) or state there is none.
- **H-UI-7.2** Check each ANTI-n: is the anti-pattern present?

## 2. Interaction (L4)

### 2.1 Efficiency
- **H-UX-1.1** Count the steps (clicks + required inputs) for each core
  journey; compare with the PRD's expected path. Extra confirmation
  dialogs and intermediate pages are findings.
- **H-UX-1.2** High-frequency actions have a short path (bulk action,
  keyboard, inline edit) when the PRD calls them frequent.

### 2.2 Feedback
- **H-UX-2.1** Visible response to every action within ~100 ms (pressed
  state, spinner, optimistic update); measure with a trace when in doubt.
- **H-UX-2.2** Anything over ~1 s shows progress; anything over ~10 s can
  be left or cancelled.
- **H-UX-2.3** Every success and failure ends in a visible result (toast,
  inline message, state change), not silence.
- **H-UX-2.4** Buttons that submit are disabled or debounced while the
  request is in flight (no double submit).

### 2.3 Errors
- **H-UX-3.1** Destructive actions confirm or offer undo.
- **H-UX-3.2** Error messages say what happened and what to do; "Something
  went wrong" alone is a finding.
- **H-UX-3.3** Forms validate per field before submit, keep the user's
  input after an error, and focus the first invalid field.
- **H-UX-3.4** After an error the user can retry without reloading.

### 2.4 Cognitive load
- **H-UX-4.1** Choices on one screen ≤ 7±2 per group.
- **H-UX-4.2** Related information is grouped and labeled; nothing the
  user needs for one decision lives on another page.
- **H-UX-4.3** Domain terms are explained where they first appear.

### 2.5 Consistency
- **H-UX-5.1** The same action behaves the same everywhere (sorting,
  filtering, closing dialogs).
- **H-UX-5.2** One word per concept (not delete / remove / clear for the
  same thing).

### 2.6 Discoverability and access
- **H-UX-6.1** Core features are reachable from visible UI, not only via
  hover, right-click or long-press.
- **H-UX-6.2** Clickable things look clickable (cursor, affordance) and
  have hit areas ≥ 24×24 px (44×44 on touch).
- **H-UX-6.3** Every interactive element is reachable and operable by
  keyboard with a visible focus ring; images have alt text; inputs have
  labels.

### 2.7 Against the anchors
- **H-UX-7.1** Walk the core journey of each REF-n that covers
  interaction; name where ours has more friction.

## 3. Product (L1, L2)

- **H-PR-1.1** Every PRD requirement has an implementation the evaluator
  could exercise; list any that are missing.
- **H-PR-1.2** Non-goals are not implemented (over-building is a finding).
- **H-PR-2.1** Displayed values equal the source data (spot-check against
  the API response or fixture).
- **H-PR-2.2** Derived values (totals, percentages, sort order) are
  correct, including ties and empty sets.
- **H-PR-2.3** Dates, times and time zones render as specified.
- **H-PR-3.1** The core journey runs end to end without the user
  carrying information between pages by hand.
- **H-PR-3.2** After any error the app returns to a working state.
- **H-PR-3.3** Data survives a reload where the PRD says it persists.

## 4. Exploratory probes

After the scripted E2E cases, try at least three of these on the real
page and record what happened (they feed new E2E cases and refinement
suggestions):

- rapid repeated clicks / double submit;
- empty submit and very long input (≥ 1,000 characters, emoji, RTL text);
- back / forward navigation mid-flow;
- reload in the middle of an edit;
- actions in an unexpected order (cancel then confirm, delete then edit);
- two tabs acting on the same record;
- slow network (`page.route` with a delay) and an offline request.

## 5. Writing the finding

One line each, so the planner can turn it into a task or an item:

```
H-UI-6.4 | evidence/c2-20260301-101500/list.png | major | Long titles clip at 1280 px | wrap to two lines, then ellipsis with a tooltip | RB-9
```

Severity: **critical** (blocks a core journey or loses data), **major**
(visible to most users, workaround exists), **minor** (polish), **info**.
