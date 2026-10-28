# Harness report — notice-list

- Phase: **done** (macro cycle 2/3)
- Title: Notice list
- Tasks: 3/3 done
  - ✅ TASK-1 Notice model: newest-first sort and unread count
  - ✅ TASK-2 Render ready / empty / loading / error states with escaping
  - ✅ TASK-3 Token-based styles and the demo page
- Git HEAD: n/a

## Last evaluation
- Verdict: **pass**, score 1 (pass >= 0.9) — L1 1×0.4, L2 1×0.25, L3 1×0.2, L4 1×0.15
- No vetoes

## Rubric refinements
- ⏳ RS-2 [add-verification] RB-9: once Playwright is available in CI, cite harness capture PNGs of /?state=empty and /?state=error and measure the button's contrast (H-UI-2.3)
- ⏳ RS-3 [add] NEW: Retry shows a loading state while the request is in flight and cannot be double-clicked (H-UX-2.4)
- ✅ RS-1 [refine] RB-6: name the viewports (375px and 1280px) and the measurement: no .notice__title with scrollWidth > clientWidth — RB-6 now names 375px and 1280px and the scrollWidth > clientWidth measurement (H-UI-6.4).

## History
- clarify-done
- task-done TASK-1
- task-done TASK-2
- task-done TASK-3
- rubric-refinements-recorded
- evaluation-failed
- replanned
- remediation-fixed
- rubric-refinements-recorded
- evaluation-passed
- evaluation-passed
- done
