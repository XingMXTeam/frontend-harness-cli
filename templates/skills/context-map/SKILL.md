---
name: context-map
description: Create and maintain an AGENTS.md project map for an unfamiliar repo — structure, commands, sources of truth, high-risk areas. Use when onboarding to a codebase.
---

# Context Map

An agent dropped into an unfamiliar repo doesn't fail from lack of
skill; it fails from lack of a map. It greps blindly, reinvents a
utility that already exists, and edits a file three other features
depend on. This skill builds the map once so every later session starts
oriented.

## When to Use

- First time working in a repository, or after joining a new project.
- The repo has an AGENTS.md / CLAUDE.md that is missing, stale, or a
  2,000-line dump nobody can use.
- The agent keeps asking questions the repo could answer itself
  (how to run tests, where components live, what not to touch).
- After a restructure that moved directories, commands, or conventions.

## Workflow

1. **Survey the terrain.** List top-level directories and state what
   each owns in one line. Output: a structure section where every entry
   has a purpose, not just a name.
2. **Capture the commands.** Find how to install, run, build, lint,
   typecheck, and test — from package scripts, Makefiles, or CI config,
   and verify each command exists. Output: a command table copied from
   real config, never from memory.
3. **Point to sources of truth.** For each kind of fact (API contract,
   design tokens, routing rules, state conventions, error codes), name
   the file or doc that is authoritative. Output: pointers, one line
   each — the map links to truth, it does not copy it.
4. **Mark the high-risk zones.** List files and directories where a
   careless edit has outsized blast radius (shared components, global
   styles, config, generated code, migration scripts) and what care
   means there. Output: a short list with a reason per entry.
5. **Record the hard rules.** Write the repo's few non-negotiable
   conventions as imperatives ("use the shared Button, don't create a
   new one"). Output: at most a handful of rules, each verifiable.
6. **Keep it an index.** If a section needs more than a few lines, link
   to the doc instead of pasting it. Output: the whole map stays
   scannable in under two minutes.
7. **Verify by walking it.** Pick three pointers at random and open
   them; fix any that are wrong or dead. Output: every link and path in
   the map checked at least once.

## Anti-patterns

- ❌ Dumping the entire wiki into AGENTS.md. A map that contains
  everything is read by no one and decays fastest exactly where it
  matters.
- ❌ Copying command lists from the README without checking them
  against the actual scripts — stale commands are worse than none,
  because the agent will trust them.
- ❌ Writing conventions as aspirations ("we prefer clean code")
  instead of checkable rules ("files stay under ~300 lines; split
  before adding").
- ❌ Letting the map fossilize: restructuring the repo and leaving the
  old paths in place, so the next session navigates by a map of a city
  that no longer exists.

## Done Criteria

- AGENTS.md (or the repo's equivalent) exists at repo root and covers:
  structure, verified commands, sources of truth, high-risk zones,
  hard rules.
- The map is an index: it points to facts instead of restating them,
  and stays readable in minutes.
- Every path and command in it was verified against the current repo.
