# 010 — Fade the mobile sidebar backdrop instead of popping it

- **Status**: DONE
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: LOW
- **Category**: Missed opportunity (spatially-connected UI polish)
- **Estimated scope**: 1 file, 1 block

## Problem

On mobile, the navigation drawer's backdrop appears **instantly** (hard pop) while the panel slides in — the two layers feel disconnected. The drawer panel itself transitions smoothly (`transition-[transform,visibility] duration-300`), but the scrim doesn't.

```tsx
// frontend/src/components/layout/Sidebar.tsx:41-46 — current
{isOpen && (
  <div
    className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden"
    onClick={onClose}
    aria-hidden="true"
  />
)}
```

## Target

Always render the backdrop and cross-fade it with opacity + visibility (mirroring the drawer's `transition-[transform,visibility]` pattern), gated for reduced motion:

```tsx
// target — replace the conditional block
<div
  aria-hidden="true"
  onClick={onClose}
  className={cn(
    'fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden',
    'transition-[opacity,visibility] duration-200 ease-out',
    'motion-reduce:transition-none',
    isOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
  )}
/>
```

`invisible` (visibility: hidden) also stops the closed backdrop from capturing clicks — same guarantee the conditional render gave. `cn` is already imported in `Sidebar.tsx`. The `motion-reduce:transition-none` makes the scrim snap under reduced motion, consistent with plan 003's drawer handling.

## Repo conventions to follow

- The `transition-[opacity,visibility]` + `visible`/`invisible` pattern is exactly what the drawer panel already uses in this same file (`Sidebar.tsx:47`: `'transform transition-[transform,visibility] duration-300 ease-out', isOpen ? 'translate-x-0 visible' : '-translate-x-full invisible'`).
- `motion-reduce:` Tailwind v4 variant, per plan 003.

## Steps

1. Replace the `{isOpen && (<div … />)}` block in `Sidebar.tsx` with the always-rendered, conditional-opacity `div` from the Target.
2. Confirm `cn` is imported (it is — `import { cn } from '@/lib/utils';` at the top of the file).
3. Leave the drawer panel, nav items, and close-button behavior untouched.

## Boundaries

- Do NOT change the drawer panel's slide (300ms `ease-out`) — only the backdrop.
- Do NOT change the overlay color/blur (`bg-slate-900/40 backdrop-blur-sm`).
- Do NOT touch the desktop (`md:hidden`) behavior — on md+ the backdrop is still display:none.
- If the file drifted from the excerpt, STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npm run typecheck` and `npm run lint` — must pass.
- **Feel check** (DevTools mobile emulation, <768px):
  - Open the nav drawer — the backdrop **fades in over ~200ms in sync with the panel slide**; close it — it fades out.
  - Confirm the closed backdrop never blocks clicks on the page behind it.
  - Emulate `prefers-reduced-motion: reduce` — drawer and backdrop both appear instantly, no slide/fade.
- **Done when**: backdrop fades in/out with the drawer and never intercepts clicks when closed.
