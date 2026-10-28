---
name: i18n-extract
description: Extract hardcoded user-visible strings into locale resources and verify every key exists. Use when adding i18n, auditing copy, or preparing a release for translation.
---

# I18n Extract & Verify

Internationalization breaks quietly: a hardcoded string ships in one
language, a component calls a key that was never added to the resource
file, and nobody finds out until a user screenshots it. This skill does
both halves — extraction and completeness checking — because either one
alone leaves the failure mode in place.

## When to Use

- Adding i18n support to a codebase or a feature area.
- Auditing a feature before release or before handing copy to
  translators.
- A bug report shows raw keys ("home.title") or untranslated text in
  the UI.
- After a refactor that moved components between pages or namespaces.

## Workflow

1. **Fix the conventions first.** Confirm from the codebase: the
   resource file layout, the key naming pattern (e.g.
   `namespace.section.key`), and how code calls translations. Output:
   the conventions written down; if none exist, propose them and get
   agreement before touching files.
2. **Scan for hardcoded strings.** Search the target code for
   user-visible literals: JSX text, button labels, placeholders,
   aria-labels, toast and error messages. Output: a list of file:line
   hits, excluding non-visible strings (class names, test IDs, log
   messages — per project convention).
3. **Extract with stable keys.** Move each string into the resource
   file under a key that names its location and meaning, and replace
   the literal with the translation call. Output: resource entries and
   call sites that pair up one-to-one.
4. **Verify completeness both directions.** For every translation call
   in the code, check the key exists in the resource file; for every
   resource key, note whether anything calls it. Output: two lists —
   missing keys (must be zero) and unused keys (report, don't
   auto-delete).
5. **Check every locale, not just the default.** Repeat the existence
   check against each shipped locale file. Output: per-locale missing
   key counts; a key missing in one locale is a defect, not a TODO.
6. **Run the app surface.** Where feasible, load the affected screens
   in a non-default locale and look for raw keys or fallback text.
   Output: screens checked, or an explicit "not run" note.

## Anti-patterns

- ❌ Using the English sentence as the key ("Click here to continue").
  The first copy edit orphans every call site; keys name meaning and
  place, never wording.
- ❌ Concatenating translated fragments ("You have " + n + " items").
  Word order differs per language; use parameterized messages with
  placeholders.
- ❌ Extracting only the visible happy path and leaving error toasts,
  empty states, and validation messages hardcoded — those are the
  strings users screenshot.
- ❌ Declaring done after updating the default locale while other
  locales silently miss the new keys and fall back at runtime.

## Done Criteria

- Zero hardcoded user-visible strings remain in the audited scope.
- Every translation call resolves to an existing key in every shipped
  locale (missing count reported per locale, and it is zero).
- Unused keys are listed in the report, not silently deleted.
- Keys follow the project's namespace convention consistently.
