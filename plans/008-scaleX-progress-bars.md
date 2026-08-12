# 008 — Animate LivePipeline progress bars with scaleX, not width

- **Status**: DONE (2026-08-12 — typecheck + lint pass, browser pipeline loop verified, code review clean)
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: MEDIUM
- **Category**: Performance (layout animation in a 60ms-tick loop)
- **Estimated scope**: 1 file (LivePipeline.tsx), 2 blocks

## Problem

The landing hero's looping pipeline demo animates progress bars via `width`, which triggers **layout + paint** on every frame — inside a component that re-renders every 60ms (its `setInterval` tick). Per the playbook, animate `transform`/`opacity` only.

```tsx
// frontend/src/components/landing/LivePipeline.tsx:227-233 — step progress bar
<span className="h-1 w-16 overflow-hidden rounded-full bg-brand-border">
  <motion.span
    className="block h-full rounded-full bg-brand-blue"
    initial={{ width: 0 }}
    animate={{
      width: done ? '100%' : isCurrent ? '55%' : '0%',
    }}
    transition={{ duration: 0.4, ease: 'easeOut' }}
  />
</span>
```

```tsx
// frontend/src/components/landing/LivePipeline.tsx:271-278 — signed-record bars
<motion.div
  className="h-full rounded-full bg-brand-pass"
  initial={{ width: 0 }}
  animate={{ width: '100%' }}
  transition={{ duration: 0.5, delay: i * 0.08 }}
/>
```

## Target

Scale the fill horizontally from the left (`transform-origin: left`) inside the same `overflow-hidden` track — identical look, compositor-only:

```tsx
// target — step progress bar
<span className="h-1 w-16 overflow-hidden rounded-full bg-brand-border">
  <motion.span
    className="block h-full origin-left rounded-full bg-brand-blue"
    initial={{ scaleX: 0 }}
    animate={{
      scaleX: done ? 1 : isCurrent ? 0.55 : 0,
    }}
    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
  />
</span>
```

```tsx
// target — signed-record bars
<motion.div
  className="h-full origin-left rounded-full bg-brand-pass"
  initial={{ scaleX: 0 }}
  animate={{ scaleX: 1 }}
  transition={{ duration: 0.5, delay: i * 0.08 }}
/>
```

Value mapping is preserved exactly: `100% → 1`, `55% → 0.55`, `0% → 0`. Durations and the 80ms stagger stay. The ease swaps framer's `'easeOut'` / default for the app's `[0.22, 1, 0.36, 1]` (if plan 005 has landed, use `EASE_OUT` from `@/lib/motion`).

## Repo conventions to follow

- Transform/opacity-only motion is the documented rule for this exact component ("All motion is transform/opacity only" — `LivePipeline.tsx:25-27` header comment).
- `origin-left` matches how the app uses transform-origin elsewhere (`Modal.tsx` scales from center for modals; Header dropdowns use `origin-top-right` per plan 006).

## Steps

1. In the step progress bar block: add `origin-left` to the `motion.span` className, change `initial={{ width: 0 }}` → `initial={{ scaleX: 0 }}`, change the `animate` object to the `scaleX` values, and set the ease to the app curve.
2. In the signed-record bars block: add `origin-left`, swap `width` → `scaleX` with the same mapping.
3. Confirm both parents still have `overflow-hidden` (they do — `h-1 w-16 overflow-hidden rounded-full` and `h-1 flex-1 overflow-hidden rounded-full`), which is what clips the scaled fill.
4. If plan 005 landed, import and use `EASE_OUT`; otherwise inline the curve.

## Boundaries

- Do NOT change the phase timing, durations, delays, or the 60ms tick loop.
- Do NOT touch the `motion.li`/`motion.div` phase containers or any other animation in this file.
- Do NOT change the visual size of the tracks or fills.
- If the file drifted from the excerpts, STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npm run typecheck` and `npm run lint` — must pass.
- **Feel check**:
  - Scroll the hero into view; the "GATES" phase step bars and the signed-record bars fill **left to right at the same speed and amount** as before.
  - DevTools → Performance while the pipeline loops: no Layout rows on the bar fills (composite only).
  - Toggle `prefers-reduced-motion: reduce` — the pipeline collapses to the static signed frame as before (unchanged behavior).
- **Done when**: bars fill identically to before, measured with zero layout work.
