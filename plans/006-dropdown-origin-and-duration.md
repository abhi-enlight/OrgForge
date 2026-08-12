# 006 — Anchor dropdown scale to the trigger and tighten its duration

- **Status**: DONE (2026-08-12 — lint pass; entrance behavior verified by construction, live feel-check auth-gated per plan)
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 2 files (globals.css + Header.tsx), class-string/one-value edits

## Problem

The header's org switcher and avatar menus scale in from **center** (`transform-origin` defaults to `50% 50%`), even though both are trigger-anchored menus pinned to the top-right corner of their buttons:

```tsx
// frontend/src/components/layout/Header.tsx:134 — org menu
<div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white border border-brand-border shadow-lift p-1.5 z-50 animate-scale-in">
```

```tsx
// frontend/src/components/layout/Header.tsx:185 — avatar menu
<div className="absolute right-0 mt-2 w-60 rounded-2xl bg-white border border-brand-border shadow-lift p-1.5 z-50 animate-scale-in">
```

```css
/* frontend/src/app/globals.css:119-122 — the entrance */
.animate-scale-in {
  animation: scaleIn 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
```

Two issues: (1) popovers must scale **from their trigger**, not center (playbook rule — only modals are exempt from the origin rule); (2) `0.3s` is over the 150–250ms dropdown budget, and these menus are opened dozens of times a day.

The entrance itself is a documented decision (`DESIGN.md:110` — "`animate-scale-in` (menus/dropdowns)") — do not remove it, just anchor and tighten it.

## Target

```tsx
// Header.tsx:134 — add origin-top-right (Tailwind's transform-origin: top right)
<div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white border border-brand-border shadow-lift p-1.5 z-50 animate-scale-in origin-top-right">
```

```tsx
// Header.tsx:185 — same
<div className="absolute right-0 mt-2 w-60 rounded-2xl bg-white border border-brand-border shadow-lift p-1.5 z-50 animate-scale-in origin-top-right">
```

```css
/* globals.css — tighten the entrance to the dropdown budget (200ms) */
.animate-scale-in {
  animation: scaleIn 0.2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
```

The menu now grows from its own top-right corner — visually "from the button" — and snaps in at 200ms instead of a sluggish 300ms.

Deliberately **out of scope**: an exit animation for these menus. They close on outside-click and selection; the fast-tool convention (Raycast, etc.) is instant close, and adding `AnimatePresence` would require restructuring `Header`'s conditional rendering for little feel gain.

## Repo conventions to follow

- `origin-*` Tailwind utilities are already used in this codebase (`Modal.tsx`'s panel scales from center — correct, modals are exempt; `Header.tsx:101` uses `group-hover:scale-[1.02]` with transform utilities).
- The `--ease-spring` curve (`cubic-bezier(0.22, 1, 0.36, 1)`) is the app's CSS motion token — keep using it.

## Steps

1. `globals.css` — change `scaleIn 0.3s` to `scaleIn 0.2s` in the `.animate-scale-in` rule.
2. `Header.tsx:134` — append `origin-top-right` to the org menu's className.
3. `Header.tsx:185` — append `origin-top-right` to the avatar menu's className.
4. Confirm `animate-scale-in` is only used by these two menus (grep — `DESIGN.md` is docs only).

## Boundaries

- Do NOT add exit animations or `AnimatePresence` to `Header.tsx`.
- Do NOT change the `scaleIn` keyframes (0.96 → 1) or the curve.
- Do NOT touch the org/avatar button styling, the org pill, or menu contents.
- Do NOT touch `OrgSelector.tsx` (covered by plan 009).
- If the file drifted from the excerpts, STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npm run lint` — must pass (no type impact).
- **Feel check**:
  - Open the org switcher. The menu must **grow from its top-right corner** (toward the button), not from its center.
  - Same for the avatar menu.
  - Watch in DevTools → Animations at 10% playback: the scale should trace from the top-right origin and complete in ~200ms.
- **Done when**: both menus scale from the trigger corner and feel snappier (200ms), with no other visual change.
