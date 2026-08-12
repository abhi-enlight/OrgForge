# 013 — Scope the remaining `transition-all` batch (app surfaces)

- **Status**: DONE (2026-08-12 — typecheck + lint pass; final grep shows only the three landing CTAs in plan 014 remain)
  - Execution delta: 20 spots / 11 files — the plan table's 18 omitted `settings-flow.tsx:440` (`transition-[background-color,border-color]`) and `:451` (`transition-[color,transform]`), which the audit grep had; both were scoped as part of this execution. `PackageHealthChip.tsx:68` shipped as `transition-[background-color,border-color,color,box-shadow,transform]` (reviewer caught `color` — the status-flip label text — missing from the original target). Disabled-state `opacity` snaps on the chat send button are accepted per plan 012's convention (state flips animate instantly).
- **Commit**: n/a (not a git repository at stamp time)
- **Severity**: MEDIUM
- **Category**: Performance (animating off-GPU properties)
- **Estimated scope**: 10 files, ~18 class-string edits

## Problem

Plan 002 explicitly deferred a list of `transition-all` usages ("if encountered, leave it and mention in the report") and plan 012 handles the four core primitives. These are the rest — app cards, buttons, chips, and CTA links whose hover/active/state changes animate only a subset of their properties but still register `transition: all`. `transition: all` is an always-finding per the playbook: it animates unintended properties off-GPU.

All current code verbatim (each `Find` string is unique within its file — grep to locate):

| # | File:line | Current | Properties that change | Target |
|---|---|---|---|---|
| 1 | `frontend/src/components/workspace/AmbiguityCard.tsx:101` | `...rounded-xl border transition-all duration-200 space-y-1 cursor-pointer` | bg, border, ring, color (select/hover) | `transition-[background-color,border-color,box-shadow,color] duration-200` |
| 2 | `AmbiguityCard.tsx:148` | `...rounded-xl border border-dashed transition-all duration-200 cursor-pointer` | bg, border, ring, color | `transition-[background-color,border-color,box-shadow,color] duration-200` |
| 3 | `AmbiguityCard.tsx:177` | `'rounded-xl border border-dashed transition-all duration-200 p-4'` | bg, border | `transition-[background-color,border-color] duration-200` |
| 4 | `frontend/src/components/workspace/StageTimeline.tsx:87` | `'w-full flex items-center gap-3 rounded-xl p-2.5 pr-3 text-left transition-all duration-200 group'` | bg, ring, color | `transition-[background-color,box-shadow,color] duration-200` |
| 5 | `StageTimeline.tsx:103` | `'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold transition-all duration-200'` | border, bg, color, `scale-105` | `transition-[background-color,border-color,color,transform] duration-200` |
| 6 | `frontend/src/components/org/PackageHealthChip.tsx:68` | `'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-all'` | bg, border, color (status flip), `hover:shadow-sm`, `active:scale-95` | `transition-[background-color,border-color,box-shadow,transform]` |
| 7 | `frontend/src/components/org/PackageInstallModal.tsx:119` | `...bg-brand-blue hover:bg-brand-blue-hover shadow-md shadow-brand-blue/25 transition-all active:scale-95` | bg, shadow, scale | `transition-[background-color,box-shadow,transform] active:scale-95` |
| 8 | `PackageInstallModal.tsx:127` | `...text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all active:scale-95 cursor-pointer` | color, bg, scale | `transition-[background-color,color,transform] active:scale-95` |
| 9 | `frontend/src/components/chat/CapabilityChip.tsx:67` | `'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'` | bg, border, color, `shadow-glow` (active) | `transition-[background-color,border-color,color,box-shadow]` |
| 10 | `frontend/src/app/(app)/dashboard/page.tsx:139` | `className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-blue text-white font-semibold shadow-glow hover:bg-brand-blue-hover transition-all hover:scale-[1.02]"` | bg, scale | `transition-[background-color,transform] hover:scale-[1.02]` |
| 11 | `dashboard/page.tsx:201` | `className="group inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-brand-blue text-white font-semibold shadow-glow hover:bg-brand-blue-hover transition-all hover:scale-[1.02]"` | bg, scale | `transition-[background-color,transform] hover:scale-[1.02]` |
| 12 | `dashboard/page.tsx:218` | `className="group text-left rounded-2xl border border-brand-border bg-white p-5 shadow-soft hover:shadow-card-hover hover:border-brand-blue/30 transition-all duration-200 cursor-pointer"` | border, shadow | `transition-[box-shadow,border-color] duration-200` |
| 13 | `frontend/src/app/(app)/changes/page.tsx:269` | `className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-blue text-white font-semibold shadow-glow hover:bg-brand-blue-hover transition-all hover:scale-[1.02]"` | bg, scale | `transition-[background-color,transform] hover:scale-[1.02]` |
| 14 | `changes/page.tsx:415` | `'rounded-2xl border bg-white shadow-soft transition-all duration-200'` | border, shadow (expanded toggles both) | `transition-[box-shadow,border-color] duration-200` |
| 15 | `changes/page.tsx:595` | `className="rounded-2xl border border-brand-danger/20 bg-white p-5 shadow-soft hover:border-brand-danger/40 transition-all duration-200"` | border, shadow | `transition-[box-shadow,border-color] duration-200` |
| 16 | `frontend/src/app/(app)/agents/page.tsx:325` | `className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-blue text-white font-semibold shadow-glow hover:bg-brand-blue-hover transition-all hover:scale-[1.02]"` | bg, scale | `transition-[background-color,transform] hover:scale-[1.02]` |
| 17 | `frontend/src/app/(app)/chat/page.tsx:567` | `className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-blue text-white text-sm font-semibold px-4 h-11 shadow-glow hover:bg-brand-blue-hover disabled:opacity-40 disabled:shadow-none transition-all cursor-pointer active:scale-[0.98]"` | bg, shadow (`disabled:shadow-none`), scale | `transition-[background-color,box-shadow,transform] cursor-pointer active:scale-[0.98]` |
| 18 | `frontend/src/app/login/login-flow.tsx:328` | `className="group flex items-center gap-3.5 rounded-xl border border-brand-border px-4 py-3.5 text-left hover:border-brand-blue/40 hover:shadow-soft transition-all disabled:opacity-60 cursor-pointer"` | border, shadow | `transition-[border-color,box-shadow] disabled:opacity-60 cursor-pointer` |

