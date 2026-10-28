# Evaluation — notice-list, cycle 1 (evaluate)

Tools: rendered-state snapshots (`scripts/snapshot.mjs`); Playwright not
available in this environment, so no PNG capture — the red lines are
command-checked, and the judge items cite HTML renders.

## E2E cases
| case | category | blocking | result | evidence |
| --- | --- | --- | --- | --- |
| E2E-1 | core | yes | PASS | render-ready.html: n3 first, 2 unread, badge 2 |
| E2E-2 | core | no | PASS | buttons and rows in tab order |
| E2E-3 | negative | yes | PASS | render-error.html: alert + Retry, no empty sentence |
| E2E-4 | negative | yes | PASS | RB-5 command output: title escaped |
| E2E-5 | boundary | no | **FAIL** | 300-char title clipped by ellipsis (nowrap) |
| E2E-6 | uiJourney | no | PASS | render-empty.html: sentence + Refresh |

## Rubric (judge items)
| id | layer | level | score | reason | artifacts |
| --- | --- | --- | --- | --- | --- |
| RB-6 | L3 | essential | 0 | titles clip (H-UI-6.4); PRD says wrap | render-ready.html |
| RB-9 | L4 | essential | 1 | one sentence + one action in both states | render-empty.html, render-error.html |

## Comparison with references
| dimension | REF | ours | gap | fix | rubric id |
| --- | --- | --- | --- | --- | --- |
| row density | REF-1: one row, 12px rhythm | same | none | — | RB-6 |
| long titles | REF-1 wraps to two lines | single line + ellipsis | clipped text | wrap (`overflow-wrap: anywhere`) | RB-6 |

## Findings
| heuristic | artifact | severity | problem | recommendation | rubric id |
| --- | --- | --- | --- | --- | --- |
| H-UI-6.4 | render-ready.html | major | long titles clip | let titles wrap; keep the time column fixed | RB-6 |

## Rubric refinement suggestions
| type | item | problem | suggestion |
| --- | --- | --- | --- |
| refine | RB-6 | no viewport or measurement | 375px and 1280px; no title with scrollWidth > clientWidth |
