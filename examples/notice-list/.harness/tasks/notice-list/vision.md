# Quality vision — notice-list

## 1. Positioning
Level: polished. Priorities: correctness > interaction > visual.
Tone: a quiet work tool — information first, decoration last.

## 2. References
REF-1: A code-host notification inbox — one row per notice, unread rows bold with an accent dot, muted timestamp at the row end, no cards. Applies to L3.
REF-2: The same inbox's empty and error states — one sentence plus exactly one obvious next action. Applies to L4.
ANTI-1: Card grids with shadows and avatars for one-line items — they halve density and bury the unread signal. Applies to L3.

## 3. Design intent
- Visual: neutral surface, one accent color for unread, tokens only.
- Density: compact — 12 px row rhythm, no card chrome.
- Interaction model: read-only scan; the only actions are Retry and Refresh.
- Key screens: list (REF-1), empty (REF-2), error (REF-2).

## 4. Red lines
RL-1: Notice text is never interpreted as markup. (check: command)
RL-2: A failed load never renders as an empty list. (check: command)

## 5. Rubric mapping
Design intent → RB-6, RB-7, RB-8 (L3). Interaction → RB-9, RB-10, RB-11 (L4).
RL-1 → RB-5 (pitfall). RL-2 → RB-4 (pitfall). REF-1/REF-2 are compared in every full evaluation.
