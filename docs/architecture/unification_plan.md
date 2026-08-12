# Unified Platform Plan — Merging the Agent Builder & the Org Governance Engine

**Status:** Proposal — Phase 0 (planning)
**Owner:** Enlight Lab
**Scope:** One product, one brand, one dashboard, one chat, one auth system, one org-connection store, and one AI orchestrator that routes between the two existing engines (`Agentforge` → agent building, `OrgForge` → governed org customization) without the user ever sensing two products.
**Constraint:** Secure auth. No app breakage. Existing customers and code must keep working through the transition.
**Resolved fact:** Agentforge and OrgForge point at the **same Supabase project** but use **different schemas** (`public`/`salesforce` RPCs vs `orgforge.*`). This means a single-schema unification inside the same project is fully feasible — no cross-project data movement, no separate auth realms. Details in §9.
**Docs set (one product):** [`DECISIONS.md`](./DECISIONS.md) (decisions) · [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (tracker) · [`api_contract.md`](./api_contract.md) (frozen API) · [`PRD.md`](./PRD.md) (requirements) · [`API.md`](./API.md) (reference) · [`APP_FLOW.md`](./APP_FLOW.md) (flows) · [`TECH_STACK.md`](./TECH_STACK.md) (stack) · [`DESIGN.md`](./DESIGN.md) (design system) · [`PHASE5_PLAN.md`](./PHASE5_PLAN.md) (phase 5) · [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (audit) · legacy PRDs ([`OrgForge`](./legacy/OrgForge_PRD.md) · [`Agentforge`](./legacy/Agentforge_PRD.md))

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Naming](#2-product-vision--naming)
3. [The Current State (Facts We Must Preserve)](#3-the-current-state-facts-we-must-preserve)
4. [Decision Axes & Options (The "Different Ways" You Asked For)](#4-decision-axes--options)
5. [Recommended Architecture (End State)](#5-recommended-architecture-end-state)
6. [UX / Information Architecture — Simple by Design](#6-ux--information-architecture)
7. [Intent Routing — The "One Brain" Design](#7-intent-routing)
8. [Auth & Security Design](#8-auth--security-design)
9. [Unified Data Model & Migrations (Same Supabase Project)](#9-unified-data-model--migrations)
10. [Unified API Surface](#10-unified-api-surface)
11. [Frontend Build Plan](#11-frontend-build-plan)
12. [Onboarding & First-Run Experience](#12-onboarding--first-run-experience)
13. [Edge Cases & Solutions (The "Don't Break" Catalogue)](#13-edge-cases--solutions)
14. [Migration & Rollout (No-Breakage Guarantee)](#14-migration--rollout)
15. [Testing & QA](#15-testing--qa)
16. [Risks & Mitigations](#16-risks--mitigations)
17. [Open Decisions Needed From You](#17-open-decisions-needed-from-you)

---

## 1. Executive Summary

**Agentforge** (v6.4) builds, deploys, and tests Salesforce Agentforce agents from natural language. **OrgForge** (v1.0) performs governed, refusal-gated, fully-documented Salesforce org customization. They are siblings with 80% identical plumbing:

| | Agentforge | OrgForge |
|---|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind v4, `:3000` | Next.js 15/16, React 19, Tailwind v3, `:3000` |
| Backend | Express 5 **CommonJS**, `:3002` | Express 5 **ESM**, `:3001` |
| AI | `@google/generative-ai` (Gemini), ReAct tool loop | `@google/genai` (Gemini), structured intent pipeline |
| Streaming | SSE `/api/chat/stream` | SSE `/deployments/status-stream/*`, `/orgs/:id/index-stream` |
| Auth | **Custom JWT** (`agentforgeUserId`, `orgId`) + express-session | **Supabase Auth JWT**, RLS everywhere |
| Tokens | AES-256-GCM, `public` schema via RPCs | AES-256-GCM, `orgforge.org_connections` |
| Salesforce connect | OAuth PKCE + **background pre-flight diagnostics** (license, package, provisioning, self-healing) | OAuth PKCE + **manual install-first gate** + package-health check |
| Jobs | In-memory conversation map | Redis + BullMQ queues |
| Deploy | Render (API) + Vercel (web) | Render (API) + Vercel (web) |

**The unification strategy, in one paragraph:** Keep both engines running as **capability plugins** behind **one merged frontend and one merged API process**. Adopt **Supabase Auth as the single identity** (OrgForge already uses it; Agentforge's custom JWT is the weaker link and is retired via a one-time org re-link). Unify org connections into **one table with one OAuth flow per org** so both engines read the same encrypted credential row. Expose **one chat endpoint** whose orchestrator first classifies intent (`agent` / `org-change` / `both` / `clarify`) and then hands off to the right specialist engine. **Borrow Agentforge's connection logic wholesale** — connect first, then run background diagnostics that detect and self-heal missing packages, licenses, and provisioning instead of forcing a manual install gate. Ship it behind **feature flags with URL-level aliases**, so the old apps keep working until the new one is proven. The user experience is one simple product: **Dashboard** (a calm overview) and **Chat** (the copilot that does everything), with a short 3-step onboarding.

---

## 2. Product Vision & Naming

### 2.1 The product statement

> **One conversational copilot for the whole Salesforce org.** Ask it to *"list all my agents"* and it reaches into Agentforce. Ask it to *"modify an account"* and it opens a governed, refusal-gated change workflow. It is a single workspace where building AI agents and safely changing the org are two skills of the same assistant — never two websites.

### 2.2 Names

The requirement: **remove "Agent Forge" and "OrgForge" from everything the user sees.** Suggested replacement names (shortlist):

| Candidate | Why it works |
|---|---|
| **Enlight Forge** (or simply **Forge**) | Neutral, keeps the family identity, one word for one product |
| **ForgeOne** | Emphasizes "one product" |
| **Enlight Console** | Admin-tool framing, matches dashboard-first UX |
| **Forge Studio** | "Studio" signals build + create + manage |

Recommendation: **"Forge" by Enlight Lab** (with `Enlight Forge` as the full brand), because it lets both legacy capabilities live as internal feature names ("Agents" and "Org Changes") rather than product names.

**Renaming scope (do not touch code identifiers):**
- Replace in **user-visible strings only**: UI copy, chat greeting ("Hi, I'm your Agentforge AI assistant" → "Hi, I'm your Forge copilot"), metadata `<title>`/OG tags, landing pages, READMEs, docs, `BRAND.md`, favicon/logo alt text, email digests, `.agent` YAML `description` strings.
- **Keep internal identifiers unchanged** during migration: npm package names (`agentforge`, `orgforge-workspace`), Supabase schemas (`orgforge.*`), route prefixes, env var names, queue names, `AGENTS.md`. Renaming identifiers is a later, optional cleanup — never part of the merge.
- Add a **copy audit checklist** (§11.3) so no "Agentforge"/"OrgForge" string survives in the shipped UI.

### 2.3 Personas

| Persona | Primary surface | Needs |
|---|---|---|
| Salesforce Admin / Architect | Chat + Agents | Build/iterate/deploy agents, see impact of changes |
| Release/Change manager | Dashboard + Changes | Governed changes, approvals, refusal gates, audit trail |
| DevOps / Platform eng | Dashboard + Settings | Org connections, indexing health, integrations (GitHub) |
| Exec / reviewer | Dashboard | Read-only overview: agent count, open changes, risk posture |

---

## 3. The Current State (Facts We Must Preserve)

Audited from the two codebases (June–Aug 2026 state):

**Agentforge**
- Frontend routes: `/` marketing, `/chat` (builder), `/use-cases` gallery. Backend routes: `/api/auth/*`, `/api/internal/*` (AI Judge cron), `/api/org/health-check`, `/api/org/instance`, plus inline `/api/health`, `/api/agents`, `/api/chat/stream` (SSE), `DELETE /api/chat/:contextId`.
- Auth: Salesforce OAuth PKCE → custom JWT (`{agentforgeUserId, orgId}`, 7d) delivered via `?token=` query param, stored in `localStorage.auth_token`; fallback express-session; proactive token refresh with per-org promise dedup; `new_token` SSE event to rotate the JWT mid-stream.
- State: in-memory `activeConversations` Map keyed by `instanceUrl|contextId`; 15-min cleanup; 4h hard cap.
- **Connection logic (the crown jewel — §12 reuses this):** `orgConfigService.runPreFlightCheck` validates the instance URL, checks Einstein Agent license availability, checks the ECA package via the Tooling API (by **SubscriberPackageId**, so any installed version counts), dynamically discovers permission sets with an explicit fallback list, finds-or-creates the Einstein Agent user (reactivating it if deactivated), and assigns permission sets to both the agent user and the current admin — tolerating `DUPLICATE_VALUE` errors. The frontend caches results 24h in localStorage with promise dedup, runs checks **in the background**, shows an inline status banner instead of blocking modals, and **auto-invalidates + re-checks on 401/403** (`invalidateAndRecheck`).
- Tools (~24): `confirm_requirements`, `create_topic`, `create_action`, `attach_flow_action`, `attach_prompt_action`, `add_guardrail`, `configure_escalation`, `enable_knowledge`, `define_variable`, `add_transition`, `set_before_reasoning`, `set_after_reasoning`, `set_available_when`, `list_available_agents`, `load_agent_for_update`, `list_available_objects`, `get_object_schema`, `configure_remote_site`, `create_custom_object_with_data`, `set_instructions`, `update_agent_yaml`, `deploy_agent`, `list_available_flows`, `list_available_prompt_templates`, `generate_test_data`, `test_deployed_agent`.
- DB: `public.salesforce_connections` (via RPCs `upsert_salesforce_connection`, `get_salesforce_connection`, `update_salesforce_connection_tokens`), `public.ai_logs`, `public.ai_lessons`. Keys: `agentforge_user_id` (random UUID minted per express session), `org_id`, encrypted tokens.

**OrgForge**
- Frontend routes: `/` marketing, `/login`, `/dashboard`, `/workspace` (10-stage operator flow), `/history`, `/settings`.
- Backend `/api/v1/*`: auth (Supabase JWT verified server-side via `supabase.auth.getUser`), github, orgs (index/status/package-health/context/index-stream SSE), changes (intent/generate/clarify), impact, gates (REF-01..10), deployments (dry-run/execute/status-stream SSE), rollback, change-records.
- State: Redis + BullMQ (`orgIndexQueue`, `dependencyGraphQueue`, `selfImprovementQueue`, `deploymentQueue`); OAuth PKCE state in Redis (10-min TTL); package-health cache in Redis (10-min TTL).
- **Connection UX (the friction we are fixing):** the login page gates on a manual **"Install OrgForge Connector"** step (two hardcoded package URLs) *before* connecting; package health is then checked later in the workspace with a tri-state chip. This is reliable but manual and doesn't self-heal.
- DB: `orgforge.*` schema with full RLS (`auth.uid() = user_id`): `org_connections`, `org_indexes`, `change_intents`, `refusal_logs`, `change_records`, `ai_logs`, `ai_lessons`. GitHub connections live in `orgforge.github_connections` (added by migration 006).
- Security posture to preserve: tenantIsolation middleware, service-role-only token writes, query-string tokens only on GET/SSE, fail-closed BullMQ dashboard, HMAC-signed change records, sanitized error responses, rate limiting (global/auth/AI tiers), Zod everywhere, `aiSafety.js` whitelists (SOQL/XML validation).
- Tests: 73/73 backend unit tests; Playwright e2e (mocked APIs); frontend lint.

**Environment/deploy facts:** Agentforge API on Render `:3002`, OrgForge API on Render `:3001`, both frontends on Vercel `:3000`. Different ECAs per product. **Same Supabase project, different schemas.** Redis only in OrgForge.

---

## 4. Decision Axes & Options

### A. How to merge the two *websites* (the user-facing shells)

**A1 — One frontend app, one API, one domain (full merge).** One Next.js app serves the marketing page, login, dashboard, chat, agents, changes, orgs, settings. One Express API hosts both engines. One domain. Everything routes through a shared AppShell.
- ✅ The only option that truly feels like one product. ✅ Single auth session, single design system. ❌ Highest blast radius; must be phased with flags (§14).

**A2 — One frontend shell, two API services behind a gateway (interim).** One Next.js app; a thin gateway proxies `/api/forge/agents/*` → Agentforge backend and `/api/forge/org/*` → OrgForge backend. The browser only ever talks to one origin.
- ✅ Lowest-risk first step; both engines untouched. ✅ User cannot tell there are two backends. ❌ Double process cost; duplicated auth until §8 lands; cross-engine conversation context needs gateway-held state.

**A3 — Iframe/embedded portals (two sites, one chrome).** Wrap both existing apps.
- ❌ Rejected: duplicated auth, jarring context switches, and it literally preserves the "two websites" feel. Only acceptable as a *temporary* marketing redirect during Phase 1.

**Recommendation: A1 as the end state, reached through A2 as the first deployable milestone.**

### B. How to route intent between the two engines (the "one brain")

**B1 — One model, full combined toolset.** A single Gemini conversation exposes both toolkits (namespaced `agents_*`, `org_*`).
- ✅ Simplest mental model; seamless mixed conversations. ❌ One giant system prompt (Agentforge's is already ~1,600 lines); tool-confusion risk; OrgForge's refusal gates are a *pipeline*, not a single tool call, so the model can't fully "call" them.

**B2 — Classifier-first routing (recommended).** A cheap Gemini Flash classifier labels each message `agent` | `org_change` | `both` | `clarify`; the merged backend hands off to the specialist engine, whose proven prompt/toolset runs untouched. A shared session record carries context across handoffs.
- ✅ Each engine keeps its battle-tested prompt engineering → lowest regression risk. ✅ Classifier is small, testable, cacheable. ❌ Needs a handoff protocol; mixed requests must fan out.

**B3 — Hybrid: router + specialists with cross-capability handoff.** B2 plus one cross tool per specialist (`request_org_change(...)`, `request_agent_work(...)`).
- ✅ Handles messy real-world prompts. ❌ Slightly more surface area; handoff tools must be rate-limited and logged (highest-risk tools in the system).

**Recommendation: B2 now, evolve to B3.** Full spec in §7.

### C. How to unify authentication

**C1 — Supabase Auth everywhere (recommended).** Single identity = `auth.users`. Both engines' middlewares verify the same Supabase JWT (`supabase.auth.getUser(token)`). Agentforge's `getCredentialsFromToken` is rewritten to verify the Supabase JWT and resolve the org via the unified connection store. Retires the custom-JWT + express-session + `?token=` pattern.
- ✅ One login, one session, RLS across the whole product, automatic rotation, SSO-ready. ❌ Existing Agentforge sessions must be re-linked (one-time, §8.4).

**C2 — Two auth systems behind a session bridge.** ❌ Two tokens to manage, duplicated logout, legacy path lives forever. **Rejected.**

**C3 — Custom unified JWT (third system).** ❌ Rebuilds what Supabase already does, loses RLS/rotation/SSO. **Rejected.**

**Recommendation: C1.** Detailed design in §8.

### D. How to unify the org-connection store

**D1 — One table, both engines read it (recommended).** Migrate `salesforce.salesforce_connections` rows into `orgforge.org_connections` (or a new `forge.org_connections`), add `capabilities text[]` and `legacy_agentforge_user_id`. One OAuth flow per org; both engines resolve credentials through one service.
- ✅ Single source of truth; one encrypted-token format; one `ENCRYPTION_KEY`. ❌ Needs a migration + a decision on which key wins (§9.3).

**D2 — Keep both tables, sync on connect.** ❌ Duplicated credentials, double encryption, drift risk. **Rejected.**

**Recommendation: D1.** Because both apps share the same Supabase project, this is a same-database table migration — no cross-project data movement.

### E. How to merge the codebases physically

**E1 — Monorepo, two engines mounted in one API (recommended).** Keep `Agentforge/` and `OrgForge/` runnable; add a `unified-forge/` app with one Next.js frontend and one Express entry that mounts both engines' routers, plus shared packages (`packages/auth`, `packages/org-connections`, `packages/ai`).
- ✅ Lowest immediate risk; both engines keep their tests. ✅ Handles the **CommonJS vs ESM** friction via an adapter instead of a day-one rewrite. ❌ Some duplicated code until Phase-4 cleanup.

**E2 — Rewrite both into a fresh codebase.** ❌ Months of work, throws away tested code. **Rejected.**

**E3 — Keep two repos, integrate via API only.** ❌ No shared auth/data, slow calls. **Rejected for the end state;** acceptable only as the Phase-1 gateway.

**Recommendation: E1.**

---

## 5. Recommended Architecture (End State)

```
                        ┌──────────────────────────────────────────────┐
                        │  forge.enlightlab.com  (ONE Next.js app)      │
                        │  /  /login  /dashboard  /chat  /agents       │
                        │  /changes  /orgs  /settings                  │
                        └──────────────┬───────────────────────────────┘
                                       │ same-origin /api/v1/* (rewrite)
                                       ▼
        ┌────────────────────────────────────────────────────────────────┐
        │  ONE Express API  (:3001)   — "Forge API"                      │
        │  ┌──────────────────────────────────────────────────────────┐  │
        │  │ authMiddleware (Supabase JWT) → req.user (auth.users.id) │  │
        │  │ tenantIsolation → RLS-scoped client                      │  │
        │  ├──────────────────────────────────────────────────────────┤  │
        │  │ CAPABILITY: agents  (native backend/src/agentforge ESM)       │  │
        │  │   /api/v1/chat/stream  (SSE)  ·  /api/v1/agents          │  │
        │  │   /api/v1/org/health-check · /api/v1/internal/*          │  │
        │  ├──────────────────────────────────────────────────────────┤  │
        │  │ CAPABILITY: org-change (native backend/src/orgforge ESM)     │  │
        │  │   /api/v1/orgs · /api/v1/changes · /api/v1/impact        │  │
        │  │   /api/v1/gates · /api/v1/deployments · /api/v1/rollback │  │
        │  │   /api/v1/change-records · /api/v1/auth/github           │  │
        │  ├──────────────────────────────────────────────────────────┤  │
        │  │ UNIFIED: /api/v1/chat/route (classifier)                 │  │
        │  │          /api/v1/diagnostics (pre-flight, Agentforge)    │  │
        │  │          /api/v1/session (context handoff store)         │  │
        │  └──────────────────────────────────────────────────────────┘  │
        └───────────────┬──────────────────────┬───────────────────────┘
                        │                      │
              ┌─────────▼─────────┐   ┌────────▼─────────────┐
              │ Supabase (ONE     │   │ Redis + BullMQ       │
              │ project, forge.*  │   │ queues + OAuth state │
              │ schema + RLS)     │   │ + session store      │
              └───────────────────┘   └──────────────────────┘
```

### 5.1 Native one-folder architecture (no more mounted legacy engines)
**Implemented (Passes 32–33).** Both legacy engines are now **first-class in-repo modules**, not externally mounted routers:

- OrgForge's backend lives at **`backend/src/orgforge/`** — its 9 routers, BullMQ jobs + workers, services (aiOrchestrator, skillResolver, refusalGateEngine, impactAnalyzer, changeRecordService, metadataTransport, …) and utils, with auth rebased onto the shared `@forge/auth` middleware (`createAuthMiddleware`/`tenantIsolation` — identical `req.user`/`req.tenantId`/`req.supabaseClient` contract; OrgForge's duplicated middleware deleted).
- Agentforge's engine lives at **`backend/src/agentforge/`** — the `ConversationManager`, `salesforceClient`, and supporting services converted **CJS→ESM** by the `backend/scripts/portAgentforge.mjs` codemod.
- **No `../OrgForge` / `../Agentforge` import exists anywhere**; the `@forge/compat` CJS adapter was retired (§5.2). The legacy sibling repos were archived to `/Users/abhi/Enlight/archive/` (Pass 33) — the app is fully self-contained.
- **One process:** `backend/src/index.js` mounts the ported routers natively, starts the 4 BullMQ job workers, and registers the nightly self-improvement job (all gated on `FORGE_UNIFIED_API=on`).
- **Route surface unchanged:** OrgForge's `/api/v1/*` paths stay byte-identical. Agentforge's capability routes live under `/api/v1/agents/*` + `/api/v1/chat/stream`, and the legacy `/api/auth` + `/api/org` alias mounts are still served from the ported routers behind `FORGE_MOUNT_AGENTFORGE=on` for the transition.
- Old production URLs keep working until the flag flips; then they 301 to the new domain (Phase 5 §4.3).

### 5.2 Module-system bridge (CommonJS ↔ ESM) — resolved (Pass 32)
- The interim bridge is **gone**: Agentforge's CJS sources were converted to **ESM** (the `backend/scripts/portAgentforge.mjs` codemod — top-level `require()` → `import` with `.js` extensions, `module.exports = {a, b}` → `export {a, b}`, `module.exports = new X()` → `export default`, `require('dotenv').config()` → `import 'dotenv/config'`). The entire API is ESM end to end.
- `packages/compat/cjsRouter.js` (the CJS adapter) was deleted with its last consumer — `@forge/compat` was removed from the workspace (PHASE5 §4.1 executed early).

### 5.3 Shared services to extract first (highest leverage, lowest risk)
1. `packages/auth` — `requireAuth` (Supabase `getUser`), `tenantIsolation`, token-in-query only for GET/SSE.
2. `packages/org-connections` — unified read/refresh/encrypt/decrypt (merge OrgForge `orgCredentials` + Agentforge refresh-dedup).
3. `packages/diagnostics` — the **pre-flight checker** (Agentforge's `orgConfigService`) extended to cover both capabilities (see §12.4).
4. `packages/ai` — the classifier (`routeIntent`) and the SSE event envelope.
5. `packages/audit` — HMAC change-record signing extended to agent deployments (one product-wide ledger).

### 5.4 What stays separate (deliberately)
- The two **LLM system prompts** stay in their own modules (fine-tuned and huge). Only the routing layer is new.
- BullMQ worker files stay per-capability, all started from the one unified process (`backend/src/orgforge/workers.js`, gated on `FORGE_UNIFIED_API=on`).

### 5.5 Ports & dev environment
- Unified API on **:3001**; unified frontend on **:3000** (rewrites `/api/*` → `:3001`).
- The legacy Agentforge API (`:3002`) and legacy frontends (`:3003`/`:3004`) are **archived** (Pass 33) — comparison testing now uses the archived tree only; no legacy server is part of the product.
- Dev scripts: `npm run dev:web` + `npm run dev:api` + a local Redis; document the `next build` vs `next dev` `.next` conflict already noted in the OrgForge docs.

---

## 6. UX / Information Architecture — Simple by Design

### 6.0 Design principles (the "not too much" rule)

The merged product must feel **lighter than either legacy app**. Every screen follows these rules:

1. **One primary action per screen.** The dashboard has exactly one hero action ("Ask Forge"); the chat has one input; onboarding has one "next" button. Everything else is secondary.
2. **Two levels of depth max.** The happy path lives on one page. Anything deeper (the 10-stage workspace, per-org capability toggles, GitHub internals) is hidden behind an explicit "Advanced" affordance (progressive disclosure).
3. **Copilot-first, list-pages-second.** Building agents and requesting org changes both happen in the **Chat**. The Agents and Changes pages are quiet read-only lists that link back into chat. No duplicated forms.
4. **Say it in one sentence.** Every panel gets a one-line plain-English caption. No jargon chips (`ECA VAULT ACTIVE`, `REF-04`, `SESSION ACTIVE`) in the default view — technical detail moves into tooltips and the Advanced view.
5. **Status is calm.** Health problems show as one inline banner with one action ("Install package", "Reconnect", "Retry") — never a wall of modals. Adopt Agentforge's background-check-with-banner pattern everywhere (§12.4).
6. **Whitespace > widgets.** Max 3–4 cards on the dashboard. Generous spacing, one accent color, consistent radius/shadow. No dense dashboard walls.

### 6.1 Global shell

```
┌────────────────────────────────────────────────────────────────────┐
│ TOP BAR   [☰]  FORGE ······················ [org pill] [avatar ▾] │
├───────────┬────────────────────────────────────────────────────────┤
│ SIDEBAR   │                                                        │
│ ◆ Dashboard                                                       │
│ 💬 Copilot (Chat)   ← primary destination for work                │
│ 🤖 Agents (read-only list)                                        │
│ 🛡 Changes & Audit (read-only list)                               │
│ ⚙ Settings                                                        │
└───────────┴────────────────────────────────────────────────────────┘
```

- **Sidebar** (OrgForge `Sidebar.tsx`, slimmed to 5 items; Org connections live inside Settings and the org pill, not a top-level page — fewer items = simpler).
- **Top bar** (OrgForge `Header.tsx`): live org pill (type-aware), package/diagnostics chip (only when something needs attention), avatar menu (profile, sign out).
- **Global org switcher** as the single "active org" context (React context + localStorage) shared by both engines. Switching orgs clears in-flight chat context with a confirm (EC-25).

### 6.2 Dashboard (the calm home)

Layout (max 4 sections, in order):

1. **Hero row** — "Welcome back" + one big **Ask Forge** button (primary action) + the org pill. That's it.
2. **Three stat tiles** (clickable, link to the list page): **Agents** (count + last deployed), **Open changes** (count + 1 awaiting approval), **Audit trail** (recent record). Clicking a tile deep-links into chat with a pre-filled prompt ("List my agents", "What changes are pending?").
3. **One attention banner** — only when something is wrong (package missing, license unsupported, org disconnected, indexing stale). One action per banner (§12.4).
4. **Recent activity feed** — the only scrolling list: agent builds/deploys + org change records in one reverse-chronological feed, rendered by one shared `ActivityCard`. This is where "two products" most often leaks — both event types must use one visual language.

Empty states: no org → single "Connect Salesforce" CTA (the whole dashboard collapses to one button). No agents → "Ask Forge to build your first agent". No changes → "Request a governed change".

### 6.3 The Chat (Copilot) — the center of everything

Reuse **Agentforge's `/chat` page** as the skeleton (SSE reader with chunk buffering, markdown renderer, `CodeBlock`, `BuildProgressCard`, file upload, abort/stop, clear-chat). Add, **minimally**:

1. **Capability chip** — a small pill above the input showing what the copilot believes the *current* turn is: `Agents` / `Org Change` / `Both`. Clickable to override. This is the visible proof routing works, and the manual escape hatch for mis-routes (EC-22). Low visual weight.
2. **Unified inline cards** — Org-change flow renders **inside the chat** as compact cards (intent summary → artifact tabs (Monaco) → blast radius → refusal gates with unblock → dry-run → deploy → signed record). Reuse OrgForge's cards as embeddable chat-card variants. No page jump for the happy path; the full 10-stage workspace remains an "Open in advanced view" link for complex approvals.
3. **Starter prompts** — 4 chips under the empty chat ("Build a support agent", "List my agents", "Add a validation rule to Opportunity", "Show recent changes") so new users understand scope without reading docs.
4. **File upload + PRD** stays (Agentforge's multer pipeline) — a document describing *org changes* now routes to the org engine too.

### 6.4 Supporting pages

- **Agents (`/agents`)** — read-only list from `GET /api/v1/agents`: name, description, status; "Open in chat to update" per row. Detail drawer shows YAML + actions (from `load_agent_for_update`).
- **Changes & Audit (`/changes`)** — OrgForge `/history` renamed; change records + refusal log + CSV export; "Request a change" button deep-links to chat with a starter prompt.
- **Settings (`/settings`)** — three tabs only: **Connections** (org cards, re-index, disconnect, connect new), **Integrations** (GitHub audit repo; skip state allowed), **Advanced** (capabilities per org, diagnostics re-run, technical details, legacy 10-stage workspace link).
- **Workspace (`/workspace`)** — OrgForge's 10-stage stepper kept **verbatim as the Advanced view**, linked from chat cards and Settings→Advanced. Power users get full governance depth; default users never see it.

### 6.5 Design-system unification (one look)

- **Standardize on Tailwind v4** (Agentforge's setup); port OrgForge's `brand-*` palette into a shared `@theme` tokens file with a compatibility mapping so existing class names keep working during transition.
- **One token spec** (`packages/design-tokens`): primary `#1A6BFF`, dark `#0A0F1E`, surfaces/borders, semantic colors (success / warning / **refusal**), Inter + Fira Code (artifacts), radii, shadows, motion EASE, z-scale.
- **Component inventory mapping**:

| Component | Source | Fate |
|---|---|---|
| `Button`, `Badge`, `ErrorBanner`, `Input`, `Card`, `OrgCard` | OrgForge | Keep, restyle to shared tokens |
| `CodeBlock`, `BuildProgressCard`, markdown renderer, chat SSE reader, diagnostics service | Agentforge | Keep, reuse in Copilot |
| `AppShell`/`Sidebar`/`Header` | OrgForge | Become the global shell (slimmed) |
| `BlastRadiusCard`, `RefusalGateCard`, `ArtifactViewer`, `DryRunPanel`, `DeployPanel`, `ChangeRecordCard` | OrgForge | Keep + new "inline chat card" variants |
| `PreFlightDiagnosticModal`, `SetupRequiredModal`, `IndexingProgressModal`, package-health chip | both | Merge into one `StatusBanner` family (banner-first, modal only for irreversible actions) |
| `StageTimeline` | OrgForge | Keep for the Advanced workspace only |

- **Theme:** light default (both apps are light); glassmorphism accents only on the chat; solid surfaces for lists. Dark mode later.

### 6.6 Accessibility & responsiveness
- Preserve OrgForge's a11y care (drawer `invisible` handling, `aria-expanded`, focus states). Audit the new Copilot for contrast. Mobile: drawer nav, responsive grids, chat input not hidden behind the keyboard.

---

## 7. Intent Routing — Detailed Design

### 7.1 The routing protocol

```
User message + active org
        │
        ▼
[1] Classifier (routeIntent)  ── Gemini Flash, ~200 tokens, <1s
        │  output: { capability: "agent" | "org_change" | "both" | "clarify",
        │            confidence, reason }
        ▼
[2] Router (deterministic rules, applied AFTER the model):
        - capability == "agent"        → Agent engine (ConversationManager)
        - capability == "org_change"   → Org pipeline (intent → generate → impact → gates → dry-run → deploy)
        - capability == "both"         → sequential: primary first, then handoff (B3) or queue
        - capability == "clarify"      → ask user (no engine call)
        - hard overrides: "refund"/"delete field"/"validation rule"/"permission set" → org_change
        - user pinned capability via UI chip → bypass classifier
        ▼
[3] Specialist engine runs its existing pipeline, emitting SSE events
        ▼
[4] SSE envelope includes capability + card type so the UI renders correctly
```

### 7.2 Classifier prompt spec (draft)

```
You route a message to one of two Salesforce copilot capabilities.
"agent": building, updating, deploying, listing, testing Agentforce agents
         (topics, actions, instructions, guardrails, flows attached to agents,
         custom objects created FOR an agent, agent YAML).
"org_change": modifying the org itself via governed metadata changes
         (custom objects/fields OUTSIDE agent work, validation rules, record
         types, permission sets, sharing rules, OWD, flows as org automation,
         Apex classes, tabs, layouts, list views, report types).
"both": the request needs both capabilities in one turn.
"clarify": ambiguous, no capability matched, or unsafe.

Examples:
- "list all my agents"                        → agent
- "build an agent that checks order status"   → agent
- "update the Status__c field on my Support_Ticket__c object" → org_change
- "add a validation rule to Opportunity"      → org_change
- "change Account layout and also create an agent for sales" → both
- "what's the weather?"                       → clarify (refuse)

Return ONLY JSON: {"capability": "...", "confidence": 0.0-1.0, "reason": "..."}
```

Cache: group consecutive same-capability messages into one engine session; only re-route when the classifier output flips or the user overrides.

### 7.3 Session/context handoff store

- New `forge.chat_sessions` (or Redis keys): `session_id`, `user_id`, `org_id`, `capability_segments[]` (ordered list of `{capability, engineRef, startedAt, lastMessageAt, summary}`), `compressed_history`.
- Each engine keeps its own internal state (Agentforge `ConversationManager`; OrgForge intent rows) but the **session row is the shared spine** — "list my agents" then "now make the second one use my new field" works across engines.
- Agentforge's in-memory Map becomes **keyed by Supabase `user_id` + org** and moves to Redis in the merged process (survives restarts; matches OrgForge's Redis dependency).

### 7.4 Trust & safety for routing
- Classifier output is advisory, never authoritative: deterministic overrides, a UI override, and "ask when unclear" default.
- Both engines' existing guardrails remain the final word. The router may only *decide which engine hears the request*; it can never weaken either engine's refusals.
- Log every route decision (`forge.routing_log`): prompt hash, capability, confidence, override source — feeds the lessons loop.

---

## 8. Auth & Security Design

### 8.1 Target model (C1)

- **One identity:** Supabase Auth. Login page = OrgForge's `/login` (email/password, Google OAuth, or SSO as configured). After sign-in, the frontend holds the Supabase session.
- **One middleware:** `requireAuth` (verified via `supabase.auth.getUser(token)`) + `tenantIsolation` applied to **every** route in the merged API, **including the mounted Agentforge routes** — the single most important change (Agentforge endpoints currently trust a self-signed JWT + session cookie).
- **Legacy Agentforge JWT retired.** No new `?token=` redirects, no `localStorage.auth_token`, no `new_token` SSE event. Chat SSE stays JWT-header based (POST); query-string token only on GET where EventSource requires it.

### 8.2 Salesforce OAuth (single flow for both capabilities)

- One ECA config per environment; scope = union: `api web refresh_token einstein_gpt_api full sfap_api openid id` (keep `full` because Agentforge provisioning currently requires it — flag for review, §17).
- PKCE + Redis state (OrgForge's implementation, 10-min TTL) — replaces Agentforge's express-session-held verifier so the flow survives restarts and scales.
- After callback: upsert the unified `org_connections` row (`capabilities` = both by default), enqueue indexing, **launch background diagnostics** (§12.4), redirect to the **Dashboard** with a success toast. No install-first gate.

### 8.3 Token lifecycle & storage

- Salesforce tokens: AES-256-GCM with **one** `ENCRYPTION_KEY` (§9.3). Refresh on the 5-minute margin with Agentforge's per-org promise dedup; refresh failure → 401 → "Reconnect org" (EC-10/EC-11).
- Supabase session: **httpOnly, SameSite=Lax, Secure cookie** in production (supabase-js cookie mode) instead of localStorage — kills the XSS token-theft vector of the current `localStorage.auth_token` pattern. Dev keeps localStorage for parity; ship cookie mode with the unified app (decision §17).
- Secrets: `JWT_SECRET`, `SESSION_SECRET` deleted (no longer used); `ENCRYPTION_KEY`, `HMAC_SECRET`, `CRON_SECRET`, `ADMIN_USER/PASS`, Redis, Supabase service-role remain.

### 8.4 One-time session/org re-link (the migration that keeps customers)

Problem: Agentforge connections are keyed by `agentforge_user_id` (a random UUID per browser session); OrgForge keys by `auth.users.id`. Same Supabase project → same database, so this is a pure table re-parent.

1. Add `legacy_agentforge_user_id` column to `org_connections` (nullable).
2. On first sign-in with the new app, the frontend reads any leftover `localStorage.auth_token` (legacy JWT), sends it once to `POST /api/v1/auth/link-legacy` with the Supabase JWT; the server verifies the legacy JWT, re-parents all `salesforce_connections` rows with that `agentforge_user_id` to the signed-in `auth.users.id`, and records the legacy id for audit.
3. Legacy JWT destroyed client-side; `auth_token` key removed.
4. Orgs that can't be re-linked (cookie cleared long ago) simply re-connect via the one OAuth flow — no data loss (the orgs live in Salesforce).

This is a **best-effort convenience, never a blocker** (EC-39).

### 8.5 Hardening checklist carried into the merge (keep everything)

- helmet + CORS exact-origin allowlist + credentials
- Rate limiting (global / auth / AI tiers from OrgForge) applied to Agentforge routes too
- Zod validation on every boundary; sanitized error responses; JSON 404s
- Fail-closed BullMQ dashboard; query-string tokens only on GET/SSE; sanitized morgan output
- `aiSafety.js` whitelists stay in the org engine; Agentforge's `sanitizeForLog` applied to the unified `ai_logs` writer
- Signed change records (SHA-256 HMAC) extended to agent deployments — one tamper-evident ledger

### 8.6 Threat model recap

| Threat | Mitigation |
|---|---|
| XSS stealing a session token | httpOnly Secure cookie (prod); CSP hardening; no tokens in URL |
| Cross-tenant org access | RLS on every table + explicit ownership checks in service-role paths (extend to agent routes) |
| Stolen Salesforce refresh token | AES-256-GCM at rest, one env key, refresh dedup, rotate on reconnect |
| CSRF on state-changing endpoints | SameSite cookies + JWT header auth; verify Origin in cookie mode |
| Prompt-injection steering the router | Classifier advisory-only; deterministic overrides; engines' refusals final; routes logged |
| OAuth state replay | PKCE + one-time Redis state, 10-min TTL, deleted on use |
| Abuse of handoff tools (B3) | Strict rate limits + per-user caps + audit log |

---

## 9. Unified Data Model & Migrations (Same Supabase Project)

### 9.1 What "same project, different schemas" means for us

Both apps already write to the **same Supabase instance** — Agentforge via `public` RPCs (`upsert_salesforce_connection`, `get_salesforce_connection`, `update_salesforce_connection_tokens` + `ai_logs`/`ai_lessons`) and OrgForge via the `orgforge` schema. No cross-project sync, no auth-domain mismatch: the migration is a same-database consolidation.

**Recommendation: a new `forge` schema with views** mapping the old names so legacy queries/tests keep working during transition, then a final optional rename.

```
forge.org_connections
  id uuid PK, user_id uuid (auth.users), org_id varchar(18), org_type,
  alias, instance_url, encrypted_tokens, capabilities text[] DEFAULT '{agents,org_change}',
  context_indexed_at, legacy_agentforge_user_id, created_at, updated_at,
  UNIQUE(user_id, org_id)

forge.agents            -- NEW: agent inventory cache (id, org_id, developer_name,
  label, description, status, yaml_ref, last_deployed_at, user_id)
  -- populated from sfClient.getAgents + deploy_agent events; powers /agents page

forge.change_intents    -- from orgforge.change_intents (+ source: 'chat'|'workspace')
forge.refusal_logs      -- from orgforge.refusal_logs
forge.change_records    -- from orgforge.change_records (now also records agent deploys:
                         kind: 'org_change' | 'agent_deploy')
forge.org_indexes       -- from orgforge.org_indexes
forge.ai_logs           -- merged writer for BOTH engines (agent builds + org changes)
forge.ai_lessons        -- from orgforge.ai_lessons + public.ai_lessons (merge + dedupe)
forge.chat_sessions     -- new (§7.3)
forge.routing_log       -- new (§7.4)
forge.diagnostics       -- new: last pre-flight result per (user, org) — moves the
                         localStorage 24h cache to the server (EC-21)
```

### 9.2 RLS (mirror OrgForge's proven policies)

`ENABLE ROW LEVEL SECURITY` on every table; `USING (auth.uid() = user_id)` on user-scoped tables; `org_indexes` scoped via join to `org_connections`. Service-role client bypasses RLS but every such path does an explicit ownership check (`tenantIsolation` + `.eq('user_id', req.tenantId)`).

### 9.3 The two encryption-key question

Agentforge and OrgForge each have their own `ENCRYPTION_KEY`. After merge there is **one**. Options:
- (a) **Re-connect orgs** (drop both token sets; users re-connect once via the re-link flow) — simplest, zero crypto work. **Recommended for v1.**
- (b) Server-side re-encrypt migration — only if downtime-free re-connect is unacceptable.

Same logic for `HMAC_SECRET`: legacy records keep their old signatures (verified with the secret recorded at signing time); new records use the new secret.

### 9.4 Migration order & safety

1. Create `forge` schema + views (additive; nothing dropped).
2. Backfill `forge.org_connections` from `orgforge.org_connections` (idempotent).
3. Re-link flow (§8.4) folds in `salesforce.salesforce_connections` rows per user.
4. Point the unified API at `forge.*`; keep `orgforge.*`/`public` untouched for the legacy apps.
5. Cut over frontends; **never delete** legacy tables until Phase-5 sign-off.

---

## 10. Unified API Surface

### 10.1 Endpoint map

| Area | Endpoint | Source |
|---|---|---|
| Auth | `POST /api/v1/auth/login` (Supabase, client-side), `GET /api/v1/auth/salesforce/connect`, `GET /api/v1/auth/salesforce/callback`, `POST /api/v1/auth/link-legacy`, `POST /api/v1/auth/logout` | OrgForge + new |
| Copilot | `POST /api/v1/chat/stream` (SSE, multer), `DELETE /api/v1/chat/:contextId`, `POST /api/v1/chat/route` (classifier, standalone) | Agentforge + router |
| Diagnostics | `GET /api/v1/diagnostics` (unified pre-flight, cached server-side), `POST /api/v1/diagnostics/recheck` | Agentforge, extended |
| Agents | `GET /api/v1/agents`, `GET /api/v1/agents/:developerName` | Agentforge (new detail) |
| Orgs | `GET/POST/DELETE /api/v1/orgs`, `POST /api/v1/orgs/:orgId/index`, `GET /:orgId/status`, `/package-health`, `/context`, `/index-stream` (SSE) | OrgForge |
| Changes | `POST /api/v1/changes/intent`, `/generate`, `GET /changes/:intentId`, `POST /changes/:intentId/clarify` | OrgForge |
| Impact | `POST /api/v1/impact/:intentId/impact-brief` | OrgForge |
| Gates | `POST /api/v1/gates/evaluate` | OrgForge |
| Deploy | `POST /api/v1/deployments/dry-run`, `/execute`, `GET /deployments/status-stream/:id` (SSE) | OrgForge |
| Rollback | `POST /api/v1/rollback` | OrgForge |
| Records | `GET /api/v1/change-records`, `GET /api/v1/activity` (unified feed) | OrgForge + new |
| GitHub | `GET/POST/DELETE /api/v1/auth/github/*` | OrgForge |
| Internal | `POST /api/v1/internal/run-ai-judge` (CRON_SECRET) | Agentforge |
| Health | `GET /api/v1/health`, `GET /api/v1/health/db` | OrgForge (+ new tables) |

**Compatibility aliases (one release):** `/api/chat/stream`, `/api/agents`, `/api/org/*`, `/api/auth/*`, `/api/health` continue to work as thin re-exports, removed after the old frontend is decommissioned.

### 10.2 Unified SSE event envelope

```json
{ "type": "message|status|action|error|build_widget|stream_chunk|deploy|deploy_success|deploy_warning|deploy_error",
  "capability": "agent|org_change",
  "content": "...",
  "summary": "...",
  "errors": [{"component":"...","problem":"..."}],
  "card": "blast_radius|refusal_gates|artifact|dry_run|deploy|record|build_progress"
}
```

`type` keeps Agentforge's vocabulary (its chat page already handles these); `capability` and `card` are additive so the existing renderer doesn't break. OrgForge's pipeline endpoints keep their own JSON/SSE shapes (called by panels, not the chat).

---

## 11. Frontend Build Plan

### 11.1 Target app layout

```
unified-forge/
├── frontend/                    # ONE Next.js app (port 3000)
│   └── src/app/
│       ├── (marketing)/page.tsx        # merged landing
│       ├── login/page.tsx              # Supabase login + onboarding (§12)
│       ├── (app)/                      # authenticated shell (AppShell)
│       │   ├── dashboard/page.tsx
│       │   ├── chat/page.tsx           # Agentforge chat + capability chip
│       │   ├── agents/page.tsx
│       │   ├── changes/page.tsx        # OrgForge history
│       │   ├── workspace/page.tsx      # OrgForge 10-stage (Advanced)
│       │   └── settings/page.tsx
├── backend/                     # ONE Express entry (port 3001)
│   └── src/index.js             # native: mounts backend/src/orgforge + backend/src/agentforge
├── packages/
│   ├── auth/  org-connections/  diagnostics/  ai/  audit/  design-tokens/
└── supabase/migrations/007_*    # forge schema, views, RLS
```

### 11.2 Build sequence

1. **AppShell + auth gate** — OrgForge `(dashboard)/layout.tsx` + `AppShell/Sidebar/Header`, slimmed and rethemed.
2. **Copilot** — copy Agentforge `chat/page.tsx` + `diagnosticService.ts`; swap API base to `/api/v1/chat/stream`; add capability chip + inline org-change cards.
3. **Dashboard** — new minimal composition (hero + 3 tiles + attention banner + activity feed).
4. **Agents page** — thin read-only page over `GET /api/v1/agents`.
5. **Rename pass** (§11.3) across all copied components.
6. **Settings/Changes/Orgs/Workspace** — port from OrgForge as-is first, restyle after.

### 11.3 Brand/copy audit checklist

- [ ] Replace "Agentforge"/"Agent Forge" in all UI strings, chat greeting, metadata titles/OG/twitter, README/BRAND.md, `AGENTS.md`, email digest templates
- [ ] Replace "OrgForge" similarly (incl. Header "Governance v1.0" pill → "Forge v1")
- [ ] Update favicons/og-image/logo alt text; keep *asset files* (URLs in env, e.g. `ai-mvp.enlightlab.com/logo.png`) pointing at the same CDN so nothing 404s
- [ ] Update `metadataBase`, canonical, `robots` for the new domain
- [ ] Grep the built bundle before shipping: `grep -ri "orgforge\|agentforge" frontend/src` should return only code identifiers deliberately kept
- [ ] Salesforce-facing copy (ECA names, package names) stays unchanged — renaming breaks installs

### 11.4 Dev-experience notes

- `.env.example` = union of both env tables minus retired secrets (`JWT_SECRET`, `SESSION_SECRET`).
- Document the `next dev`/`next build` `.next` conflict in the merged README.
- Add a merged `npm run typecheck` and keep per-app lint.

---

## 12. Onboarding & First-Run Experience

### 12.1 Goals

- **Connect Salesforce easily** (the user's explicit ask) — one click to OAuth, then everything else happens in the background.
- **Connect GitHub easily during onboarding** — one click install + one repo pick, and it must be skippable without punishment.
- **Handle the "package not installed" class of edge cases inline** — detect, explain in plain English, offer one action, allow re-check — instead of a manual install-first gate.

### 12.2 The 3-step flow

```
Step 1: Sign in (Supabase)          →  /login
Step 2: Connect Salesforce          →  choose Production / Sandbox / Scratch
        (OAuth PKCE → callback)
Step 3: Ready — optional GitHub     →  "Connect GitHub audit log?" [Connect] [Skip]
        Landing: Dashboard
```

**Step 2 replaces OrgForge's install-first gate with Agentforge's connect-first pattern:**

| Current (OrgForge) | New (unified) |
|---|---|
| "Install OrgForge Connector" is Step 1, required, manual URLs | Connect first. After OAuth, **background diagnostics** auto-detect the package state |
| Package check happens later in the workspace | Package state streams into an inline banner on the Dashboard + chat, with one-click install link + "I've installed it — re-check" |
| No license/provisioning checks | Full Agentforge pre-flight (license, package, permission sets, agent user provisioning) runs after connect and on every re-check |
| GitHub mentioned as a later Settings task | GitHub is an explicit, optional Step 3 with a one-click install URL + repo picker |

### 12.3 Step-3 GitHub details (easy, skippable)

- After the org connects, a compact card appears: "**Connect GitHub audit log (optional)** — your signed change records get committed to a repo."
- Buttons: **Connect** (opens the OrgForge GitHub App install URL in a new tab; on callback the app lands back on `/settings?github=install&installation_id=...` with the repo picker ready) and **Skip** (dismisses; the same flow stays one click away in Settings → Integrations; a subtle "Connect GitHub" nudge remains in Settings only).
- Edge cases handled inline: GitHub App not configured server-side → hide the card (EC-44); pending claim expired → "start again" (EC-45); no repos granted → explain how to grant access (EC-46).

### 12.4 The unified diagnostics service (Agentforge's logic, product-wide)

Extend Agentforge's `orgConfigService.runPreFlightCheck` into `packages/diagnostics` — the single org-health brain used by onboarding, dashboard, chat, and agents:

1. **Validate instance URL** (hostname allowlist, https-only) — reused.
2. **License check** — Einstein Agent license exists and has seats (reused).
3. **Package check** — ECA installed **by SubscriberPackageId** (any version counts; handles upgrades), via Tooling API with fallback (reused). Extend to check *both* ECA packages if we keep two during transition, and the single unified ECA afterward.
4. **Provisioning** — discover permission sets (dynamic + fallback list), find-or-create the Einstein Agent user (reactivating if deactivated), assign permission sets to agent user + admin, tolerating `DUPLICATE_VALUE` (reused).
5. **Org-type detection** — query `Organization.IsSandbox` and correct `org_type` if the user picked wrong (EC-13).
6. **Capability split** — the result is per-capability: `agents` checks license+package+provisioning; `org_change` needs package + valid token only. A missing Agentforce license blocks agent work but not org changes (EC-16).
7. **Caching & reactivity** — result cached **server-side** in `forge.diagnostics` (24h TTL, promise dedup), replacing the localStorage cache; auto-invalidate + re-check on any 401/403 or package-related error (Agentforge's `invalidateAndRecheck` behavior, EC-14).
8. **Presentation** — always a **banner**, never a blocking modal, except the one modal for "package missing" which offers the install link + re-check (kept from Agentforge's `SetupRequiredModal`).

Diagnostics state machine (shared by all surfaces): `checking → ok | attention(missing_package | license_unsupported | provisioning | disconnected) | error`.

---

## 13. Edge Cases & Solutions (The "Don't Break" Catalogue)

> This section is the operational core of the plan. Every scenario below is something that would otherwise break a user's session, a deployment, or trust in the product. Each has an owner-agnostic solution; implementation notes reference the existing code that already solves part of it.

### 13.1 Auth & session

| ID | Scenario | Why it breaks today | Unified behavior |
|---|---|---|---|
| EC-01 | Supabase session expires **mid-SSE stream** | Stream dies silently; user loses context | Client detects the terminal `error`/401 frame and shows "Session expired — sign in again" with the draft preserved (never clear input). Backend aborts generation cleanly (`req.on('close')` already does). No token rotation mid-stream needed anymore — on next message, `requireAuth` 401 → UI re-auth. |
| EC-02 | Stale `localStorage.auth_token` (legacy JWT) after merge | New app ignores it → user confused why orgs vanished | `link-legacy` flow (§8.4): send once, re-parent orgs, destroy token. If expired → silent discard + "reconnect your orgs" empty state. Never a hard error. |
| EC-03 | Two tabs, two different orgs selected | Global org context is per-tab; conversation state keyed by org | Org context + active chat session sync across tabs via `storage` events; each tab's in-flight stream is independent (per-`contextId`), so no corruption. Show org pill prominently so tabs can't silently diverge. |
| EC-04 | User signs in with a different Supabase account than the one owning connected orgs | Orgs "disappear" | During onboarding, if `link-legacy` finds orgs under another identity with the same email hint, show "Found orgs from your previous sign-in — connect this account to claim them?" (one-click claim, audit-logged). Otherwise the normal connect flow. |
| EC-05 | Supabase email rate limit (`over_email_send_rate_limit`) | Hard error on signup | Already handled in OrgForge's login — keep the friendly message + "sign in instead" escape. |

### 13.2 Org connection & OAuth

| ID | Scenario | Why it breaks today | Unified behavior |
|---|---|---|---|
| EC-06 | OAuth callback arrives after Redis state expired (>10 min) | `InvalidOrExpiredState` dead-end | Friendly redirect with the mapped message (OrgForge already maps codes in the workspace — move mapping to the unified login/dashboard) + "Start again" that re-opens the flow. |
| EC-07 | User denies Salesforce authorization | `error=access_denied` | Map to plain-English banner: "Salesforce access was denied. You can retry or choose another environment." No stack traces. |
| EC-08 | Same org connected twice | Duplicate rows / conflicting tokens | Upsert on `(user_id, org_id)` (OrgForge already does `onConflict`); refresh tokens in place; toast "Org already connected — credentials refreshed." |
| EC-09 | Invalid scratch-org URL typed | OAuth to a random host | Server-side `refine` regex (already in OrgForge `connectSchema`) + client regex; both keep. |
| EC-10 | User revoked app access in Salesforce (or admin deactivated it) | Next call 401 → auto-refresh fails → `invalid_grant` | Auto-refresh fails once → mark org `disconnected` in `forge.org_connections` → inline banner "Reconnect this org" on dashboard/chat; agent/change actions disabled with the reason. Never a raw 500. |
| EC-11 | **Concurrent token refreshes for the same org** (two requests race; Salesforce can revoke a refresh token on first use) | `invalid_grant`, user logged out | Keep Agentforge's per-org **refresh promise dedup** (BUG-3) in `packages/org-connections`; add a Redis lock for cross-instance safety; on `invalid_grant` → force re-connect (EC-10). |
| EC-12 | Org is **Production** | Agent deploys can touch prod | OrgForge REF-07 already gates org changes. For agent builds: warn banner "Production org — test in a sandbox first" (Agentforge currently advises but doesn't block; keep, but surface the banner in chat). |
| EC-13 | User picks "Production" but the org is a sandbox (or vice versa) | Wrong login endpoint / misleading org type | After OAuth, query `Organization.IsSandbox` and **correct `org_type`**; store corrected value; reflect in UI pill. |
| EC-14 | **ECA package deleted/uninstalled after connect** (the explicit ask) | Agent deploys fail with obscure errors; org changes fail | This is exactly Agentforge's `packageInstalled=false` path: diagnostics detect it (by SubscriberPackageId), inline banner "Connector package not installed", one-click install link + "Re-check", auto re-check on related errors. Org-change capability also gated on package presence with the same banner. Nothing else in the app 500s — read-only surfaces (agents list, activity) stay usable. |
| EC-15 | Package **upgraded** to a new version | Version-pinned check falsely reports "missing" | Check by `SubscriberPackageId` (any version) — Agentforge already does this (`checkPackageInstalled`); keep and extend to the unified ECA. |
| EC-16 | No Einstein Agent license (or all seats used) | Agent work impossible, confusing errors | Diagnostics `licenseSupported=false` with reason → banner with a purchase/assign link; **org-change capability stays fully functional** (only agent tooling is disabled). |
| EC-17 | Einstein Agent User **deactivated or deleted** | Deploys fail with user-not-found | `findOrCreateAgentUser` reactivates (`IsActive` patch) or recreates; assign permission sets (tolerating duplicates). Reused as-is. |
| EC-18 | Agentforce permission sets renamed/missing | Provisioning silently skips | Dynamic discovery + explicit fallback list (Agentforge `discoverPermissionSets`) — keep both paths. |
| EC-19 | Connected user is **not an admin / lacks Author Apex** | Deploys fail with permission errors | Agentforge already appends permission context to the system prompt and suggests Flow-based actions; extend: org engine allows read-only ops, explains blocked writes. Banner-level hint, not a modal. |

### 13.3 Org context & indexing

| ID | Scenario | Why it breaks today | Unified behavior |
|---|---|---|---|
| EC-20 | Org not yet indexed / indexing stale | LLM guesses schema → hallucinated metadata | Ground both engines in `org_indexes` + Redis context; show "Indexing in progress" chip; **fall back to live Tooling API queries** (Agentforge `list_available_objects`) when index is empty; never generate from memory (OrgForge Hard Rule 2, Agentforge's list-before-build rule). |
| EC-21 | Health check is slow or org is down | Modal popups block the user | Diagnostics run in background with server-side 24h cache + promise dedup + inline banner (Agentforge pattern, §12.4). Chat never blocks on health. |
| EC-22 | **Classifier mis-routes** ("list my agents" → org engine) | Wrong toolset runs | Deterministic overrides (§7.1), UI capability chip override, routing log + lessons loop, golden-test suite (§15). Worst case: wrong engine answers → user taps chip → re-route, context preserved. |
| EC-23 | **Mixed intent in one message** ("build an agent… and add a validation rule") | One engine can't do both | `both` capability → sequential execution with per-segment progress cards; engines re-read org state between segments (never assume); if both touch the same metadata, serialize + queue (EC-35). |
| EC-24 | Ambiguous request | Guessing breaks the org | `clarify` default (OrgForge REF-10 / Agentforge `confirm_requirements`) — the router must never guess when the classifier is unsure. |
| EC-25 | **User switches org mid-conversation** | Agent tool calls hit the wrong org | Org switch resets chat context with a confirm ("Switching org clears this conversation"); conversation key includes org id; cross-org tool calls impossible by construction (credentials resolved from the active org row). |
| EC-26 | Double-submit / concurrent messages | Duplicate builds | Client `isBuilding` lock + abort controller (exists); server-side single-flight per session; backend returns 409 "already processing" instead of racing. |
| EC-27 | **SSE connection dropped mid-build/deploy** | User thinks the deploy failed | Client shows "Connection lost — checking status…" and polls `GET /deployments/status-stream/:id` / agent list; backend jobs run in BullMQ (survive the disconnect); deploy is idempotent to query. Never auto-retry a deploy on reconnect. |
| EC-28 | Prompt too long / file too big | 400s with cryptic errors | Keep zod caps (50k chars, 10MB) and file-type allowlist (both already exist); return the friendly validation message with a hint. |
| EC-29 | User requests something dangerous (bypass CRUD/FLS, delete prod data) | One engine might comply | Both engines' refusals are final and pre-date the merge; the router cannot override; refusal renders as a chat card with the reason (OrgForge refusal copy is excellent — reuse it for agent-side refusals too). |

### 13.4 Build & deployment

| ID | Scenario | Why it breaks today | Unified behavior |
|---|---|---|---|
| EC-30 | Agent deploy fails with compile errors | User sees raw XML errors | Agentforge self-heal loop (up to 4 attempts) with grouped progress UI — keep verbatim. |
| EC-31 | Org-change dry-run fails | Same class of problem | OrgForge REF-02 auto-repair loop — keep verbatim. |
| EC-32 | **Agent build and org change run simultaneously** against the same org | Metadata ZIP collisions / deployment queue races | Serialize per-org writes: both engines submit to the **same BullMQ deployment queue** (keyed by org); UI shows "Another operation is running for this org — queued." |
| EC-33 | Salesforce API outage mid-deploy | Deploy silently hangs | Timeouts + retry with backoff; BullMQ job persists; status endpoint reports truth ("in progress", not stuck spinner); no double-deploy on retry (idempotency key per change/deploy id). |
| EC-34 | Deploy succeeded but SSE dropped | User refreshes to "nothing happened" | Deploy id + change record persist; "Check status" button re-queries; activity feed shows the completed record. |
| EC-35 | Agent deleted in Salesforce while being edited | `update_agent_yaml`/`deploy` fails with not-found | `load_agent_for_update` failure → detect, refresh agent list, inform user ("This agent no longer exists — did someone delete it?"), offer to create a new one. |
| EC-36 | Duplicate agent name on deploy | Salesforce validation error, confusing | Surface Salesforce's error mapped to plain English + suggest an alternate name (Agentforge already handles `deploy_error` nicely — extend copy). |
| EC-37 | Rollback needed after an agent deploy | No rollback exists for agents | OrgForge rollback bundle pattern extended: before every agent deploy, snapshot prior YAML/Apex into the change-record row; `POST /rollback` restores agent deploys too. |

### 13.5 Data & migration

| ID | Scenario | Why it breaks today | Unified behavior |
|---|---|---|---|
| EC-38 | Legacy re-link fails (no legacy token, expired) | Orgs "lost" | Re-connect is the guaranteed path; re-link is best-effort convenience (§8.4). Empty state explains: "Reconnect your orgs — they live in Salesforce, nothing is lost." |
| EC-39 | **User runs both legacy apps and the unified app during cutover** | Writes to different schemas diverge | Transition rule: legacy apps remain **read-only display** (point their reads at `forge.*` views) once Phase 2 lands; show a banner in legacy apps: "You're using the previous version — continue in Forge." Writes only through the unified app during cutover. |
| EC-40 | Duplicate AI lessons (`public.ai_lessons` vs `orgforge.ai_lessons`) | Inconsistent guardrails | Merge + dedupe into `forge.ai_lessons` (dedupe by normalized text); one injector feeds both engines. |
| EC-41 | Token/encryption key change | Stored tokens undecryptable | Chosen path: re-connect once (§9.3a). `ENCRYPTION_KEY` is generated fresh for the unified env; legacy tokens are never re-encrypted. |
| EC-42 | HMAC secret rotation | Old records appear tampered | Verify each record with the secret recorded at signing time; new records use the new secret (OrgForge already stores signature only — keep schema). |

### 13.6 GitHub

| ID | Scenario | Why it breaks today | Unified behavior |
|---|---|---|---|
| EC-43 | GitHub App not configured server-side | 503 on install-url | Hide the GitHub step entirely + Settings shows "Unavailable — ask your admin" (OrgForge already returns 503; surface it gracefully). Onboarding never blocks on GitHub. |
| EC-44 | Pending-install claim expired (>10 min) | 403 "No pending GitHub install" | Friendly "start the install again" inline (OrgForge already maps this); button re-mints the claim. |
| EC-45 | User installs the app but grants no repos / wrong org | Empty repo picker, dead-end | Empty state: "The app doesn't have access to any repos — configure it on GitHub and refresh." |
| EC-46 | **GitHub push fails at deploy time** (repo deleted, app uninstalled, token revoked) | Change record lost | OrgForge's fallback already covers it: save the record locally (`orgforge-changes/`), **no fabricated commit hash**, warn "Audit record saved locally — GitHub push failed: <reason>"; offer reconnect. Keep for agent deploys too. |
| EC-47 | Re-connecting GitHub to a different repo | Old commits orphaned | Upsert on `user_id` (exists); activity feed shows both destinations; no silent overwrite without confirm. |

### 13.7 Multi-tenancy & concurrency

| ID | Scenario | Why it breaks today | Unified behavior |
|---|---|---|---|
| EC-48 | User A guesses user B's org id | Cross-tenant data leak | RLS + explicit ownership checks on **every** route including the new agent routes (`tenantIsolation` + `.eq('user_id', …)`); add an integration test for the agent endpoints specifically. |
| EC-49 | Service-role key misuse (client bundle) | Full DB access | Service role stays server-side only; frontend uses anon key; RLS-scoped client for per-user queries (OrgForge pattern). |
| EC-50 | Refresh storm across instances | Salesforce rate limits | Redis lock on refresh per org (extends Agentforge's in-process dedup, EC-11). |
| EC-51 | Duplicate deploy submission (retry button spam) | Double deploys | Idempotency key = `(org_id, change_set_id|agent_name, hash)`; second submit returns the existing deploy id. |

### 13.8 Frontend / UX states

| ID | Scenario | Why it breaks today | Unified behavior |
|---|---|---|---|
| EC-52 | Slow network | Spinners forever | Skeletons (OrgForge has them) + 45s `apiFetch` timeout + SSE keep-alive pings; stale-while-revalidate for lists. |
| EC-53 | Chat opened with **no org connected** | Empty, confusing chat | Landing state: "Connect a Salesforce org to start" + one CTA (route to onboarding); no input until an org exists. |
| EC-54 | Every list is empty (no agents, no changes, no GitHub) | Dead pages | Friendly empty states with one CTA each (build first agent / request a change / connect GitHub) — all deep-linking to chat or onboarding. |
| EC-55 | Any unhandled error | Raw stack traces | Unified error boundary + `error.tsx` (OrgForge has it) + sanitized API errors; "something went wrong — retry" with the request id logged server-side. |
| EC-56 | Mobile keyboard covers chat input | Can't see what you're typing | `interactive-widget=resizes-content` viewport meta + input pinned above keyboard; test on iOS Safari. |

### 13.9 The five edge cases we will test first (priority)

1. **EC-14** Package deleted after connect → banner + install + re-check, read-only surfaces stay alive.
2. **EC-11/EC-10** Token refresh race + revoked app → single-flight refresh, graceful "reconnect" state, no 500s.
3. **EC-27** SSE drop mid-deploy → status polling tells the truth, no phantom failure.
4. **EC-22/EC-23** Classifier mis-route and mixed intent → chip override + sequential execution, context preserved.
5. **EC-25** Org switch mid-conversation → confirmed reset, no cross-org tool calls.

---

## 14. Migration & Rollout (No-Breakage Guarantee)

### 14.1 Principles

1. **Additive over destructive:** every change is additive (new schema, new routes, new frontend); nothing is dropped until two full release cycles after its replacement is proven.
2. **Feature flags:** `FORGE_UNIFIED_FRONTEND`, `FORGE_UNIFIED_API`, `FORGE_ROUTER`. Old apps ship unchanged until flags flip.
3. **Dual-run verification:** every legacy flow has a checklist item proving the new flow produces the same outcome (§15.3).
4. **Rollback path defined before each deploy:** stop serving the new frontend (flag off / 301 revert); legacy apps never lose deploy targets until Phase-5 sign-off.

### 14.2 Phases

**Phase 0 — Baseline (0–1 wk).** Run and record: Agentforge backend tests, OrgForge `73/73` tests, frontend lint + e2e, manual smoke of both apps. Freeze API contracts. This is the regression oracle.

**Phase 1 — Unified identity + gateway (1–2 wks).**
- Deploy the unified Next.js app (marketing, login, dashboard, chat shell) pointing at a **gateway** that proxies to both existing backends (A2). New Supabase login; orgs list = OrgForge; chat = Agentforge behind the same origin.
- Implement `link-legacy` + org re-link (§8.4).
- Ship the capability chip with a **stub classifier** (rule-based only) — UX in place, zero AI risk.
- Flag: `FORGE_UNIFIED_FRONTEND=on` for a canary group only.

**Phase 2 — Single API process (2–3 wks).**
- Mount OrgForge + Agentforge routers in one Express entry (E1); run both test suites against the merged process.
- Move Agentforge conversation state to Redis; unify `ai_logs` writes.
- Legacy apps become read-only display (EC-39).
- Delete the gateway; legacy port aliases still served.

**Phase 3 — Data unification + diagnostics (3–4 wks).**
- `forge` schema + views; migrate `org_connections`; re-link Salesforce connections; extend change records to agent deploys.
- Ship `packages/diagnostics` (§12.4) with server-side caching; replace the localStorage cache.
- Health check `/api/v1/health/db` extended to the new tables.

**Phase 4 — Real router + inline cards + onboarding (4–6 wks).**
- Ship `routeIntent` classifier, routing log, session store, mixed-request handoff.
- Chat renders org-change cards inline; agents page goes live; dashboard activity feed unifies both engines.
- Replace the OrgForge login with the 3-step onboarding (§12) including GitHub step.

**Phase 5 — Decommission (6–8 wks, after soak).**
- Point old domains at the new app (301s), stop legacy deploys, remove compat aliases, drop old schema *only after* signed sign-off. Optional internal-identifier rename cleanup.

### 14.3 Canary & soak
- Internal team + 2 friendly customers on the flag first; watch error rates, route mis-classifications, SSE drop rates, diagnostics false-negatives; 2-week soak before full rollout.

---

## 15. Testing & QA

### 15.1 New unit tests
- `routeIntent`: golden set ≥40 prompts (incl. the user's two examples, adversarial "list my agents but also add a validation rule", off-topic refusals, unsafe requests); assert capability + confidence thresholds; assert deterministic overrides beat the model.
- `org-connections`: encrypt/decrypt round-trip, refresh dedup (port BUG-3 test), re-link idempotency.
- `diagnostics`: each state machine transition (ok / missing package / license / disconnected / error), cache TTL, promise dedup, 401-invalidation.
- Auth middleware: Supabase JWT valid/expired/malformed; GET-only query tokens; tenant isolation on a representative route from *each* engine.
- SSE envelope: additive fields don't break legacy parsers.

### 15.2 Integration & e2e (Playwright)
- Onboarding: sign in → connect org (mocked Salesforce) → diagnostics banner states (package missing → install link → re-check → ok) → optional GitHub (install → repo pick → skip path).
- Chat: "list all my agents" → chip `Agents` → agents rendered. "modify an account" → chip `Org Change` → inline intent card → gates → refusal with unblock.
- Mixed fan-out; classifier override; org switch mid-conversation (EC-25); SSE drop + status poll (EC-27).
- Regression: run **both** legacy e2e suites against the merged app.

### 15.3 Dual-run regression matrix (no-breakage proof)

| Legacy flow | New flow | Prove equal by |
|---|---|---|
| Agentforge: login → connect → build agent → deploy | Unified: same via Copilot | Same SSE events; same deployed `.agent`/Apex artifacts (diff in sandbox) |
| Agentforge: update existing agent | Unified: Copilot `Agents` route | Same YAML delta |
| Agentforge: diagnostics/provisioning | Unified: dashboard diagnostics banner | Same license/package/provision verdicts |
| Agentforge: package deleted → setup modal | Unified: banner + install + re-check | Same detected state, no crash (EC-14) |
| OrgForge: 10-stage change | Unified: Copilot inline cards + `/workspace` advanced | Same change record HMAC + deployment id |
| OrgForge: GitHub audit push | Unified: onboarding GitHub step | Same commit in audit repo |
| OrgForge: package-health tri-state | Unified: diagnostics banner | Same state, better copy |
| AI Judge nightly | Unified `/internal/run-ai-judge` | Same lesson rows |

### 15.4 Security tests
- Auth-bypass attempts on the mounted Agentforge routes (now behind `requireAuth`), RLS attempt matrix (user A reading user B's orgs/intents/records), token-in-logs scan, SSE origin checks, prompt-injection steering attempts against the router.

---

## 16. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Classifier mis-routes | Med | Med | Deterministic overrides, UI capability toggle, golden-set tests, routing log + lessons loop |
| 2 | Combined prompt/tool surface degrades either engine | Med | High | B2 keeps prompts separate; only the tiny classifier is new; canary + A/B on routing |
| 3 | ESM↔CJS mounting breaks a route | Low | High | Adapter module + both full test suites against the merged process before any cutover |
| 4 | Token re-link misses orgs | Med | Low | Best-effort; re-connect is the guaranteed path; nothing blocks on re-link |
| 5 | Encryption-key merge invalidates stored tokens | High (if kept) | Med | Path (a): re-connect orgs once; keys never reused |
| 6 | `localStorage` token theft (XSS) | Med | High | httpOnly Secure cookie for Supabase session in prod; CSP; no `?token=` redirects anymore |
| 7 | SSE breaks through proxies after domain change | Low | Med | Reuse OrgForge's proven proxy config; verify on Render pre-canary |
| 8 | Frontend version/Tailwind friction (v3↔v4) | Med | Med | Standardize on v4 with token-compat mapping; restyle later, not a blocker |
| 9 | Port/dev-server collisions during transition | Med | Low | Documented port map; never `next build` during `next dev` |
| 10 | Renaming leaks (product names in UI) | Med | Low | Copy-audit checklist + grep gate in CI |
| 11 | Both engines write `ai_lessons`/`ai_logs` with different shapes | Med | Med | Unified writer in `packages/ai`; legacy read paths via views |
| 12 | Scope balloons into a 3-month rewrite | High | High | Phase gates; every phase shippable alone; legacy apps deployable until Phase 5 |
| 13 | Diagnostics false-negative (says "missing package" when installed) | Low | Med | Check by SubscriberPackageId (any version) + fallback query + manual re-check; banner copy explains it may lag |

---

## 17. Open Decisions Needed From You

1. **Product name** — confirm "Forge" (Enlight Forge) or pick another from §2.2. ( go with forge)
2. **Session storage** — OK to move Supabase session to httpOnly cookies in production (recommended), or keep localStorage + CSP hardening for v1? (recommended)
3. **Scope of Salesforce `full` permission** — keep for parity (recommended short-term) or trim and test provisioning impact?    (explain)
4. **Encryption-key migration** — confirm "re-connect orgs once" (recommended) vs server-side re-encryption. (recommended)
5. **Legacy downtime window** — is a 15-min maintenance window acceptable at final cutover, or must old URLs never 404? (explain)
6. **Agent inventory** — new `forge.agents` cache table (§9.1) vs pure live queries to Salesforce on `/agents` load (cheaper, slightly slower).  (table)
7. **Two ECAs vs one during transition** — keep both ECA packages installed (diagnostics checks both) or migrate users to a single unified ECA before cutover? (One ECA is the clean end state; two is the safer interim.) (One ECA use the agentforge one)
8. **GitHub step default** — is GitHub "skippable-but-nudged" (recommended) or "required for org-change deploys" (strict audit) in onboarding? (skippable but ui should mention always that the audit saving happens if github connected)

---

## Appendix A — Quick-start implementation order (for the engineer who picks this up)

1. `unified-forge/packages/auth` (requireAuth + tenantIsolation); prove it rejects legacy Agentforge JWTs while accepting Supabase JWTs.
2. `unified-forge/packages/org-connections` (unified read/refresh) — port Agentforge's refresh-dedup into OrgForge's `orgCredentials`.
3. Merge API entry (E1): mount both routers; run both test suites green.
4. Unified frontend shell + login + dashboard + chat (Phase 1 scope) behind flags.
5. `forge` schema + org re-link + encryption-key decision.
6. `packages/diagnostics` — Agentforge pre-flight, server-side cached, banner-first (§12.4).
7. Classifier + routing log + inline cards + agents page + onboarding GitHub step.
8. Copy audit, canary, soak, decommission.
 