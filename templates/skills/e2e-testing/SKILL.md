---
name: e2e-testing
description: Harness evaluator. Run a feature's user journeys in a real browser with Playwright, capture core-page screenshots with harness capture, look at every screenshot, probe beyond the scripted cases, score judge items 1/0.5/0 with cited artifacts, and file rubric refinement suggestions. Use during evaluate and confirm-evaluation.
---

# E2E Testing

Prove, in a real browser, that the journeys in `e2e-cases.json` work and
that the pages look the way `vision.md` says — then turn what you saw
into scores, findings and better rubric items.

## Tooling (one path, no IDE dependency)

- **Playwright** for everything a browser does:
  - scripted cases: `@playwright/test` specs (`npx playwright test …`);
  - screenshots: `harness capture <feature>` (Playwright library);
  - exploratory sessions: Playwright directly, or a Playwright MCP
    server if your host has one.
- Not installed? `npm i -D @playwright/test playwright && npx playwright install chromium`.
  If that is impossible in this environment, the evaluation is
  **blocked** — report it. Never substitute API calls, unit tests or
  reading the source for a browser journey.
- If one approach fails (a flaky selector, a timeout), switch approach
  instead of re-running the same failing command.

## Workflow

1. **Start the app** per `tech-design.md` ("Run instructions"). It does
   not start → that is the first finding.
2. **Run the scripted cases.** Every case in `e2e-cases.json` ends
   PASS / FAIL / SKIP; a SKIP needs a reason. Blocking cases that fail
   are blocking findings.
3. **Capture.** `harness capture <feature> --run-id c<cycle>-<n>`.
   Status must be `pass`. Do not use `--allow-fallback` for evidence.
   If baselines exist, `harness visual <feature>`; `no-baseline` is not
   a match — say so.
4. **Look at every screenshot.** Open each PNG. For each page write a
   short structured verdict: hierarchy, color and contrast, spacing and
   alignment, overflow, states, and the gap to each REF-n. Measure what
   the heuristics doc lets you measure (`page.evaluate`).
5. **Explore.** At least three probes from
   `evaluation-heuristics.md` §4 (double submit, long input, back/forward,
   reload mid-edit, odd action order, two tabs, slow network).
6. **Score.** For each judge item write its evidence JSON:
   `score` 1 / 0.5 / 0, `note` (why this score), `artifacts` (screenshots,
   spec output, API logs), `heuristics` (ids). A screenshot-checked red
   line needs a real PNG in `artifacts`.
7. **Refine the rubric.** Add `rubricRefinementSuggestions` wherever an
   item was hard to score (`refine`), had no way to prove it
   (`add-verification`), a defect had no item (`add`), or a level was
   wrong (`regrade`).
8. **Write `evaluation/eval-<cycle>.md`** (below). Do not run
   `harness eval`.

## Report `eval-<cycle>.md`

```markdown
# Evaluation — <feature>, cycle <n> (<evaluate|confirm>)
Tools: Playwright <version>; capture run <id> (status pass, 6 pages)

## E2E cases
| case | category | blocking | result | evidence |

## Rubric (judge items)
| id | layer | level | score | reason | artifacts |

## Comparison with references
| dimension | REF-n | ours | gap | fix | rubric id |

## Exploratory findings
| id | probe | result | severity | add as E2E case? | evidence |

## Findings
| heuristic | artifact | severity | problem | recommendation | rubric id |

## Rubric refinement suggestions
| RS (assigned by kernel) | type | item | problem | suggestion |
```

Critical and major findings must map to a rubric id (or an `add`
suggestion) so the next cycle can fix them.

## Rules

- You never edit product code or the rubric.
- You never read `developer/**`, `failure-log.md`, commit messages.
- A confirmation pass starts from zero: new capture, new evidence files.

## Done Criteria

- Every case has a result; every judge item has fresh evidence with
  artifacts; screenshots were opened and described; at least three
  probes ran; the report is written.
