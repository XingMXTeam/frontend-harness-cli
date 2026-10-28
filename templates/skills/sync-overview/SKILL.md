---
name: sync-overview
description: Harness planner, after a feature reaches done (or a replan changed a boundary). Fold stable product and technical changes into .harness/overview/product.md and technical.md — summaries only. Use when harness report shows phase done, before starting the next feature.
---

# Sync the Overview

The overview is the project's long-term memory: what the product can do
and how it is put together, at a level someone new could read in five
minutes. Every planner reads it before clarifying; only this skill
writes it.

## When to Use

- A feature reached `done` (`harness report <feature>`).
- A replan changed a module boundary or a capability area.

Never during clarify or authoring — those steps list "overview deltas"
in `prd.md` and `tech-design.md` for you to pick up here.

## Files

- `.harness/overview/product.md` — capability areas, users and roles,
  scope boundaries, open directions.
- `.harness/overview/technical.md` — modules and their boundaries, data
  sources, cross-cutting constraints, architecture direction.

## Workflow

1. Read both files and the feature's `prd.md` and `tech-design.md`
   (sections "Overview deltas"), plus the final evaluation report.
2. List the changes: added, changed, retired — product side and
   technical side.
3. Write each change as a short line in the right section. Merge rather
   than append when a line already covers it.
4. No stable change? Add a dated line "no overview change (<feature>)" —
   never invent one to look busy.
5. Something still undecided may be written as "direction under
   discussion", never as a fact.

## Never write into the overview

- task ids, case ids, rubric ids, commit SHAs;
- commands, request/response bodies, file-by-file change lists;
- copies of PRD or tech-design sections.

## Output (to the orchestrator)

- 3–10 change lines, whether a module boundary changed (yes/no), and the
  feature it came from.

## Done Criteria

- Both files updated (or a dated "no change" line), summary-level only.
