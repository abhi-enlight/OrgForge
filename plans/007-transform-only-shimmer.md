# 007 — Make the skeleton shimmer transform-only

- **Status**: DONE (2026-08-12 — CSS parses clean, page serves 200, code review clean; skeleton visual feel-check auth-gated)
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: MEDIUM
- **Category**: Performance (paint-bound infinite animation)
- **Estimated scope**: 1 file (globals.css)

## Problem

The skeleton loader animates `background-position` on a 1.6s infinite loop — a **paint-bound** property — exactly when the page is heaviest (data loading). Per the playbook, only `transform` and `opacity` may be animated.

```css
/* frontend/src/app/globals.css:96-118 — current */
@keyframes skeleton-shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.skeleton {
  background: linear-gradient(
    90deg,
    rgba(232, 234, 240, 0.7) 25%,
    rgba(245, 246, 250, 1) 50%,
    rgba(232, 234, 240, 0.7) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.6s ease-in-out infinite;
}
```

## Target

Move the sweep to a `::after` overlay animated with `transform: translateX` (compositor-only), over a static base background. Same timing (1.6s `ease-in-out` infinite), same visual intent.

```css
/* target */
@keyframes skeleton-shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.skeleton {
  position: relative;
  overflow: hidden;
  background: rgba(232, 234, 240, 0.7);
}

.skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.55),
    transparent
  );
  animation: skeleton-shimmer 1.6s ease-in-out infinite;
}
```

Also extend the existing reduced-motion block so the new pseudo-element stops too:

```css
/* frontend/src/app/globals.css — current reduce block */
@media (prefers-reduced-motion: reduce) {
  .skeleton,
  .animate-blueprint-drift,
  .animate-ambient-float,
  .animate-ambient-pulse {
    animation: none;
  }
}
/* target: add the pseudo-element (plain `.skeleton { animation: none }` no longer reaches it) */
@media (prefers-reduced-motion: reduce) {
  .skeleton,
  .skeleton::after,
  .animate-blueprint-drift,
  .animate-ambient-float,
  .animate-ambient-pulse {
    animation: none;
  }
}
```

## Repo conventions to follow

- Transform-only motion is the documented rule in this codebase — `globals.css` says "transform-only so it stays on the compositor" on the `blueprint-drift`/`ambient-float` keyframes, and `LivePipeline.tsx`'s header comment states "All motion is transform/opacity only."
- `.skeleton` elements are always plain rounded boxes with no children (`workspace/page.tsx` `WorkspaceSkeleton`, stage loading states), so `overflow: hidden` + `::after` is safe.

## Steps

1. Replace the `skeleton-shimmer` keyframes with the `translateX` version.
2. Replace the `.skeleton` rule with the `position: relative; overflow: hidden;` static-background version.
3. Add the `.skeleton::after` overlay rule.
4. Add `.skeleton::after` to the reduced-motion kill list.
5. Confirm no other rule referenced `.skeleton`'s old gradient classes (search `skeleton-shimmer` — only globals.css uses it).

## Boundaries

- Do NOT change the 1.6s timing, the `ease-in-out`, or the infinite loop.
- Do NOT touch `.animate-pulse` skeletons (agents page) — separate utility, covered by plan 003's reduce-gating.
- Do NOT change any component markup — `.skeleton` usage stays identical.
- If the excerpt above has drifted, STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npm run lint` — must pass. Load `/workspace` (or any page using `.skeleton`) and confirm the shimmer still sweeps left→right.
- **Feel check**:
  - While a skeleton is visible, record a DevTools Performance trace — the shimmer must show **no Paint/Layout rows for the skeleton** (only Composite).
  - Toggle `prefers-reduced-motion: reduce` — the skeleton renders as a static gray block (no sweep).
- **Done when**: shimmer runs on the compositor and freezes under reduced motion.
