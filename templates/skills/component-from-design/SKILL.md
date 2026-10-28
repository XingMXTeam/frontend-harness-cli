---
name: component-from-design
description: Build UI components strictly from the design system — tokens for color, spacing, type; no hardcoded values. Use when creating or restyling components from a spec or mock.
---

# Component From Design

Generated UI drifts: the AI reaches for a hex value that looks close, a
spacing that feels right, a font size from memory. Each choice is
almost right, and the sum is a UI that matches nothing. This skill makes
the design system the only source of visual values.

## When to Use

- Creating a component from a design spec, mock, or screenshot.
- Restyling an existing component to match the design system.
- Reviewing generated UI that "looks slightly off" everywhere.
- Working in a repo that has design tokens (CSS variables, a theme
  object, a token package) — especially then.

## Workflow

1. **Read the token source first.** Open the project's token definitions
   (variables file, theme, design-token package) and list the tokens
   this component needs: colors, spacing steps, font sizes, radii,
   shadows. Output: a token shortlist; if a needed value has no token,
   flag it now instead of inventing one mid-build.
2. **Map spec values to tokens.** Translate every visual value in the
   spec into a token name before writing styles. Output: a mapping such
   as "card padding 16px -> var(--spacing-4)". Unmapped values are
   questions for the designer or user, not invitations to hardcode.
3. **Reuse before creating.** Check the component library for an
   existing component or variant that covers the need. Output: reuse
   decision recorded (reused X / built new because Y).
4. **Write styles with tokens only.** Every color, spacing, and type
   value in the new code references a token or an existing component's
   API. Output: code where a search for raw hex/px values in the new
   styles returns nothing but allowed exceptions (e.g. 1px borders if
   the system permits them).
5. **Self-check against the spec.** Compare the result with the design:
   render a screenshot if tooling allows, or walk the structure
   element by element against the spec (order, hierarchy, states).
   Output: a checked list of elements and states (default, hover,
   disabled, empty, error) with mismatches fixed or reported.
6. **Report the gaps.** List any spec value that had no token and how
   it was resolved (new token proposed, closest token used with
   approval, or left as a flagged exception). Output: no silent
   improvisations.

## Anti-patterns

- ❌ Eyeballing a color and typing the hex you remember — the design
  system's primary color is not the one in your training data.
- ❌ Using a one-off pixel value because "16px vs the token's 15px is
  invisible" — ten invisible deviations are exactly how design drift
  happens.
- ❌ Building a fresh button/card/modal when the library already ships
  one, because writing it felt faster than reading the library's API.
- ❌ Checking only the default state: the spec's hover, disabled, and
  empty states are where token discipline usually breaks first.

## Done Criteria

- New styles contain no hardcoded color, spacing, or font-size values;
  everything resolves to a token or a shared component.
- The component was compared against the spec across all its states,
  by screenshot or structured walkthrough.
- Every token gap is reported with its resolution; none was silently
  improvised.