## Target

Every spot transitions only the properties its state changes (see the "Properties that change" column — derive each target from the `Find` string and replace only the `transition-all` token with the listed target, keeping every other class in the string intact). No durations are added where none exist (bare `transition-all` = Tailwind's default 150ms — the scoped list keeps that default).

## Repo conventions to follow

- Arbitrary property lists are the established convention (`Sidebar.tsx:47` `transition-[transform,visibility]`; plan 002's `transition-[box-shadow,border-color]` on the agents card). Plan 012 applies the identical pattern to the primitives — imitate it.
- `transition-colors`/`transition-shadow` are also used in this codebase (Header nav links, AmbiguityCard textarea) — but these spots change more than one category, so use the arbitrary-list form.
- Do not change durations, hover classes, or active-scale values — property lists only.

## Steps

1. Work file by file; for each of the 18 rows, locate the `Find` string (grep the quoted fragment; each is unique in its file) and replace only the `transition-all` token with the row's `Target` fragment. Keep all other classes byte-identical.
2. After all edits, confirm: `grep -rn 'transition-all' src --include='*.tsx'` shows **zero** matches in the 10 files above. (Landing CTAs `Hero.tsx:82`, `Nav.tsx:61`, `CtaSection.tsx:64` are intentionally NOT in this plan — see Boundaries.)

## Boundaries

- Do NOT touch the landing CTAs (`Hero.tsx`, `Nav.tsx`, `CtaSection.tsx`) — a separate LOW pass; leave them.
- Do NOT touch `components/ui/*` (plan 012's scope), `globals.css`, or framer-motion props.
- Class-string edits only — no markup, no state logic, no new dependencies.
- If a `Find` string doesn't match (drift since the stamp), STOP and report instead of improvising.

## Verification

- **Mechanical**: from `frontend/`, run `npx tsc --noEmit` and `npx eslint` on all 10 touched files — both clean. Then `grep -rn 'transition-all' src --include='*.tsx'` — the only remaining matches (if any) must be the three landing files.
- **Feel check**:
  - On `/workspace`, select an ambiguity option and click through stages: bg/border/ring transitions still animate at the same speed; the stage timeline nodes still scale and recolor.
  - On `/dashboard`, hover a CTA button (bg + scale still smooth) and a tile card (border + shadow still ease).
  - On `/chat`, press the Send button: bg + scale press feedback identical.
  - In DevTools → Performance, record a hover sweep over an AmbiguityCard option: **no Layout rows** for the card.
- **Done when**: all 18 spots transition only their changing properties, the grep shows nothing in the touched files, and every hover/active/state change still animates identically.
