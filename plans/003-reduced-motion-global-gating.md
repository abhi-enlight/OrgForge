# 003 — Close the app-wide reduced-motion gaps

- **Status**: DONE (2026-08-12 — typecheck + lint pass, browser no-op check passed, code review clean)
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: MEDIUM
- **Category**: Accessibility (movement not gated under `prefers-reduced-motion`)
- **Estimated scope**: 3 files (1 new provider, 2 edits)

## Problem

The landing page gates its framer-motion work with `useReducedMotion()` in `Reveal`, `Hero`, `LivePipeline`, `HowItWorks`, and the workspace/agents pages gate themselves — but the **shared app primitives and modals do not**:

- `frontend/src/components/ui/Button.tsx:47-49` — `whileHover={{ y: -1 }}` and `whileTap={{ scale: 0.98 }}` on every button, no gate.
- `frontend/src/components/ui/Card.tsx:31` — `whileHover={isHoverable ? { y: -3, ... } : undefined}`, no gate.
- `frontend/src/components/ui/Modal.tsx:50-58`, `frontend/src/components/org/PackageInstallModal.tsx:51-62`, `frontend/src/components/gates/UnblockActionModal.tsx:92-96` — panel entrances animate `scale` + `y` under reduced motion.
- `frontend/src/components/layout/Sidebar.tsx:47` — the mobile drawer slides via CSS `transition-[transform,visibility] duration-300`, no reduced-motion handling.
- Tailwind `animate-pulse` usages (loading skeletons on `agents/page.tsx`, the YAML drawer) are not gated.

There is **no global `MotionConfig`** — a repo search for `MotionConfig` returns only `node_modules`. The one-line fix (`reducedMotion="user"`) makes framer-motion automatically drop transform/layout animations for every motion component while keeping opacity feedback, which is exactly the playbook's "keep opacity/color, drop movement" rule.

## Target

```tsx
// NEW FILE: frontend/src/components/providers/MotionConfigProvider.tsx
'use client';

import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * App-wide motion safety: with reducedMotion="user", every framer-motion
 * component in the tree automatically disables transform/layout animation
 * when the OS prefers reduced motion, while keeping opacity feedback.
 * Components that already gate themselves with useReducedMotion() are
 * unaffected (this is a floor, not a ceiling).
 */
export function MotionConfigProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
```

```tsx
// frontend/src/app/layout.tsx — wrap {children} in the provider
// (this is the root layout for BOTH the landing page and the (app) shell)
import { MotionConfigProvider } from '@/components/providers/MotionConfigProvider';
// ...
      <body className="font-sans bg-white min-h-screen" suppressHydrationWarning>
        <MotionConfigProvider>{children}</MotionConfigProvider>
      </body>
```

```css
/* frontend/src/app/globals.css — add .animate-pulse to the existing reduce block */
@media (prefers-reduced-motion: reduce) {
  .skeleton,
  .animate-blueprint-drift,
  .animate-ambient-float,
  .animate-ambient-pulse,
  .animate-pulse {
    animation: none;
  }
}
```

Note: `animate-spin` (spinners) is deliberately NOT killed — spinners are essential progress feedback (the playbook exempts feedback). Pulsing skeletons are decorative and safe to freeze.

```tsx
// frontend/src/components/layout/Sidebar.tsx:47 — CSS-only drawer, MotionConfig can't reach it
'transform transition-[transform,visibility] duration-300 ease-out',
// becomes
'transform transition-[transform,visibility] duration-300 ease-out motion-reduce:transition-none',
```

## Repo conventions to follow

- Existing per-component gating style — `useReducedMotion()` + conditional transform values (see `frontend/src/components/gates/RefusalGateCard.tsx:25-28`: `whileHover={reduceMotion ? undefined : { y: -2 }}`). This plan does NOT add more of those; it replaces the need via one global config.
- Client providers live in `frontend/src/components/providers/` (see `ToastProvider.tsx`).
- `motion-reduce:` is a Tailwind v4 built-in variant (the project runs Tailwind v4 via `@tailwindcss/postcss`).

## Steps

1. Create `frontend/src/components/providers/MotionConfigProvider.tsx` with the exact content above.
2. Edit `frontend/src/app/layout.tsx`: add the import and wrap `{children}` in `<MotionConfigProvider>`. Do NOT add `'use client'` to `layout.tsx` (it must stay a server component to keep the `metadata` export) — the provider itself is the client boundary.
3. Edit `frontend/src/app/globals.css`: add `.animate-pulse` to the `@media (prefers-reduced-motion: reduce)` selector list.
4. Edit `frontend/src/components/layout/Sidebar.tsx`: add `motion-reduce:transition-none` to the aside's motion class line.
5. Confirm no component-level changes are needed in Button/Card/Modal/PackageInstallModal/UnblockActionModal — `MotionConfig` covers them.

## Boundaries

- Do NOT convert `layout.tsx` to a client component.
- Do NOT touch the landing components (they already gate correctly) or any `useReducedMotion` calls.
- Do NOT kill `animate-spin` under reduced motion.
- Do NOT add `motion-reduce:` to every hover class in the app — that's a separate, lower-value sweep; only the drawer is in scope here.
- If any excerpt above has drifted, STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npm run typecheck` and `npm run lint` — must pass.
- **Feel check** (DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`):
  - Open any modal (e.g. the package-install popup on `/workspace`). It must **fade in with no scale/y movement**.
  - Hover + press any Button — the `y: -1` lift and `scale: 0.98` tap must be disabled (no movement).
  - Open the mobile drawer — the panel must appear instantly (no slide).
  - Normal mode (no emulation): everything must still animate exactly as before — this change must be a no-op for users without the preference.
- **Done when**: with reduced motion emulated, no transform/position animation fires anywhere in the app shell; without it, nothing changed.
