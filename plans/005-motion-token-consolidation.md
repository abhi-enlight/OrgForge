# 005 — Consolidate motion easing into one shared token module

- **Status**: DONE (2026-08-12 — typecheck + lint pass, no inline beziers remain, browser reveal check passed, code review clean)
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 new file + 9 edited files (mechanical token swaps)

## Problem

Two near-identical "springy ease-out" cubic-beziers are hand-typed across the app, plus a third implicit default:

- `[0.16, 1, 0.3, 1]` (scroll reveals / list entrances) in `Reveal.tsx:65-69`, `StageTimeline.tsx:74-80`, and `workspace/page.tsx` (`const EASE = [0.16, 1, 0.3, 1] as const;`).
- `[0.22, 1, 0.36, 1]` (modals, cards, popovers — the JS twin of the CSS `--ease-spring` token) in `Modal.tsx:50`, `PackageInstallModal.tsx:58`, `RefusalGateCard.tsx:28-30`, `ErrorBanner.tsx:82`, `Card.tsx:31`.
- Framer-motion's **default** ease (silent third curve) in `UnblockActionModal.tsx:92-96` — `transition={{ duration: 0.2 }}` with no ease at all.

The CSS token already exists — `globals.css` `--ease-spring: cubic-bezier(0.22, 1, 0.36, 1)` — but framer-motion can't consume CSS variables, so JS re-types it. This is the playbook's "five hand-typed cubic-beziers that almost match is a consolidation finding" exactly.

## Target

```ts
// NEW FILE: frontend/src/lib/motion.ts
/**
 * Forge motion tokens — the JS twin of the CSS motion tokens in
 * globals.css (@theme --ease-spring). Framer-motion cannot consume CSS
 * variables, so these live here as the single source of truth. Never
 * hand-type a bezier in a component.
 */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
/** Entering/exiting UI: modals, toasts, popovers, cards. Matches --ease-spring. */
export const EASE_REVEAL: [number, number, number, number] = [0.16, 1, 0.3, 1];
/** Scroll reveals and list entrances (Reveal, StageTimeline, workspace stage swaps). */
```

Type note: declare as mutable `[number, number, number, number]` (not `as const`) — framer-motion's `Easing` type expects a mutable tuple and `as const` readonly tuples can fail the assignment in some versions.

Per-file swaps (replace the inline array with the named constant; add `import { EASE_OUT } from '@/lib/motion';` etc. as needed):

| File | Current | Replace with |
|---|---|---|
| `frontend/src/components/ui/Modal.tsx:50` | `ease: [0.22, 1, 0.36, 1]` | `ease: EASE_OUT` |
| `frontend/src/components/org/PackageInstallModal.tsx:58` | `ease: [0.22, 1, 0.36, 1]` | `ease: EASE_OUT` |
| `frontend/src/components/gates/RefusalGateCard.tsx:28` | `ease: [0.22, 1, 0.36, 1]` | `ease: EASE_OUT` |
| `frontend/src/components/ui/ErrorBanner.tsx:82` | `ease: [0.22, 1, 0.36, 1]` | `ease: EASE_OUT` |
| `frontend/src/components/ui/Card.tsx:31` | `ease: [0.22, 1, 0.36, 1]` | `ease: EASE_OUT` |
| `frontend/src/components/gates/UnblockActionModal.tsx:92` | `transition={{ duration: 0.2 }}` (default ease — the bug) | `transition={{ duration: 0.2, ease: EASE_OUT }}` |
| `frontend/src/components/landing/Reveal.tsx:65` | `ease: [0.16, 1, 0.3, 1]` | `ease: EASE_REVEAL` |
| `frontend/src/components/workspace/StageTimeline.tsx:74` | `ease: [0.16, 1, 0.3, 1]` | `ease: EASE_REVEAL` |
| `frontend/src/app/(app)/workspace/page.tsx` | `const EASE = [0.16, 1, 0.3, 1] as const;` | `const EASE = EASE_REVEAL;` (delete the local const, import instead) |

If plan **001** has landed, `ToastProvider.tsx`'s toast transition should also use `EASE_OUT` (it already matches the value).

## Repo conventions to follow

- Shared UI constants already live in `frontend/src/lib/` (`utils.ts`, `orgHealth.ts`) — `motion.ts` follows that convention.
- The CSS side already centralizes the curve as `--ease-spring` in `globals.css` `@theme` — this plan mirrors that single-source approach for JS.
- Existing component import style: `import { cn } from '@/lib/utils';` — use the same `@/lib/motion` path alias.

## Steps

1. Create `frontend/src/lib/motion.ts` exactly as in the Target.
2. Swap the five `[0.22, 1, 0.36, 1]` usages to `EASE_OUT` (Modal, PackageInstallModal, RefusalGateCard, ErrorBanner, Card), adding imports.
3. Fix `UnblockActionModal.tsx` to pass `ease: EASE_OUT` (this removes the silent default-ease third curve).
4. Swap the three `[0.16, 1, 0.3, 1]` usages to `EASE_REVEAL` (Reveal, StageTimeline, workspace/page.tsx — deleting the local `EASE` const there).
5. If `ToastProvider.tsx` uses a `[0.22, 1, 0.36, 1]` transition (plan 001 landed), point it at `EASE_OUT`.
6. Grep `frontend/src` for `cubic-bezier|\[0\.(16|22), 1, 0\.(3|36), 1\]` to confirm no hand-typed curve remains.

## Boundaries

- Do NOT change durations, delays, springs, or any motion value other than `ease`.
- Do NOT touch `LivePipeline.tsx` (its `spring` config is intentional) or `globals.css`.
- Do NOT rename or delete the CSS `--ease-spring` token.
- Do NOT unify the two curves into one — `EASE_OUT` (enter/exit UI) and `EASE_REVEAL` (scroll reveals) are distinct named intents; the finding is the duplication, not the existence of two curves.
- If a file drifted from the excerpts, STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npm run typecheck` (catches the tuple-type note above) and `npm run lint` — both must pass.
- **Feel check**:
  - Open and close a modal — identical feel to before (this is a pure refactor; any perceived change means a value was mistyped).
  - Scroll the landing page — reveals feel identical.
  - Slow-motion in DevTools (Animations panel at 10%): the modal curve and the reveal curve should trace the same shapes they did before.
- **Done when**: `npm run typecheck` passes and a grep for hand-typed beziers in `frontend/src` returns only `globals.css` tokens and `lib/motion.ts`.
