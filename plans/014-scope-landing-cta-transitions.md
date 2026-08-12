# 014 — Scope the landing CTA `transition-all`

- **Status**: TODO
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: LOW
- **Category**: Performance (animating off-GPU properties)
- **Estimated scope**: 3 files, 3 class-string edits

## Problem

The three landing-page primary CTAs — the highest-visibility buttons on the marketing site — still carry Tailwind's `transition-all`. Plan 012 scoped the app primitives, plan 013 covers the app surfaces; these are the last `transition-all` tokens in `frontend/src`. LOW severity because they're marketing-frequency, but the pattern is now inconsistent with the rest of the codebase (plan 002/012/013 all use scoped transition lists).

All current code verbatim:

```tsx
// frontend/src/components/landing/Hero.tsx:82 — current
<Link
  href="/login"
  className="group inline-flex items-center gap-2 rounded-full bg-brand-blue px-7 py-3.5 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:bg-brand-blue-hover hover:shadow-lift active:scale-[0.98]"
>
```

```tsx
// frontend/src/components/landing/Nav.tsx:61 — current
<Link
  href="/login"
  className="rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:bg-brand-blue-hover hover:shadow-lift active:scale-[0.98]"
>
```

```tsx
// frontend/src/components/landing/CtaSection.tsx:64 — current
<Link
  href="/login"
  className="group inline-flex items-center gap-2 rounded-full bg-brand-blue px-8 py-4 text-sm font-semibold text-white shadow-glow transition-all duration-200 hover:bg-brand-blue-hover hover:shadow-glow-lg active:scale-[0.98]"
>
```

Each CTA's state changes animate exactly three properties: `background-color` (`hover:bg-brand-blue-hover`), `box-shadow` (`hover:shadow-lift` / `hover:shadow-glow-lg`), and `transform` (`active:scale-[0.98]`).

## Target

Replace only the `transition-all` token with the scoped list; keep every other class byte-identical:

| File:line | Find | Replace |
|---|---|---|
| `Hero.tsx:82` | `transition-all duration-200` | `transition-[background-color,box-shadow,transform] duration-200` |
| `Nav.tsx:61` | `transition-all duration-200` | `transition-[background-color,box-shadow,transform] duration-200` |
| `CtaSection.tsx:64` | `transition-all duration-200` | `transition-[background-color,box-shadow,transform] duration-200` |

## Repo conventions to follow

- The scoped-transition convention is established: plan 012 uses `transition-[background-color,color,border-color,box-shadow,transform]` on `Button.tsx`; the Hero secondary button already uses `transition-colors duration-200` (`Hero.tsx:90`); the in-CTA arrows already use `transition-transform duration-200 group-hover:translate-x-0.5` (`Hero.tsx:86`, `CtaSection.tsx:68`). Imitate those.
- Keep `duration-200` — the AUDIT's "marketing can be longer" allowance applies and 200ms is already set; do not change it.

## Steps

1. `Hero.tsx:82` — replace `transition-all duration-200` with `transition-[background-color,box-shadow,transform] duration-200`.
2. `Nav.tsx:61` — the same replacement.
3. `CtaSection.tsx:64` — the same replacement.
4. Confirm `grep -rn 'transition-all' src --include='*.tsx' --include='*.ts'` returns **zero** matches across `frontend/src` — this is the last batch.

## Boundaries

- Do NOT touch the hover classes (`hover:bg-*`, `hover:shadow-*`), durations, `active:scale-[0.98]`, the arrow transitions, or any other class.
- Do NOT touch `Reveal`, `LivePipeline`, `AmbientShape`, `IsometricGrid`, or any framer-motion code in these files (Hero uses `useScroll`/`useTransform` — leave it).
- Class-string edits only.
- If a file drifted from the excerpts above, STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npx tsc --noEmit` and `npx eslint src/components/landing/Hero.tsx src/components/landing/Nav.tsx src/components/landing/CtaSection.tsx` — both clean. Then `grep -rn 'transition-all' src --include='*.tsx'` — must print nothing.
- **Feel check** (the landing page is public — verifiable without auth):
  - Hover the hero "Open Forge" CTA: bg shifts to the hover blue and the shadow lifts at the same speed as before; the arrow slides right. Nothing else animates.
  - Hover the nav "Sign in" button: same behavior.
  - Scroll to the dark CTA section, hover "Open Forge": bg + glow-lg shadow transition; press → `scale(0.98)` still snaps in.
  - In DevTools → Performance, record a hover sweep over the hero CTA: **no Layout rows** for the button.
- **Done when**: the grep shows zero `transition-all` in `frontend/src` and all three CTAs behave identically to before.
