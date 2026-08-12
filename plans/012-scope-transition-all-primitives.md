# 012 — Scope `transition-all` in the core UI primitives

- **Status**: DONE (2026-08-12 — typecheck + lint pass, grep shows zero `transition-all` in `components/ui`, code review clean)
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: MEDIUM
- **Category**: Performance (animating off-GPU properties)
- **Estimated scope**: 4 files, class-string-only edits

## Problem

The four shared UI primitives — used by every screen in the app — still carry Tailwind's `transition-all`, which registers every animatable property (including layout/paint-bound ones) instead of only the properties that actually change. These are the highest-frequency elements in the codebase, so the (small) cost of an off-GPU transition registration repeats constantly. Plan 002 scoped the landing cards and app cards but did not touch the primitives.

```tsx
// frontend/src/components/ui/Button.tsx:29 — current
const baseStyles = 'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-4 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none';
```

```tsx
// frontend/src/components/ui/Card.tsx:28 — current
interactive: 'bg-white border border-brand-border hover:border-brand-blue hover:shadow-card-hover transition-all duration-300 rounded-2xl cursor-pointer',
```

```tsx
// frontend/src/components/ui/Input.tsx:32 — current
'w-full bg-white text-brand-dark text-sm rounded-xl py-3 px-4 border border-brand-border placeholder:text-slate-400 transition-all duration-200 focus:outline-none focus:border-brand-blue focus:ring-4 focus:ring-brand-blue/15 disabled:bg-brand-surface disabled:cursor-not-allowed',
```

```tsx
// frontend/src/components/ui/Badge.tsx:45 — current
'inline-flex items-center gap-1.5 font-semibold rounded-full border border-solid backdrop-blur-sm transition-all duration-200',
```

## Target

Each primitive transitions **only the properties its state changes actually animate**:

| File:line | Find | Replace |
|---|---|---|
| `Button.tsx:29` | `transition-all duration-200` | `transition-[background-color,color,border-color,box-shadow,transform] duration-200` |
| `Card.tsx:28` | `transition-all duration-300` | `transition-[box-shadow,border-color] duration-300` |
| `Input.tsx:32` | `transition-all duration-200` | `transition-[border-color,box-shadow] duration-200` |
| `Badge.tsx:45` | `transition-all duration-200` | *(remove the transition classes entirely)* |

Why each list:

- **Button** — variants change `background-color` on hover (every variant), `color` + `border-color` (outline, ghost), `box-shadow` (focus ring, variant shadows), and `transform` (`active:scale-[0.98]` + framer's `whileHover`/`whileTap`).
- **Card (interactive)** — hover changes `border-color` + `box-shadow` only; the `y: -3` lift is framer-driven with its own transition.
- **Input** — focus changes `border-color` + `box-shadow` (the `ring-4`). Nothing else animates.
- **Badge** — has **no hover, focus, or state-change classes at all**: the variant is fixed per render and the dot never moves. `transition-all` here is dead weight that can never fire — delete the animation (playbook: purpose & frequency — the strongest fix is often removing it).

## Repo conventions to follow

- Arbitrary property lists are the established convention — `Sidebar.tsx:47` uses `transition-[transform,visibility]`; plan 002 set `transition-[box-shadow,border-color]` on the agents card (`agents/page.tsx`) and `transition-shadow` on the AmbiguityCard textarea. Imitate those.
- Do NOT change durations (`duration-200`, `duration-300` stay) and do NOT touch the framer-motion props (`whileHover`/`whileTap`, `motion.button`/`motion.div`).

## Steps

1. `Button.tsx:29` — replace `transition-all duration-200` with `transition-[background-color,color,border-color,box-shadow,transform] duration-200` (inside `baseStyles`).
2. `Card.tsx:28` — replace `transition-all duration-300` with `transition-[box-shadow,border-color] duration-300` (inside the `interactive` variant).
3. `Input.tsx:32` — replace `transition-all duration-200` with `transition-[border-color,box-shadow] duration-200`.
4. `Badge.tsx:45` — delete `transition-all duration-200` from the base class string (keep `backdrop-blur-sm` and everything else).
5. Confirm `transition-all` no longer appears in any of the four files.

## Boundaries

- Do NOT touch markup, props, or any class other than the transition-property token in the four strings above.
- Do NOT touch `globals.css`, `lib/motion.ts`, or any other component.
- Do NOT add a transition to Badge as a "replacement" — the correct fix is removing it.
- If any file drifted from the excerpts, STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npx tsc --noEmit` and `npx eslint src/components/ui/Button.tsx src/components/ui/Card.tsx src/components/ui/Input.tsx src/components/ui/Badge.tsx` — both must pass. Then `grep -rn 'transition-all' src/components/ui` — must return **zero** matches.
- **Feel check**:
  - Hover a Button (primary + outline): bg/color/shadow/scale all still transition at the same speed; nothing jumps.
  - Hover an interactive Card: border + shadow still ease in; the framer `y: -3` lift is unchanged.
  - Focus an Input: border + ring still animate smoothly.
  - In DevTools → Performance, record a quick hover sweep over a button: **no Layout rows** for the button.
- **Done when**: all four primitives transition only their changing properties, `grep` shows zero `transition-all` in `components/ui`, and every hover/focus still animates identically.
