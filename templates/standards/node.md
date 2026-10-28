# Standards pack: Node.js (generic)

Copied to `.harness/standards.md` by `harness init --stack node`. Use it
for Node libraries, CLIs, and the server or tooling side of a frontend
project. The planner cites it in the tech design; the developer reads it
before every task; the evaluator checks against it. **Edit it to match
your project** during `init` review. Lines marked *(gate)* are checked
mechanically by `harness scan` or a delivery-gate command.

## 1. Runtime and modules

- Node ≥ 20, ESM (`"type": "module"`), `node:` prefixes for built-ins.
- Zero new dependencies unless `tech-design.md` names them and says why.
  Prefer the standard library (`node:test`, `fetch`, `node:fs/promises`,
  `structuredClone`, `AbortController`).
- TypeScript or JSDoc types on every exported function.

## 2. Layout

```
bin/        CLI entry points (argument parsing, exit codes; no logic)
src/        modules, one responsibility each
test/       node:test (or the project's runner) mirroring src/
```

- `bin/` calls into `src/`; `src/` never reads `process.argv` or calls
  `process.exit`.
- File ≤ 300 lines, function ≤ 50–100 lines. *(gate: `harness scan` structure)*

## 3. Errors

- Throw `Error` (or a subclass) with context: what failed, with which
  input, and what to do. Never throw strings.
- Never swallow: a `catch` either handles (with a reason in a comment),
  adds context and rethrows, or converts to a typed result.
- CLI: expected failures print one actionable line to stderr and exit
  non-zero; unexpected ones keep the stack.
- No `process.exit()` inside code that holds a lock or has pending writes —
  throw and let the top level exit (cleanup runs in `finally`).

## 4. I/O and state

- Writes that must survive a crash are atomic (write a temp file, then
  rename).
- Paths are built with `path.join`/`path.resolve` from a known root;
  never from string concatenation of user input.
- External commands via `spawnSync`/`execFile` with an argv array, not a
  shell string, unless the command is user-configured on purpose.
- Timeouts on every network call and child process.

## 5. Configuration and secrets

- Configuration from a file with defaults merged in code, or env vars;
  validated at startup with a clear message.
- No secrets, tokens or environment-specific URLs in source or logs.
  *(gate: `harness scan` data)*

## 6. Logging

- No `console.log` left in library code paths; use the project's logger,
  or write to stderr for diagnostics in CLIs. *(gate: `harness scan` logic)*
- Machine-readable output behind a `--json` flag; human output stays
  stable enough to read.

## 7. Async

- `async`/`await` throughout; no unhandled promises — every promise is
  awaited, returned, or explicitly detached with a `.catch`.
- Concurrency is bounded (a small pool), never `Promise.all` over an
  unbounded list of network calls.
- Cancellation with `AbortController` where callers can give up.

## 8. Tests

- Every exported function has a test or a rubric check that exercises it.
- Tests are hermetic: temp directories (`mkdtemp`), no network, no
  dependence on the developer's machine or home directory.
- A bug fix lands with the test that reproduced it.
- Tests assert behavior (outputs, files, exit codes), not internals.

## 9. Style

- Small pure functions; side effects at the edges.
- Names say what a thing is or does; no abbreviations beyond common ones.
- Comments explain *why*, not *what*.
- Avoid unnecessary secondary labels and descriptions in user-facing
  output. Let the structure do the explaining.

## 10. Never

1. A new dependency for something the standard library does.
2. Swallowed errors or bare `catch {}` without a reason.
3. Shell-string interpolation of untrusted input.
4. Tests that touch the network or the real home directory.
5. `process.exit()` from library code.
