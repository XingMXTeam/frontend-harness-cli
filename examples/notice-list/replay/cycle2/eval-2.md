# Evaluation — notice-list, cycle 2 (evaluate, then confirm)

Tools: rendered-state snapshots (`scripts/snapshot.mjs`); Playwright not
available here (see cycle 1). Confirmation pass regenerated every
evidence file in a fresh context.

## E2E cases
| case | category | blocking | result | evidence |
| --- | --- | --- | --- | --- |
| E2E-1 | core | yes | PASS | render-ready.html |
| E2E-2 | core | no | PASS | tab order |
| E2E-3 | negative | yes | PASS | render-error.html |
| E2E-4 | negative | yes | PASS | RB-5 command output |
| E2E-5 | boundary | no | PASS | titles wrap (`overflow-wrap: anywhere`), time column unaffected |
| E2E-6 | uiJourney | no | PASS | render-empty.html |

## Rubric (judge items)
| id | layer | level | score | reason | artifacts |
| --- | --- | --- | --- | --- | --- |
| RB-6 | L3 | essential | 1 | matches REF-1; no clipped title at either viewport | render-ready.html |
| RB-9 | L4 | essential | 1 | one sentence + one action; RL-2 holds | render-empty.html, render-error.html |

## Exploratory findings
| id | probe | result | severity | add as E2E case? | evidence |
| --- | --- | --- | --- | --- | --- |
| EXP-1 | double-click Retry | Retry has no pending state (the example has no network layer yet) | minor | yes, when a fetch layer exists | render-error.html |

## Rubric refinement suggestions
| type | item | problem | suggestion |
| --- | --- | --- | --- |
| add-verification | RB-9 | scored from HTML, claim is visual | cite capture PNGs + measure button contrast once Playwright runs in CI |
| add | NEW (L4, important) | EXP-1 has no item | Retry shows a pending state and cannot be double-clicked |
