# 001 — Give toasts a real entrance and exit

- **Status**: DONE (2026-08-12 — typecheck + lint pass, code review clean; live feel-check pending a real session, see Verification)
- **Commit**: n/a (project is not a git repository at stamp time; stamp with `git rev-parse --short HEAD` if a repo appears)
- **Severity**: HIGH
- **Category**: Craft / interruptibility (animation exists by intent but is broken)
- **Estimated scope**: 1 file (~20 lines)

## Problem

`frontend/src/components/providers/ToastProvider.tsx:85` applies the class `animate-slide-in` to every toast, but **that class does not exist** — `globals.css` defines only `fadeIn`, `slideUp`, and `scaleIn` keyframes (a repo-wide search for `slide-in`/`slideIn` returns this one usage and nothing defining it). The Tailwind class silently compiles to nothing, so toasts **teleport in with zero animation**.

Worse, dismissal is a plain state filter:

```tsx
// frontend/src/components/providers/ToastProvider.tsx:84-104 — current
{toasts.map((t) => (
  <div
    key={t.id}
    role="alert"
    className={`pointer-events-auto flex items-start gap-3 bg-white border ${BORDER[t.type]} rounded-xl shadow-lg p-4 animate-slide-in`}
  >
```

```tsx
// frontend/src/components/providers/ToastProvider.tsx:31-33 — current
dismiss = useCallback((id: string) => {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}, []);
```

So toasts also **vanish instantly with no exit**. Toasts are an "occasional" frequency element that deserves a standard enter/exit — the app's entire motion system is otherwise deliberate ("calm command center"), and this abrupt pop-in is the one feel-breaking spot.

## Target

Switch to framer-motion `AnimatePresence` (already used across the app: `Modal.tsx`, `LivePipeline.tsx`) with a springy ease-out entrance and a fade+slide exit. Toasts stack with `layout` so pushing/dismissing one re-flows the others smoothly instead of snapping.

```tsx
// target — ToastProvider.tsx, replace the map block
<AnimatePresence initial={false}>
  {toasts.map((t) => (
    <motion.div
      key={t.id}
      layout
      role="alert"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={`pointer-events-auto flex items-start gap-3 bg-white border ${BORDER[t.type]} rounded-xl shadow-lg p-4`}
    >
```

Close with `</motion.div>` instead of `</div>`. **Remove `animate-slide-in` from the className.**

Values are pinned to the app's existing modal curve (`Modal.tsx:50` uses `[0.22, 1, 0.36, 1]`) and to the AUDIT duration budget for toasts/popovers (125–250ms → 250ms). Exit is deliberately faster-feeling (fade + slight rise, 0.25s same curve).

## Repo conventions to follow

- Framer-motion `AnimatePresence` + `motion.*` is the established pattern — see `frontend/src/components/ui/Modal.tsx:43-73` (backdrop + panel enter/exit) and `frontend/src/components/landing/LivePipeline.tsx:168-280` (`mode="wait"` phase swaps).
- All motion is transform/opacity only (the app's rule — see `LivePipeline.tsx` header comment) — this target obeys it.
- Shared ease token: if plan **005** has already landed, import `EASE_OUT` from `@/lib/motion` and use `ease: EASE_OUT` instead of the inline array. If 005 has NOT landed, inline `[0.22, 1, 0.36, 1]` as shown.

## Steps

1. Add the import at the top of `frontend/src/components/providers/ToastProvider.tsx` (after the existing `react` import):
   ```tsx
   import { AnimatePresence, motion } from 'framer-motion';
   ```
   (Optionally `import { EASE_OUT } from '@/lib/motion';` if plan 005 landed first.)
2. Wrap the toast map in `<AnimatePresence initial={false}>` and convert the toast `<div>` to `<motion.div>` with the `initial`/`animate`/`exit`/`transition` props from the Target block. `layout` on each toast lets siblings animate when one leaves.
3. Delete `animate-slide-in` from the className string (and the now-orphaned `rounded-xl shadow-lg` stays — only the animation class goes).
4. Do NOT touch the push/dismiss logic, timers, `aria-live`, `role="alert"`, or the "Dismiss all" button.

## Boundaries

- Do NOT add a `slideIn` keyframe to `globals.css` as an alternative — CSS can't animate exit for elements removed from the DOM; the framer-motion path is the correct one and matches the codebase.
- Do NOT change toast content, layout classes, colors, or the auto-dismiss durations (6s / 10s).
- Do NOT modify `ToastProvider`'s push/dismiss functions.
- If the file has drifted from the excerpts above, STOP and report rather than improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npm run typecheck` and `npm run lint` — both must pass with no new errors.
- **Feel check**:
  - Trigger any toast (e.g. the workspace's "Gate Cleared" success after unblocking REF-04/06/07, or an org-switch). Confirm it **slides in + fades from slightly below/right scale 0.98**, not a hard pop.
  - Dismiss it (or let it auto-dismiss). Confirm it **fades out and slides up ~8px** instead of vanishing.
  - Push 3 toasts quickly. Confirm existing toasts **slide up smoothly** (the `layout` re-flow) rather than snapping.
  - In DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`: toasts should fade in/out with **no y/scale movement** (this lands via plan 003's global `MotionConfig reducedMotion="user"`; if 003 hasn't landed yet, confirm at least that nothing here is broken under reduce).
- **Done when**: toasts visibly animate in and out, siblings re-flow smoothly, and no `animate-slide-in` reference remains in `frontend/src`.
