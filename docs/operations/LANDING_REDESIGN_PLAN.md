# Landing Page Redesign Plan — "Live Blueprint"

**Status:** ✅ **Implemented (Pass 40)** — all four passes (A: fonts/tokens/Reveal · B: Hero/LivePipeline · C: five sections · D: validation) shipped. tsc ✅ eslint ✅ `next build` 10/10 ✅ SSR 200 with all markers, zero `opacity:0` ✅ reviewer findings fixed (WCAG 2.2.2 keyboard pause via `tabIndex`, reduced-motion caret, dark-panel contrast) ✅ DESIGN.md §3/§8 + tracker updated.

**Font amendment (user, Pass 40 follow-up):** Space Grotesk **reverted** — the landing uses the **DESIGN.md fonts** (Inter UI + Fira Code mono) everywhere. Headlines keep the display feel via Inter 700 + tight tracking (`tracking-[-0.02em]`/`[-0.03em]`); the LivePipeline chat header uses the DESIGN.md §3 mono-uppercase micro-caption convention (`font-mono text-[11px] font-bold uppercase tracking-[0.2em]`).

**Texture amendment (user, Pass 41):** "bg is blank, too many white spaces" → the blueprint dot grid moved to the **page level** (`main` background, 0.07 alpha at 26px) so every section inherits it; a new `BlueprintCorners` component adds registration marks at the four corners of the light sections; vertical rhythm tightened (`py-16/20` instead of `py-20/28`); footer is `bg-white/70` so texture runs to the bottom.

**Depth amendment (user, Pass 42):** "background feels empty, use SVGs + 3D design elements" → the background gains real depth while keeping the light blueprint world: a **fixed ambient layer** in `page.tsx` (faint drafting lines + two offset glows behind all content), a new **`IsometricGrid`** component (hand-drawn SVG isometric plane, `perspective(1200px) rotateX(10deg)` tilt behind the hero stage, slow `blueprint-drift` CSS loop), a new **`AmbientShape`** component (blurred wireframe silhouettes — cube/arch/hex/brackets/orbits — with a `blueprint-wire` palette, float + pulse loops, used in every section), and **one scroll-linked parallax** in the hero (`useScroll`/`useTransform`, transform-only, gated by `useReducedMotion`). Three.js/WebGL was explicitly rejected (perf + a11y, ui-ux-pro-max "3D & Hyperrealism" is Poor) in favor of CSS 3D transforms + inline SVG ("Dimensional Layering", Tailwind 10/10).
**Skills used:** impeccable (`bolder` + `polish` methodology) · design-taste-frontend (pre-flight rules) · ui-ux-pro-max (dials: VARIANCE 8, MOTION 7, DENSITY 3).
**Design read:** *B2B SaaS landing for technical Salesforce buyers, with a confident-technical-calm language, leaning toward a light "live blueprint / command-center schematic" world in OrgForge electric blue on near-white, Space Grotesk display + Inter body + Fira Code mono, restrained-but-alive motion.*

---

## 0. Diagnosis — why the current page reads bland

The page is *correct* but **structurally uniform**. Every section makes the same move:

| # | Symptom | Skill rule violated |
|---|---|---|
| 1 | **Same card language everywhere** — white `rounded-2xl` hairline cards on mist (Capabilities, Bento, CTA panel), same `py-20/28`, same `max-w-6xl` | design-taste §4.4 (cards only when elevation earns it) · §9.C (3-equal-card ban) |
| 2 | **Same layout family repeated 3×** — icon-well + title + body + bullets in Capabilities, HowItWorks, Bento | §4.7 Section-Layout-Repetition (need ≥4 families / 8 sections) |
| 3 | **Hero is timid** — `max-w-6xl`, `text-6xl` cap, a small *static* chat card as the only asset; no texture, no drama | §4.8 (hero needs a real visual) · MOTION 7 claimed vs. 5 shown |
| 4 | **Flat section rhythm** — white / `brand-surface/60` alternate; no peak, no dark anchor except the tiny CTA panel | impeccable `bolder` ("give it its own rhythm") |
| 5 | **Uniform motion** — one `Reveal` (fade + translate) everywhere, same 0.08s stagger | §5 ("motion claimed, motion shown") |
| 6 | **Default Inter for display** — the #1 AI tell | §4.1 (avoid Inter as display default) |
| 7 | **Eyebrows underused then duplicated** — hero has one; section headers are undifferentiated `h2 + p` | §4.7 Eyebrow Restraint (budget = 2 total) |
| 8 | **Zero brand texture** — a product named OrgForge with a governed-change story has no blueprint/grid/artifact visual language at all | impeccable `bolder` skeleton test (structure alone should say what this is) |
| 9 | **Product preview wasted** — the real product streams progress cards, dry-run results, signed records. The landing shows one frozen bubble | §4.8 (real component preview allowed) |

