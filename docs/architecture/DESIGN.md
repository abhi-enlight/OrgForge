# Design System: Forge (Enlight Forge)

**Product:** Forge — one conversational copilot for the whole Salesforce org.
**Token source of truth:** `frontend/src/app/globals.css` (`@theme` block, Tailwind v4) + component classes.
**Design intelligence:** generated with `ui-ux-pro-max` (accessibility/interaction/motion rules); the *established* brand palette below is the source of truth (the generic "AI purple" default was consulted and rejected — Forge ships the OrgForge/Agentforge blue).

> This document is the semantic design system — the "why" behind every token, named descriptively with exact values. New screens must reuse these tokens; never hardcode raw hex in components.

**Docs set (one product):** [`unification_plan.md`](./unification_plan.md) (design) · [`DECISIONS.md`](./DECISIONS.md) (decisions) · [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (tracker) · [`api_contract.md`](./api_contract.md) (frozen API) · [`PRD.md`](./PRD.md) (requirements) · [`API.md`](./API.md) (reference) · [`APP_FLOW.md`](./APP_FLOW.md) (flows) · [`TECH_STACK.md`](./TECH_STACK.md) (stack) · [`PHASE5_PLAN.md`](./PHASE5_PLAN.md) (phase 5) · [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (audit) · legacy PRDs ([`OrgForge`](./legacy/OrgForge_PRD.md) · [`Agentforge`](./legacy/Agentforge_PRD.md))

---

## 1. Visual Theme & Atmosphere

**"Calm command center."** Forge feels like a precise, well-lit workspace — lighter than either legacy app (plan §6.0: *whitespace > widgets*). The mood is **confident, technical, and unhurried**:

- **Airy and flat** — generous spacing, a near-white surface with a whisper of cool blue-gray tint, flat cards with *barely-there* shadows. Nothing shouts.
- **One accent, used sparingly** — electric blue on white. Color means *action*; when every action is blue, the one that matters (Ask Forge, Send) still wins.
- **Calm status** — problems render as one inline banner with exactly one action, never a wall of modals (the single exception: the package-missing install modal, kept from Agentforge).
- **Technical texture without jargon** — micro-captions in mono uppercase (`NAVIGATION`, `FORGE v1`) as quiet signposts; artifacts render in Fira Code.

---

## 2. Color Palette & Roles

### 2.1 Brand (the one accent)

| Descriptive name | Hex | Role |
|---|---|---|
| **Forge Electric Blue** | `#1a6bff` | Primary actions, active nav, links, the FORGE logo mark, thinking dots, focus rings |
| **Deep Press Blue** | `#0052e0` | Hover state of primary blue (interactive feedback) |
| **Ice Blue Wash** | `#eef4ff` | Active nav pill background, chip/tag backgrounds, avatar initials, hero icon wells |
| **Ink Navy** | `#0a0f1e` | Brand dark — avatar disc, wordmark text, primary text, footer |
| **Deep Royal** | `#0d47a1` | Depth stop in the user-bubble gradient (blue → royal); one-off raw hex, used with the brand blue |
| **Mist Surface** | `#f5f6fa` | Page background / content surface tint; `brand-surface/40` in the shell main |
| **Hairline Border** | `#e8eaf0` | Card/input/header borders — 1px structural lines |
| **Slate Dashed** | `#c5ccdc` | Dashed drop-zone / empty-state borders |

### 2.2 Semantic status (unified language for both engines)

| Descriptive name | Hex | Role |
|---|---|---|
| **Pass Green** | `#10b981` (bg `#ecfdf5`) | Success: deploy success, passed checks, "ok" states; glow `shadow-pass` |
| **Refused Red** | `#ef4444` (bg `#fef2f2`) | Failure, refusal gates, destructive actions (Stop, remove, sign out hover); glow `shadow-refused` |
| **Warn Amber** | `#f59e0b` (bg `#fffbeb`) | Attention banners, deploy warnings, package-missing, license-unsupported |

Status colors are **always paired with a tinted background chip/banner** — never bare text (accessible pairs, ≥ 4.5:1 against their tinted bg).

### 2.3 Text ramp

| Descriptive name | Value | Role |
|---|---|---|
| **Ink Navy (primary)** | `#0a0f1e` | Headings, body copy — near-black with a navy cast |
| **Slate Smoke (secondary)** | `rgba(10, 15, 30, 0.65)` | Secondary copy, descriptions |
| **Fog Gray (muted)** | `rgba(10, 15, 30, 0.35)` | Placeholders, micro-captions, timestamps |

---

## 3. Typography Rules

- **UI type:** **Inter** (variable, via `next/font`), weights 400/500/600/700. Base 16px; body line-height ~1.5. Headings bold (700), tight tracking. Used **everywhere**, landing included (hero + section headlines use Inter 700 with `tracking-[-0.02em]`/`[-0.03em]` for the display feel — no separate display face; Space Grotesk was trialed in Pass 40 and reverted).
- **Code/artifacts:** **Fira Code** (`--font-mono`) — YAML drawers, agent definitions, chat code blocks, log lines.
- **Micro-captions:** mono uppercase with wide tracking (`text-[10px] font-mono font-bold uppercase tracking-[0.2em]`, e.g. `NAVIGATION`, `FORGE v1`, `ACTIVE ORG`) — quiet technical signposts, slate-400.
- **Wordmark:** `font-bold tracking-[0.25em]` — **F O R G E** with the blue `F` logo tile.
- **Scale:** keep body ≥ 12px (rule: no text below 12px); the smallest used size is 10px, reserved for decorative micro-captions only.

---

## 4. Component Stylings

### Buttons
- **Primary:** Electric Blue `#1a6bff` fill, white text, `rounded-xl`, hover → Deep Press Blue `#0052e0`, 150–200ms ease. **Send** button, **Ask Forge**, **Connect Salesforce**.
- **Ghost/outline:** 1px Hairline Border, slate text; hover → blue border/text with `bg-brand-surface` (attach button).
- **Danger:** Refused Red treatments — **Stop** (solid red while building), **Stop & reset** (outline red, `RotateCcw` icon), sign-out hover. 44px+ touch targets on mobile, icon+label with `aria-label`/`title`.
- **Micro-buttons:** "Clear" as text-with-icon (`Eraser`), slate → red hover, disabled at 50% opacity.

### Cards / Containers
- **Default card:** white, **gently rounded** corners (`rounded-2xl` = 1.25rem for cards, `rounded-xl` = 0.875rem for controls/rows), Hairline Border, **whisper-soft shadow** (`shadow-soft`, or `shadow-lift` for menus/dropdowns).
- **Chat bubbles:** assistant bubbles are white `rounded-2xl` with a **skewed top-left corner** (`rounded-tl-sm`) — conversational asymmetry; **user bubbles** are `rounded-3xl rounded-tr-sm` with the Electric Blue → Deep Royal gradient at 95% opacity and a blue-tinted glow (`0 8px 24px rgba(26,107,255,0.2)`), white text.
- **Hover lift:** cards translate slightly + `shadow-card-hover` (0 20px 40px -15px navy at 8%) — e.g. dashboard stat tiles.
- **Glass treatments:** `card-glass` gradient (white 95% → 75%) for floating chips; header `bg-white/90 backdrop-blur`.
- **Org-change chat cards:** one visual family as agent progress cards — same radius, border, shadow language.

### Inputs / Forms
- **Text area (composer):** 1px Hairline Border on `brand-surface/60`; focus → `ring-2 ring-brand-blue/30` + Electric Blue border (`transition-shadow`); placeholder Fog Gray; min-height 46px, auto-grow to 40.
- **File chip:** Ice Blue Wash pill with blue border/text; persistent (live state) with an `X` remove that turns Refused Red on hover. Attach errors: 12px Refused Red `role="alert"`, auto-dismisses 4s.
- **Org pill (header):** `rounded-full`, white with Hairline Border; hover → blue border + `shadow-soft`; when no org → Ice Blue Wash with Electric Blue text ("Connect an org").

### Chips / Status
- **Capability chip:** `Auto / Agents / Org Change / Both` — the routing pin; active state in Ice Blue Wash + Electric Blue text/border (same language as sidebar active nav).
- **Capability color coding:** `agent` signals in Electric Blue (Ice Blue Wash badges/chips); `org_change` signals in **Pass Green** (emerald-50/600 badges, emerald-100 icon wells, emerald-700 labels) — the two engines are distinguished by accent, not layout.
- **Status banner:** one line, one action, Warn/Refused/Pass tinted background, pill or card form. The only modal in the product: package-missing install (legacy parity).
- **Micro tags:** mono uppercase 9px pills (`CHAT`, org types `PRODUCTION`/`SANDBOX`/`SCRATCH`).

---

## 5. Layout Principles

- **Shell grid:** sticky header **65px** (`bg-white/90 backdrop-blur`, Hairline Border bottom) · sidebar **256px** (`w-64`, white, Hairline Border right) · main `bg-brand-surface/40`, padding `p-6 md:p-8`. Sidebar static-sticky from `md` up; slide-over drawer below.
- **Spacing rhythm:** 4px base; generous section gaps (`space-y-4/6`); cards breathe. The dashboard caps at 3–4 cards — *whitespace > widgets*.
- **One primary action per screen** — everything else secondary; empty states collapse to a single centered CTA.
- **Radii ladder:** controls/rows `rounded-xl` (0.875rem) · cards `rounded-2xl` (1.25rem) · pills `rounded-full`. Chat bubbles skew the top-left corner (`rounded-tl-sm`) for a conversational feel.
- **Depth:** flat base + whisper shadows for elevation; menus/dropdowns use `shadow-lift`; interactive cards `shadow-card-hover` on hover. Never heavy drop shadows. (The legacy blue "F" logo tile was replaced by the **Enlight Lab logo** — `public/enlight-logo.png`, 615×96 — rendered at `h-7 w-36 sm:w-40` with `object-contain`, hover `scale-[1.02]`, beside the FORGE wordmark.)

---

## 6. Motion & Micro-interactions

- **Easing:** `--ease-spring: cubic-bezier(0.22, 1, 0.36, 1)`; standard durations **150–300ms** (`transition-all duration-200`, `duration-300 ease-out` for the drawer).
- **Entrances:** `animate-fade-in` (reset confirmation pill), `animate-scale-in` (menus/dropdowns).
- **Thinking indicator:** three Electric Blue dots, staggered `animate-bounce` (`animation-delay` -0.3s/-0.15s/0) with a "Thinking…" label — loading feedback is never silent.
- **Micro-details:** logo tile `group-hover:scale-105`; nav items smooth color/background shifts; attach button icon turns blue on hover.
- **Reduced motion:** respect `prefers-reduced-motion` (fade/scale entrances degrade gracefully; bouncing dots become static) — motion is enhancement, never the message.

---

## 7. Interaction & Accessibility Rules (ui-ux-pro-max)

1. **Contrast ≥ 4.5:1** for body text (Ink Navy on white, Slate Smoke on white, blue on Ice Blue Wash). Status colors always tinted-bg + ≥ 4.5:1 text.
2. **Touch targets ≥ 44×44px** on mobile (attach button is `w-11 h-11`); icon-only controls always carry `aria-label` + `title`.
3. **Focus visible** everywhere: composer `focus:ring-2 ring-brand-blue/30`; keyboard-nav-able menus (Escape closes drawer/dropdowns).
4. **SVG icons only** (lucide-react) — no emoji-as-icon; `cursor-pointer` on all clickable elements.
5. **Live regions:** `role="status"` on the reset confirmation; `role="alert"` on attach errors; the Thinking indicator is labeled text, not decoration.
6. **Responsive:** 375 / 768 / 1024 / 1440 — no horizontal scroll, mobile drawer nav, truncating org names (`max-w-[180px] truncate`).
7. **Reserve space:** empty states and the Thinking indicator hold their place (no layout shift); auto-scroll pinning honors the user's scroll position.
8. **Semantic tokens, never raw hex** in components — all values flow from `@theme`.

---

## 8. Page-level applications

| Surface | Personality |
|---|---|
| **Root `/`** | **Live Blueprint landing** (Pass 40 + 42): light technical schematic world — dot-grid blueprint texture over a fixed ambient drafting-line layer, Inter display type (DESIGN.md font), a looping `LivePipeline` chat preview (message → route → gates → signed record; in-view gated, hover-pause, reduced-motion static), an isometric SVG drafting plane + scroll-linked parallax behind the hero (Pass 42), blurred wireframe `AmbientShape` silhouettes in every section, scroll-drawn connector rail in How-it-works, and one dark forge CTA anchor. Full spec: `LANDING_REDESIGN_PLAN.md` |
| **Login** | Full-bleed `hero-gradient` background (Mist → white) with the centered auth card; **Enlight Lab logo** above the Forge heading; 3-step onboarding (Sign in → Connect Salesforce → GitHub optional); the `radial-glow` token is reserved for hero/marketing surfaces |
| **Dashboard** | Calm: hero row + 3 hover-lift tiles + one banner + activity feed; empty states collapse to one CTA |
| **Copilot** | Gradient message area (`brand-surface/40 → /70`), white bubbles, blue Thinking dots, per-capability progress cards |
| **Agents / Changes / Settings** | Quiet read-only lists on Mist; Settings in 3 tabs |
| **Workspace** | Legacy 10-stage stepper, kept verbatim as the Advanced view |

---

## 9. Token inventory (from `globals.css` `@theme`)

```css
--color-brand-blue: #1a6bff;        --color-brand-blue-hover: #0052e0;
--color-brand-blue-light: #eef4ff;  --color-brand-dark: #0a0f1e;
--color-brand-pass: #10b981;        --color-brand-pass-bg: #ecfdf5;
--color-brand-refused: #ef4444;     --color-brand-refused-bg: #fef2f2;
--color-brand-warning: #f59e0b;     --color-brand-warning-bg: #fffbeb;
--color-brand-surface: #f5f6fa;     --color-brand-border: #e8eaf0;
--color-brand-border-dashed: #c5ccdc;
--color-blueprint-wire: #aebcdd;      --color-blueprint-wire-strong: #8fa4cf;
--color-text-primary: #0a0f1e;
--color-text-secondary: rgba(10, 15, 30, 0.65);
--color-text-muted: rgba(10, 15, 30, 0.35);
--font-sans: Inter, system-ui, sans-serif;   --font-mono: Fira Code, ui-monospace, monospace;
--shadow-soft / --shadow-lift / --shadow-card-hover / --shadow-glow / --shadow-glow-lg
--shadow-pass / --shadow-refused
--radius-xl: 0.875rem;  --radius-2xl: 1.25rem;
--ease-spring: cubic-bezier(0.22, 1, 0.36, 1);
--background-image-radial-glow / hero-gradient / card-glass
```
