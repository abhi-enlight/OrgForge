# 004 — Gate `scroll-behavior: smooth` behind reduced-motion preference

- **Status**: DONE (2026-08-12 — normal-mode smooth scroll verified in browser; reduce-side instant jump not automatable, per plan)
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file, ~6 lines

## Problem

`frontend/src/app/globals.css` sets smooth scrolling unconditionally, so anchor-link jumps (the hero's "See what it does" → `#capabilities`, `#how-it-works`, `scroll-mt-20` sections) animate for users who prefer reduced motion:

```css
/* frontend/src/app/globals.css:41-47 — current */
html {
  scroll-behavior: smooth;
  /* framer-motion useScroll infers the window as its scroll container and
     warns if it computes position:static — a non-static html silences that
     while changing nothing visually. */
  position: relative;
}
```

Smooth scrolling is exactly the kind of position movement that must be disabled under `prefers-reduced-motion: reduce`.

## Target

Move `scroll-behavior` behind a `no-preference` media query; keep the `position: relative` comment and rule where they are:

```css
/* target */
html {
  /* framer-motion useScroll infers the window as its scroll container and
     warns if it computes position:static — a non-static html silences that
     while changing nothing visually. */
  position: relative;
}

@media (prefers-reduced-motion: no-preference) {
  html {
    scroll-behavior: smooth;
  }
}
```

## Repo conventions to follow

- The codebase already has a `@media (prefers-reduced-motion: reduce)` block in the same file (`globals.css`, gating `.skeleton` and the landing loops) — this uses the complementary `no-preference` guard, matching the playbook's example (`@media (prefers-reduced-motion: no-preference)` for gating automatic motion on).

## Steps

1. Remove the `scroll-behavior: smooth;` line from the `html { }` rule.
2. Add the `@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }` block immediately after the `html` rule.
3. Leave the comment and `position: relative` intact.

## Boundaries

- Do NOT touch any other rule in `globals.css`.
- Do NOT remove `position: relative` (it silences a framer-motion `useScroll` warning).
- Do NOT touch framer-motion scroll code in `Hero.tsx` / `HowItWorks.tsx` — those already gate via `useReducedMotion`.

## Verification

- **Mechanical**: from `frontend/`, run `npm run lint` — must pass. (No type impact.)
- **Feel check**:
  - Normal mode: click the hero "See what it does" — the page still smooth-scrolls to `#capabilities`.
  - DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`: click the same anchor — the jump is **instant**, no scroll animation.
- **Done when**: smooth scrolling is present by default and absent under the reduce preference.