**Design read / dials:** VARIANCE 8 (asymmetric, offset) · MOTION 7 (fluid, scroll-linked, one loop) · DENSITY 3 (airy — the app's "whitespace > widgets" law holds).

---

## 1. The committed world — "Live blueprint"

OrgForge is where Salesforce orgs get *built*. The landing becomes a **light, technical schematic of that process**:

- **Dot-grid blueprint texture** (CSS `radial-gradient` dots) on the hero and CTA, never on scrolling containers (perf rule §6.E).
- **Connector lines** between stages that **draw themselves on scroll** (SVG `stroke-dashoffset` or Motion `pathLength`), one page-wide use, in the How-it-works rail.
- **Mono coordinate annotations** (`Fira Code`, 10-11px) as quiet signposts — functional labels, never fake precision, never section numbers.
- **A hero that runs the actual product**: the chat preview becomes a *live* mini-pipeline that loops a real build (message → route → gates → dry-run → signed record). Pauses on hover; collapses to a static frame under `prefers-reduced-motion`; only animates when in viewport.
- **One dark "forge" anchor**: the CTA panel in Ink Navy with blueprint-on-dark + electric glow — the single peak of the scroll.

**What never changes (product truth):** brand palette lock (one accent `#1a6bff`), all copy claims (REF-01..10 gates, HMAC-SHA256, AES-256-GCM, classifier routing, CSV export), route slugs, anchor IDs (`#capabilities`, `#how-it-works`, `#security`), login/dashboard/app surfaces, and the app-level tokens in `globals.css`.

---

## 2. Typography plan (AMENDED: DESIGN.md fonts, per user)

| Role | Font | Change |
|---|---|---|
| Display / headlines | **Inter 700**, `tracking-[-0.02em]`/`[-0.03em]` | Reverted from Space Grotesk (user: "change the fonts to design.md fonts") — Inter is DESIGN.md's UI type, used everywhere |
| Body | Inter 400/500 (unchanged) | DESIGN.md §3 |
| Mono / artifacts / coordinates | Fira Code (unchanged) | Code, YAML, gate IDs, HMAC snippets |
| Micro-captions | Fira Code, 10-11px, `uppercase tracking-[0.2em]` | DESIGN.md §3 — now also on the LivePipeline chat header ("ORGFORGE COPILOT") |

**Scale ladder (landing only):** hero display `text-5xl sm:text-6xl lg:text-7xl` (headline ≤ 8 words → large scale justified) · section `h2` `text-4xl lg:text-5xl` · card titles `text-lg/xl font-bold tracking-tight` · body `text-base/lg` `max-w-[65ch]`.

---

## 3. Design tokens to add (globals.css `@theme`)

```css
--color-blueprint-line: #d3dcee;          /* connector lines */
--color-blueprint-line-strong: #b9c6e4;   /* connector hover/active */
--color-blueprint-dot: rgba(10, 15, 30, 0.06);
--background-image-blueprint-grid: radial-gradient(var(--color-blueprint-dot) 1px, transparent 1px); /* background-size: 22px 22px */
--background-image-blueprint-grid-dark: radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px); /* size 26px 26px */
```

Everything else (palette, shadows, radii, status colors, `hero-gradient`, `radial-glow`, `card-glass`) **stays untouched**. No new hue anywhere — the blueprint lines are desaturated versions of the existing neutrals, not a second accent.

---

## 4. Component-by-component redesign

### 4.1 `Nav.tsx` (light touch)
- Keep sticky glass bar, one line, `h-16`, Enlight logo + ORGFORGE wordmark, Sign in.
- Add the **dot-grid strip** as a 2px hairline accent under the bar (blueprint enters at frame one).
- No new links, no badges, no status dots (decorative-dot ban §9.F).

### 4.2 `Hero.tsx` — the centerpiece (new `LivePipeline` replaces `ChatPreview`)
- **Layout:** asymmetric 5/7 split (left copy, right stage), `min-h-[100dvh]` (never `h-screen`), top padding ≤ `pt-24`.
- **Background:** full-bleed dot grid + the existing radial brand glow, both `aria-hidden`, `pointer-events-none`.
- **Copy (≤4 text elements, eyebrow + headline + subtext + CTAs):**
  - Eyebrow (1 of the 2 budget): `ORGFORGE BY ENLIGHT LAB` (mono, brand blue)
  - Headline (≤2 lines, Space Grotesk 700): *"One copilot for your whole Salesforce org"*
  - Subtext (≤20 words): *"Build Agentforce agents and ship governed org changes from one conversation. Two skills, one assistant, fully signed."*
  - CTAs: `Open OrgForge` (primary) + `See what it does` → `#capabilities` (secondary). One label per intent, page-wide.
- **Entrance choreography:** line-mask reveal on the headline (words slide up through an overflow mask), eyebrow + subtext + CTAs stagger after, stage slides in from the right with `scale 0.96 → 1`. Springs (`stiffness 100, damping 20`), total < 1s. Reduced-motion → all visible instantly.

### 4.3 `LivePipeline.tsx` — the hero asset (replaces `ChatPreview`)
- A **real mini-version of the chat UI** (not a fake screenshot — the honest-preview rule §4.8).
- **Loop script (3-4 acts, ~9-10s, repeats while in view, pauses on hover/focus):**
  1. User bubble types: *"Add a validation rule to Opportunity, then list my agents"*
  2. Capability chip resolves `Org change` + thinking dots
  3. Progress card streams: *impact analysis → 10 gates → dry-run*
  4. **Signed record card** appears with a Fira Code HMAC snippet and the progress bar fills
- **Engineering:** `IntersectionObserver`-gated (`useInView` from motion) so it only runs when visible; `useReducedMotion` → static final frame; pause on `onMouseEnter`/`onFocus`; `transform`/`opacity` only; stage height reserved (CLS ≈ 0).
- **Coordinates:** a mono annotation pin like `STAGE 04 · SIGN` on the card — quiet, functional, not fake precision.

### 4.4 `Capabilities.tsx` — asymmetric split rail (layout family #2, no more 2-equal-cards)
- **Left (2/3):** large **Agentforce build** panel with a real `.agent` YAML artifact rendered in Fira Code on a dark `brand-dark` slab (the first structural dark moment) + title/body/bullets.
- **Right (1/3):** stacked **governed org changes** panel (tinted), same copy truth.
- **Connector:** a blueprint line with a mono routing annotation (*"classifier → engine"*) linking the two — the motif does real work (shows the routing story).
- Eyebrow #2 (last of budget): `THE TWO ENGINES` (plain topic label, not numbered).

### 4.5 `HowItWorks.tsx` — blueprint pipeline rail (family #3, replaces 3-equal-columns)
- **Desktop:** a vertical rail with 3 stage nodes (icon disc + verb-noun title + body), connected by an **SVG line that draws on scroll** (`pathLength` scrub via `useScroll` on the rail — the page's one scroll-linked draw; §5.C/5.D compliant, no `window.scroll` listeners).
- **Drop the `0{1..3}` numbers** (banned generic step labels §9.F). Titles already verb-noun (`Connect your org` / `Ask in plain language` / `Review and ship`) — keep.
- **Mobile (<768):** explicit single-column collapse, vertical line still draws, nodes stack.

### 4.6 `FeatureBento.tsx` — rhythm + artifact cells (family #4)
- Keep **exactly 6 cells** (cell-count rule) but reshape composition for rhythm: 2-col hero cell (Refusal gates), 2-col dark-anchor cell (Encrypted credentials → Ink Navy), plus artifact cells showing real UI fragments:
  - A **gate table fragment** (REF-01..REF-04 rows, pass/refuse) in one cell
  - A **signed-record row** with an HMAC hash line in another
- Background diversity satisfied: dark cell + tinted cell + artifact cells + white cells. No white-on-white-only.

### 4.7 `Security.tsx` — guardrail schematic (family #5, kills the `divide-y` list)
- Replace the banned `divide-y border-y` spec list (§9.F border-every-row) with a **2-col blueprint schematic**: three vertical guardrail bars (AUTH · SIGN · INPUT) with lock icons, mono annotations, and one real verification chip showing an HMAC-SHA256 value in Fira Code.
- Copy unchanged (product truth).

### 4.8 `CtaSection.tsx` — the dark forge anchor (family #6)
- Ink Navy panel with **blueprint-on-dark dot grid** + electric radial glow (the one dark peak).
- Display headline in Space Grotesk: *"Your org speaks Salesforce. OrgForge speaks you."* + one `Open OrgForge` CTA.
- Optional subtle 3-4s glow pulse (CSS, reduced-motion off). No scanlines, no gimmicks.

### 4.9 `Footer.tsx` (light touch)
- Keep logo + ORGFORGE wordmark, tagline, anchors, Sign in. No version stamps, no locale strips.

---

## 5. Motion system (MOTION 7, all motivated)

| Moment | What | Why (motivation) |
|---|---|---|
| Hero entrance | Line-mask headline + staggered reveals | Hierarchy — land the value prop first |
| LivePipeline loop | Build-sequence cycle | Storytelling — shows the product working |
| HowItWorks rail | Connector line draws on scroll | Storytelling — progress is visible |
| Bento | Staggered cell reveal, hover lift | Hierarchy + feedback |
| CTA panel | Slow glow pulse | Feedback — the "forge" is lit |

**Rules enforced:** transform/opacity only · no `window.addEventListener('scroll')` · springs, not linear · every loop gated by in-view + `useReducedMotion` · marquee max 0-1 (only if a content ticker under the bento earns it — otherwise omit) · all cleanups in `useEffect` returns.

---

## 6. Pre-flight compliance (design-taste §14, run at ship)

- [ ] ZERO em-dashes anywhere on the page
- [ ] One accent locked (brand blue only; blueprint lines are neutral desaturations)
- [ ] Eyebrow count = 2 (hero + capabilities) ≤ ceil(6/3)
- [ ] 6 different layout families across 6 sections (no repetition, no zigzag)
- [ ] Hero fits viewport: ≤2-line headline, ≤20-word subtext, CTAs visible, `min-h-[100dvh]`, `pt ≤ 24`
- [ ] No duplicate CTA intent (`Open OrgForge` / `Sign in` only)
- [ ] No scroll cues, no version labels, no section-number labels, no decorative dots
- [ ] Bento = exactly 6 cells, ≥3 with real visual variation
- [ ] Real product preview (LivePipeline), no div-fake-screenshot
- [ ] Button/form contrast ≥ 4.5:1; focus visible; 44px touch targets
- [ ] Reduced-motion collapses all loops to static; SSR content fully visible (no `opacity:0` — keep the `useSyncExternalStore` mount gate in `Reveal`)
- [ ] One copy register; every claim real (gates, HMAC, AES-256-GCM, classifier, CSV)

---

## 7. Validation & rollout (implementation passes)

1. **Pass A — foundation:** fonts (`layout.tsx`) + tokens (`globals.css`) + `Reveal` upgrade (mask/stagger variants). *Gate: tsc + eslint + build.*
2. **Pass B — hero:** `Hero.tsx` + `LivePipeline.tsx`. *Gate: SSR content check (zero `opacity:0`), loop pauses on hover, reduced-motion static.*
3. **Pass C — sections:** Capabilities, HowItWorks, Bento, Security, CTA, Footer. *Gate: tsc + eslint + build.*
4. **Pass D — validation:** `npm run build`, full SSR marker check (all 11 content markers), **browser pass at 375 / 768 / 1024 / 1440** (no horizontal scroll), Lighthouse (LCP < 2.5s, INP < 200ms, CLS < 0.1 — dot grid is CSS, fonts via `next/font`, no new images → targets hold), code review (`code-reviewer-deepseek-flash`), tracker entry (Pass 40).
5. **Follow-ups:** update `docs/DESIGN.md` §8 (root `/` row: "landing page" instead of "redirects"), keep the rest of the doc intact.

---

## 8. Files touched

| File | Action |
|---|---|
| `frontend/src/app/layout.tsx` | Add Space Grotesk to `next/font` config |
| `frontend/src/app/globals.css` | Add display font token + blueprint grid tokens |
| `frontend/src/app/page.tsx` | Compose updated sections (imports) |
| `frontend/src/components/landing/Hero.tsx` | Restructure |
| `frontend/src/components/landing/ChatPreview.tsx` | → renamed/rewritten as `LivePipeline.tsx` |
| `frontend/src/components/landing/Capabilities.tsx` | Asymmetric rail + YAML artifact |
| `frontend/src/components/landing/HowItWorks.tsx` | Pipeline rail + scroll-drawn connector |
| `frontend/src/components/landing/FeatureBento.tsx` | Rhythm + artifact cells |
| `frontend/src/components/landing/Security.tsx` | Guardrail schematic (kills divide-y) |
| `frontend/src/components/landing/CtaSection.tsx` | Dark blueprint anchor |
| `frontend/src/components/landing/Nav.tsx` / `Footer.tsx` | Light touch |
| `frontend/src/components/landing/Reveal.tsx` | Mask/stagger variant upgrade |
| `docs/DESIGN.md` | §8 root row + typography section update |
| `tasks/remaining_tasks.md` | Pass 40 entry |

**Untouched by design:** login, dashboard, copilot, agents/changes/settings, workspace, all app tokens, backend, packages.
