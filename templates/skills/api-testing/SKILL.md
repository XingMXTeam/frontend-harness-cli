---
name: api-testing
description: Harness evaluator. Independently verify the API or data-layer behavior a feature depends on — real requests for success, failure and boundary cases, with request/response evidence. Use during evaluate when a task or requirement has an API contract in tech-design.md.
---

# API Testing

Check the contract from outside, with real calls. The developer's report
is not evidence; your own requests are.

## Inputs

- `tech-design.md` section "API / interface contracts".
- `prd.md` requirements and `e2e-cases.json` cases that depend on the API.
- The running app or API, started as `tech-design.md` says.

## Workflow

1. From the contract, list cases: success, each documented error,
   boundaries (empty, max length, pagination edges), permission denied,
   and malformed input.
2. Execute each as a real request (`curl`, `fetch`, Playwright's
   `request` context). Mocked transports are not evidence.
3. For each case record: method + path, request body/params, expected
   status and shape, actual status and body (trimmed), verdict.
4. Save the log to `.harness/tasks/<feature>/evaluation/api-<cycle>.md`
   and cite it in the relevant judge items' `artifacts`.
5. A contract mismatch is a finding with severity; a missing contract
   (the design never said what an error looks like) is a refinement
   suggestion (`add-verification`).

## Rules

- Independent: do not use the developer's scripts as the proof.
- Do not modify product code or data fixtures to make a case pass.
- An API case proves the API — never a browser journey.

## Done Criteria

- Every contract case executed with recorded request/response and a
  verdict; the log is cited from the judge evidence it supports.
