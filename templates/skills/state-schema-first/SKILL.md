---
name: state-schema-first
description: Define the state schema — fields, types, defaults, source of truth — before writing feature code. Use when adding state, stores, caches, or persisted data.
---

# State Schema First

State bugs are design bugs discovered late: two components keep their
own copy of the same fact, a persisted key collides with another
feature's, and nobody can say what the initial value should be. Writing
the schema first turns those into decisions made once, on paper,
instead of bugs found in production.

## When to Use

- A new feature needs client state, a store, or a cache.
- Data will be persisted (localStorage, sessionStorage, IndexedDB,
  cookies).
- Server data and local edits must coexist (drafts, optimistic updates,
  offline queues).
- Debugging reveals components disagreeing about the same value.

## Workflow

1. **List the facts.** Enumerate every piece of state the feature
   needs, one row per fact. Output: a fact list before any types are
   chosen.
2. **Write the schema.** For each fact define: field name, type,
   default/initial value, and whether it may be absent. Output: a
   schema (TypeScript type, JSON schema, or table — the project's
   idiom) that a reviewer can read without opening component code.
3. **Assign one source of truth.** For each fact, name its single
   owner: server, store, URL, form state, or derived-from-X. Facts
   with two owners get redesigned now, not synchronized later. Output:
   an owner column with exactly one entry per fact.
4. **Separate server state from client state.** Mark which facts are
   cached copies of server data and which exist only locally; they
   have different lifetimes and invalidation rules. Output: the split
   made explicit in the schema.
5. **Namespace persisted keys.** Every storage key follows a pattern
   like `{app}.{feature}.{field}` and includes a version segment if
   the shape may evolve. Output: the key list, collision-checked
   against keys already in the codebase.
6. **Define the transitions.** List who may change each fact and when
   (actions/events, not "anywhere"). Output: enough traceability that
   "how did it become this value?" is answerable from the code.
7. **Then write code.** Components consume the schema; they do not
   extend it ad hoc. New facts go through steps 1–6 first. Output:
   implementation that matches the schema field for field.

## Anti-patterns

- ❌ Scattering the same fact across component state, a global store,
  and localStorage, then adding an effect to "keep them in sync" —
  sync code is an admission the schema was never decided.
- ❌ Persisting under a bare key like `"settings"` or `"draft"` that
  the next feature (or the same feature next year) will collide with.
- ❌ Letting the shape evolve silently: adding a field in one place,
  reading it defensively everywhere else, and never migrating or
  versioning the stored value.
- ❌ Modeling server data as local state and hand-rolling refetch,
  staleness, and error flags that the project's data layer already
  handles.

## Done Criteria

- A written schema exists covering every fact the feature uses, with
  type, default, and single owner for each.
- All persisted keys are namespaced and collision-checked.
- No fact has two sources of truth; derived values are marked derived.
- The implementation matches the schema — verified by reading both,
  not by memory.
