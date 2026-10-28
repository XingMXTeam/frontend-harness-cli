# Standards pack: Node.js (generic)

Replace this file with your project's real conventions during `harness init`
review. The planner and implementer must read it before writing code.

- Runtime: Node >= 20, ESM (`"type": "module"`), zero new dependencies unless the plan says why.
- Every exported function has a test or a rubric check that exercises it.
- No `console.log` left in shipped code paths (use the project's logger).
- Errors are thrown with context, never swallowed silently.
- Files stay under 300 lines; split before they grow past it.
