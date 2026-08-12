# 011 — Freeze the chat typing indicator under reduced motion

- **Status**: DONE (2026-08-12 — CSS parses clean, lint unaffected, browser no-op check passed: landing renders with zero console errors; typing-indicator freeze verified against the exact current kill-list)
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file, 1 line added to an existing media query

## Problem

The chat "Thinking…" indicator is the app's most-used surface, and its three dots bounce under `prefers-reduced-motion: reduce`. Plan 003's kill list (below) freezes `.animate-pulse` (skeletons) and the landing ambients, and deliberately keeps `.animate-spin` (essential feedback) — but it misses `.animate-bounce`, which is pure movement with no informational content (the "Thinking…" label carries the meaning).

```css
/* frontend/src/app/globals.css:232-241 — current reduce block */
@media (prefers-reduced-motion: reduce) {
  .skeleton,
  .skeleton::after,
  .animate-blueprint-drift,
  .animate-ambient-float,
  .animate-ambient-pulse,
  .animate-pulse {
    animation: none;
  }
}
```

The bouncing dots:

```tsx
// frontend/src/app/(app)/chat/page.tsx:462-466 — current (no change needed)
<span className="flex items-center gap-1.5 text-sm text-slate-400">
  <span className="flex gap-1">
    <span className="w-1.5 h-1.5 rounded-full bg-brand-blue animate-bounce [animation-delay:-0.3s]" />
    <span className="w-1.5 h-1.5 rounded-full bg-brand-blue animate-bounce [animation-delay:-0.15s]" />
    <span className="w-1.5 h-1.5 rounded-full bg-brand-blue animate-bounce" />
  </span>
  Thinking…
</span>
```

## Target

`.animate-bounce` joins the kill list. Under reduced motion the dots sit static (still visible — the indicator must not vanish), matching plan 003's principle: "keep opacity/color, drop movement."

```css
/* target — globals.css reduce block */
@media (prefers-reduced-motion: reduce) {
  .skeleton,
  .skeleton::after,
  .animate-blueprint-drift,
  .animate-ambient-float,
  .animate-ambient-pulse,
  .animate-pulse,
  .animate-bounce {
    animation: none;
  }
}
```

`animate-bounce` is a Tailwind core utility, so a plain `.animate-bounce { animation: none }` in this block overrides it (same mechanism the existing `.animate-pulse` entry relies on). The inline `[animation-delay:-0.3s]` styles become moot once animation is `none` — leave them in place.

## Repo conventions to follow

- The kill list is the established mechanism — plan 003's `.animate-pulse` entry is the exact exemplar (`globals.css:238`). Extend the selector list, don't restructure.
- Reduced motion = fewer and gentler, **not zero**: do not hide the indicator, and do not add this class to the chat component itself.

## Steps

1. In `frontend/src/app/globals.css`, in the `@media (prefers-reduced-motion: reduce)` block, add `.animate-bounce,` to the selector list — after `.animate-pulse,` (alphabetical order within the Tailwind utilities).
2. Do not touch `chat/page.tsx` — the CSS kill list is the single point of control.

## Boundaries

- Do NOT touch `.animate-spin` — spinners are essential in-flight feedback and were deliberately kept by plan 003.
- Do NOT hide the typing indicator or its dots — only stop the movement.
- Do NOT touch any other media query, keyframe, or the `chat/page.tsx` markup.

## Verification

- **Mechanical**: from `frontend/`, run `node -e "const fs=require('fs');const postcss=require('postcss');postcss.parse(fs.readFileSync('src/app/globals.css','utf8'));console.log('CSS_PARSE_OK')"` — must print `CSS_PARSE_OK` (the file ships as one stylesheet; a parse error breaks the whole app). Lint is unaffected (CSS-only).
- **Feel check**:
  - In DevTools → Rendering → emulate `prefers-reduced-motion: reduce`, open `/chat`, send a message, and confirm the three dots are **static** while "Thinking…" stays visible.
  - In normal mode (no emulation), confirm the dots still **bounce** exactly as before — the change must be invisible to users without the preference.
  - Rapid send/stop cycles: dots never flash or stutter (they're inert either way).
- **Done when**: under emulated reduced motion the typing dots don't move; in normal mode the bounce is unchanged.
