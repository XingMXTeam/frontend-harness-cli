---
name: write-quality-vision
description: Harness planner, authoring step 2. Write .harness/tasks/<feature>/vision.md — numbered REF/ANTI/RL quality anchors the rubric's judge items will cite. Use after write-prd, before tech design.
---

# Write the Quality Vision

`vision.md` is the bridge between "what the user expects it to feel
like" and "what the evaluator will score". Judge items in the rubric must
cite an anchor from this file; the kernel rejects ones that do not.

## Gate

- `prd.md` exists and `clarification/summary.md` is confirmed.
- Read `clarification/quality-expectations.md` and the PRD's "What good
  looks like". Everything in the vision comes from the user's answers —
  you do not invent taste.

## Anchor syntax (parsed by the kernel)

One anchor per line, anywhere in the file:

```
REF-1: <positive reference — what is good about it, and where to see it>
ANTI-1: <anti-reference — what to avoid, and why>
RL-1: <red line — never acceptable> (check: screenshot|dom|command)
```

Minimums enforced at `clarify-done`: ≥ 1 REF, ≥ 1 ANTI, ≥ 2 RL, and every
RL declares how it is checked. A red line checked by `screenshot` makes
its judge item cite a real PNG.

## Structure

```markdown
# Quality vision — <feature>

## 1. Positioning
Level: MVP | polished | production
Priorities: correctness > interaction > visual > performance > …
Tone: <one sentence, e.g. "a dense, calm work tool; information first">

## 2. References
REF-1: <source> — worth copying: <specific traits> — applies to: L3/L4
ANTI-1: <source> — avoid: <specific traits> — applies to: L3/L4

## 3. Design intent
- Visual: <keywords; palette direction or tokens; type direction>
- Density: compact | balanced | airy | dashboard
- Interaction model: direct manipulation | wizard | form-and-submit | …
- Key screens:
  | Screen | User goal | Target state | Anchor |
  | list | scan unread | one row per notice, … | REF-1 |

## 4. Red lines
RL-1: <never acceptable> (check: screenshot)
RL-2: <never acceptable> (check: command)

## 5. Rubric mapping
- Design intent -> L3 items; interaction model -> L4 items
- RL-n -> pitfall items (or essential judge items citing RL-n)
- REF-n -> comparison in every full evaluation
```

## Rules

1. **Concrete over adjectives.** "Card gap 12–16 px, secondary text on
   the neutral-600 token" — not "should look nice".
2. **Every reference is annotated.** A link without "what is good about
   it" is not an anchor.
3. **Every red line is detectable** in a screenshot, the DOM, or a
   command. "Should feel fast" is not a red line; "no click without
   visible feedback within 100 ms" is.
4. **Directions you proposed** (when the user had no references) enter
   only after the user picked one in clarification.
5. **No UI?** Keep sections 1, 4, 5 with API quality anchors (consistent
   error shape, actionable messages) and write `ui-vision: N/A — <reason>`.

## Done Criteria

- REF ≥ 1, ANTI ≥ 1, RL ≥ 2 with `(check: …)`; every key screen has a
  target state.
- Nothing in the file lacks a source in the user's answers.
- Next skill: `write-tech-design`.
