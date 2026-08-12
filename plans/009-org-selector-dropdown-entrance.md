# 009 — Give the workspace org selector the same dropdown entrance as the header menus

- **Status**: DONE
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: LOW
- **Category**: Missed opportunity (spatially-connected UI, cohesion)
- **Estimated scope**: 1 file, 1 class string

## Problem

The workspace's org selector dropdown — a spatially-connected panel that appears from its trigger button — opens with **no motion at all**, while the two header menus (plan 006) use the documented `animate-scale-in` entrance. Sibling popovers should feel the same; this one teleports.

```tsx
// frontend/src/components/workspace/OrgSelector.tsx:85-89 — current
{isOpen && (
  <div
    role="listbox"
    className="absolute right-0 mt-2 w-72 rounded-xl bg-white border border-brand-border shadow-lift py-1 z-50"
  >
```

## Target

Adopt the documented dropdown entrance (`DESIGN.md:110` — "`animate-scale-in` (menus/dropdowns)") with the trigger-anchored origin, matching the header menus exactly:

```tsx
// target
{isOpen && (
  <div
    role="listbox"
    className="absolute right-0 mt-2 w-72 rounded-xl bg-white border border-brand-border shadow-lift py-1 z-50 animate-scale-in origin-top-right"
  >
```

The panel now scales in from its own top-right corner (toward the trigger) in 200ms — identical feel to the header org/avatar menus. The dropdown is anchored `right-0`, so `origin-top-right` matches the header treatment from plan 006.

## Repo conventions to follow

- `animate-scale-in` + `origin-top-right` is the exact pattern plan 006 establishes for header menus — replicate it verbatim so all three dropdowns share one entrance.
- The component is `'use client'` (`OrgSelector.tsx:1`) so the CSS class runs client-side; no `useReducedMotion` needed because plan 003's reduced-motion handling freezes `.animate-pulse` etc. — note the scale-in is *not* frozen by MotionConfig (it's pure CSS), and that's fine: it's a 200ms opacity+scale entrance, well within "keep gentle feedback under reduced motion".

## Steps

1. In `frontend/src/components/workspace/OrgSelector.tsx:85-89`, append `animate-scale-in origin-top-right` to the dropdown's className.
2. Leave everything else — the trigger button, `role="listbox"`, menu items, outside-click handling — untouched.

## Boundaries

- Do NOT add an exit animation (consistent with plan 006's decision: menus close instantly).
- Do NOT touch the header menus or `globals.css`.
- Do NOT convert this to framer-motion.
- If the file drifted from the excerpt, STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npm run lint` — must pass (no type impact).
- **Feel check**:
  - On `/workspace`, open the org selector (top-right of the header card). The panel scales in from its top-right corner over ~200ms — same feel as the header's org switcher.
  - Open it rapidly 5× — no jank, no layout shift (the panel is `absolute`, so it never reflows the page).
- **Done when**: all three dropdowns in the app share the same entrance treatment.
