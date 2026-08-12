# 002 — Scope `transition-all` to the properties that actually change

- **Status**: DONE (2026-08-12 — typecheck + lint pass, browser feel-check passed, code review clean after one fix)
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: MEDIUM
- **Category**: Performance (animating off-GPU properties)
- **Estimated scope**: 4 required files + 2 optional files, class-string-only edits

## Problem

Multiple hover cards use Tailwind's `transition-all`, which registers every animatable property for transition — including layout and paint-bound ones — instead of just the properties that change on hover (box-shadow, border-color, transform). `transition: all` is an always-finding per the playbook: it animates unintended properties off-GPU.

Locations (all current code verbatim):

```tsx
// frontend/src/components/landing/FeatureBento.tsx:59 (also :107, :131, :147, :164, :193 — same token)
<article className="flex h-full flex-col rounded-2xl border border-brand-border bg-white p-7 transition-all duration-300 hover:shadow-lift sm:p-8">
```

```tsx
// frontend/src/components/landing/Capabilities.tsx:54 — dark hero cell, hover changes shadow only
<article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-brand-dark bg-brand-dark p-7 transition-all duration-300 hover:shadow-lift sm:p-9">
```

```tsx
// frontend/src/components/landing/Capabilities.tsx:92 — right column, hover changes border + shadow
<article className="group mt-6 flex h-full flex-col rounded-2xl border border-brand-border bg-white p-7 shadow-soft transition-all duration-300 hover:border-brand-blue/30 hover:shadow-lift sm:p-8 lg:mt-0">
```

```tsx
// frontend/src/components/chat/StarterCards.tsx:58 — chat empty state, hover changes transform + shadow + border
className="p-4 bg-white rounded-2xl border border-brand-border shadow-sm hover:border-brand-blue/50 hover:shadow-md hover:-translate-y-0.5 transition-all group cursor-pointer"
```

```tsx
// frontend/src/app/(app)/agents/page.tsx:117 — agent card, hover changes border + shadow
className="group rounded-2xl border border-brand-border bg-white p-5 shadow-soft hover:shadow-card-hover hover:border-brand-blue/30 transition-all duration-200 cursor-pointer"
```

## Target

Each card transitions **only the properties its hover state changes**:

- **Hover changes shadow only** → `transition-shadow` (keeps `duration-300` — marketing card hover is allowed to be longer per the AUDIT "marketing can be longer" rule).
- **Hover changes border-color + shadow** → `transition-[box-shadow,border-color]`.
- **Hover changes transform + shadow + border** → `transition-[transform,box-shadow,border-color]`.

Exact replacements:

| File | Find | Replace |
|---|---|---|
| `FeatureBento.tsx` (×6: lines 59, 107, 131, 147, 164, 193) | `transition-all duration-300 hover:shadow-lift` | `transition-shadow duration-300 hover:shadow-lift` |
| `Capabilities.tsx:54` | `transition-all duration-300 hover:shadow-lift` | `transition-shadow duration-300 hover:shadow-lift` |
| `Capabilities.tsx:92` | `transition-all duration-300 hover:border-brand-blue/30 hover:shadow-lift` | `transition-[box-shadow,border-color] duration-300 hover:border-brand-blue/30 hover:shadow-lift` |
| `StarterCards.tsx:58` | `transition-all group` | `transition-[transform,box-shadow,border-color] group` |
| `agents/page.tsx` (agent card) | `transition-all duration-200` | `transition-[box-shadow,border-color] duration-200` |

Optional follow-up (same pattern, colors-only hovers — include if trivial):
- `frontend/src/components/layout/Header.tsx` — nav links and org pill use `transition-all duration-200` but only animate colors → `transition-colors duration-200`.
- `frontend/src/components/layout/Sidebar.tsx:80` — nav links `transition-all duration-200` → `transition-colors duration-200`.

## Repo conventions to follow

- The app already scopes transitions correctly in places — e.g. `Sidebar.tsx:47` uses `transition-[transform,visibility]` and `RefusalGateCard.tsx:28` uses `transition-colors duration-200`. Imitate those.
- Arbitrary property lists `transition-[a,b]` are Tailwind v4 syntax and already used in this codebase (`Sidebar.tsx:47`).
- Do not change durations: `duration-300` on landing cards and `duration-200` on app cards are intentional and within budget.

## Steps

1. `FeatureBento.tsx` — replace all six occurrences of `transition-all duration-300 hover:shadow-lift` with `transition-shadow duration-300 hover:shadow-lift`.
2. `Capabilities.tsx` — two replacements as in the table.
3. `StarterCards.tsx` — one replacement.
4. `agents/page.tsx` — one replacement (the agent card in the grid, not the skeleton cards).
5. Optional: `Header.tsx` and `Sidebar.tsx` nav-link/org-pill `transition-all duration-200` → `transition-colors duration-200`.
6. Confirm no `transition-all` remains in these files except where a component genuinely changes many properties.

## Boundaries

- Do NOT touch any other class or markup in these files — class-string edits only.
- Do NOT change `hover:shadow-lift`, `hover:-translate-y-0.5`, `hover:shadow-md`, `hover:border-*` — only the transition property lists.
- Do NOT touch `globals.css`, `TransitionProvider`-style code, or any framer-motion usage.
- `transition-all` elsewhere in the codebase (e.g. `AmbiguityCard.tsx`, `StageTimeline.tsx` buttons, `PackageHealthChip.tsx`) is out of scope for this plan; if encountered, leave it and mention in the report.
- If a file has drifted from the excerpts above, STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npm run typecheck` and `npm run lint` — must pass (class-string changes cannot break types, but lint must stay clean).
- **Feel check**:
  - Hover the bento cards on the landing page. The shadow-lift must still animate smoothly, and nothing else (no color/layout flash) may move.
  - Hover a StarterCard in the chat empty state — the lift + shadow + border change must still animate at the same speed.
  - Hover an agent card on `/agents` — border + shadow still transition.
  - In DevTools → Performance → record a quick hover sweep over the bento grid; there should be **no Layout/Paint rows for the card itself** (only composite).
- **Done when**: all six FeatureBento cards, both Capabilities cards, StarterCards, and the agents card transition only their hovered properties, and a performance recording shows no layout work on hover.
