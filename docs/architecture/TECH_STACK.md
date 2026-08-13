# OrgForge — Technology Stack

The stack as it actually exists in `orgforge/` (verified against workspace `package.json` files and source layout).

**Docs set (one product):** [`unification_plan.md`](./unification_plan.md) (design) · [`DECISIONS.md`](./DECISIONS.md) (decisions) · [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (tracker) · [`api_contract.md`](./api_contract.md) (frozen API) · [`PRD.md`](./PRD.md) (requirements) · [`API.md`](./API.md) (reference) · [`APP_FLOW.md`](./APP_FLOW.md) (flows) · [`DESIGN.md`](./DESIGN.md) (design system) · [`PHASE5_PLAN.md`](./PHASE5_PLAN.md) (phase 5) · [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (audit) · legacy PRDs ([`OrgForge`](./legacy/OrgForge_PRD.md) · [`Agentforge`](./legacy/Agentforge_PRD.md))

---

## 1. At a glance

| Layer | Choice | Version |
|---|---|---|
| Monorepo | npm workspaces, ESM (`"type": "module"`) | — |
| Runtime | Node.js | ≥ 20 |
| Frontend | **Next.js** (App Router) + **React** | Next 16.2.10 · React 19.2.4 |
| Styling | **Tailwind CSS v4** (CSS-first `@theme` tokens) | ^4 |
| Backend | **Express** | ^5.0.0 (ESM) |
| AI | **Google Gemini** via `@google/genai` | ^2.15.0 |
| Auth / identity | **Supabase Auth** (JWT bearer) + `@supabase/supabase-js` | ^2.46.1 |
| Database | **Supabase Postgres** — unified `forge` schema (migrations 008+) | — |
| State / queues | **Redis** via `ioredis` (conversation state, single-flight locks) | ^5.4.1 |
| UI kit | lucide-react icons · clsx + tailwind-merge · framer-motion | 0.460 · 2.x · 11.x |
| Validation | **zod** (API request contracts) | ^3.23.8 |
| File ingest | multer (upload) · pdf-parse · mammoth (DOCX) | 2.2 · 1.1 · 1.12 |
| Testing | `node:test` (all workspaces) · eslint + tsc + `next build` (web) · Playwright e2e (OrgForge baseline) | — |

**Ports:** API `:3001` · web `:3000` (legacy Agentforge API was `:3002`; both legacy apps decommission in Phase 5).

---

## 2. Monorepo layout

```
orgforge/
├── backend/                   @forge/api   — ONE Express 5 entry (:3001), mounts all routers
├── frontend/                  @forge/web   — Next.js 16 App Router app (:3000)
├── packages/
│   ├── ai/                   @forge/ai    — routeIntent classifier + SSE envelope + describeImage (Gemini)
│   ├── auth/                 @forge/auth  — requireAuth + tenantIsolation (Supabase JWT)
│   ├── diagnostics/          @forge/diagnostics — pre-flight port + server-side 24h cache (EC-14)
│   └── org-connections/      @forge/org-connections — encrypted credential store, refresh dedup, re-link
├── supabase/migrations/      forge schema (008+), legacy RPCs (010)
└── docs/                     plan · decisions · contract · PRD · API · flow · stack · design
```

Workspace scripts (root):

```bash
npm run dev             # BOTH: API :3001 + web :3000 (concurrently, prefixed logs)
npm test                # all workspace test suites (node:test) — backend 402/402
npm run dev:api         # API only (:3001, capability flags on)
npm run dev:web         # Next.js app only (:3000)
npm run build:web / lint:web / typecheck:web
```

---

## 3. Backend (`backend/` — Express 5, ESM)

- **Entry:** `src/index.js` → `src/app.js` (helmet, cors, morgan, JSON body, zod, error handler).
- **Routes:** `src/routes/` — `chatStream.js` (SSE), `chatRoute.js` (classifier), `chatContext.js` (DELETE reset), `agents.js`, `diagnostics.js`, `linkLegacy.js`; capability routers are **first-class in-repo modules** — `src/orgforge/routes/*` (9 routers, auth rebased on `@forge/auth`) and `src/agentforge/routes/*` (legacy aliases) — all native ESM since Pass 32 (the one-folder port; no `../OrgForge`/`../Agentforge` references).
- **Engines:** `src/engines/` — `agentEngine.js` (ConversationManager over Gemini + Salesforce tools), `orgEngine.js` (governed change pipeline).
- **Lib:** `src/lib/` — `redisConversations.js` (Redis conversation store + busy-lock), `chatSessions.js` (session spine), `sseEmitter.js` (unified envelope), `fileAttachments.js` (multer + extract + `buildImageParts`).
- **Key deps:** express 5, ioredis, zod, multer, pdf-parse, mammoth, cors, helmet, morgan, dotenv, express-session (transition only — deleted in Phase 5).
- **Auth wiring:** `@forge/auth` `requireAuth` + `tenantIsolation` middleware; Supabase JWT verified server-side via `supabase.auth.getUser`; dev sessions in localStorage, **production uses httpOnly Secure cookies (D2)**.

## 4. Frontend (`frontend/` — Next.js 16 App Router)

- **App routes (8 pages):** `/` (redirect → `/dashboard`) · `/login` (+ `login-flow.tsx`, 3-step onboarding) · `/(app)/dashboard` · `/(app)/chat` · `/(app)/agents` · `/(app)/changes` · `/(app)/settings` (+ `settings-flow.tsx`) · `/(app)/workspace`.
- **Shell:** `components/layout/` — `AppShell.tsx`, `Header.tsx` (org pill + switcher, avatar), `Sidebar.tsx` (5 items, mobile drawer).
- **Chat:** `components/chat/` — `MessageBubble`, `Markdown`, `CodeBlock`, `BuildProgressCard` (per-segment), `OrgChangeCard`, `CapabilityChip`, `StarterCards`.
- **Client libs:** `lib/api.ts` (`apiFetch` — JWT, timeouts 45s/120s, `ApiError` with zod issues, 401 → /login) · `lib/chat-stream.ts` (`streamChat` SSE reader + multipart, `resetChatSession`) · `lib/supabase.ts` · `lib/org-context.tsx` (active-org context) · `lib/flags.ts` (canary) · `lib/utils.ts` (cn).
- **Auth gate:** `components/auth/AuthGate.tsx`.
- **Styling:** Tailwind v4 — token definitions live in `src/app/globals.css` `@theme` (see DESIGN.md); Inter (UI) + Fira Code (mono) via `next/font`.
- **Proxying:** `next.config.ts` rewrites `/api/*` → the unified backend (`:3001`).

## 5. Shared packages

| Package | Responsibility | Key deps |
|---|---|---|
| `@forge/ai` | `routeIntent` classifier (Gemini + deterministic §7.1 overrides, stub-able for tests/canary), unified SSE envelope types, `describeImage` (Gemini vision for org-change image attachments) | `@google/genai` |
| `@forge/auth` | `requireAuth`, `tenantIsolation` | `@supabase/supabase-js`, jsonwebtoken (dev) |
| `@forge/diagnostics` | pre-flight port (license / package-by-SubscriberPackageId / provisioning / org-type), server-side 24h cache + promise dedup, `invalidateDiagnostics` (EC-14), package-missing never-pin (Pass 22) | — |
| `@forge/org-connections` | encrypted credential store (`iv:authTag:encryptedData`, AES-256-GCM), per-org refresh dedup, legacy re-link (RPC-backed) | jsonwebtoken |

## 6. Data layer (Supabase — one project, unified `forge` schema)

- Legacy: Agentforge `public` + `orgforge.*` schemas (same project). Unified: `forge.*` schema via migrations numbered **008+** (after OrgForge's 001–007).
- **Migration 008** (`forge` schema): `org_connections` (+ `capabilities`, `legacy_agentforge_user_id`, `disconnected_at`), `agents` inventory cache, `chat_sessions`, `routing_log`, `diagnostics`.
- **Migration 010**: legacy re-link RPCs (`get_connections_by_agentforge_user`, `delete_salesforce_connection_by_user`).
- **Planned:** 009 (compat views), 011 (RLS — mirror OrgForge's `auth.uid() = user_id`).
- **S-2 semantics everywhere:** missing-table errors (migration 008 pending) degrade gracefully (uncached runs, 503 `/health/db`); **any other DB error fails loudly** — a real bug must surface, not be swallowed.
- **Service-role client pattern:** every query passes the verified `user_id` explicitly (tenantIsolation); **RLS is never a backstop** on service-role clients.

## 7. Redis (conversation state + locks)

- `redisConversations.js` — per-conversation state + busy-lock keyed `{user_id}|{org_id}|{session_id}`; 10-min lock TTL; single-flight 409s; `clearConversation` (unconditional del) powers `DELETE /chat/:contextId`.
- Migration from Agentforge's in-memory `activeConversations` map → Redis (cross-instance, survives restarts).
- Redis-down degrades to an in-memory fallback lock (tests cover the path).

## 8. AI architecture

- **One classifier, one envelope** (`@forge/ai`): `routeIntent` decides `agent | org_change | both | clarify` with Gemini + deterministic overrides; capability chip pins bypass the classifier; every decision → `forge.routing_log`.
- **Agent engine:** legacy Agentforge ConversationManager (Gemini chat session, ~24 Salesforce tools, ReAct loop) with a pre-init guard for image-parts arrays on fresh sessions (Pass 21).
- **Org engine:** governed pipeline — intent → blast radius → refusal gates (REF-01..10) → dry-run → deploy → HMAC-signed record; image attachments described by `describeImage` and injected as document text.
- **Model:** Gemini — key `GOOGLE_AI_API_KEY` (canonical; legacy `GEMINI_API_KEY` still honored), model `GEMINI_MODEL || gemini-2.5-flash`.

## 9. Testing & quality

- **Backend:** `node:test` across `@forge/api` + all packages — **402/402** passing (unit: routes, engines, stores, classifier, SSE, crypto, verifySchema; re-homed OrgForge suite 138; S-2 degrade paths).
- **Web:** `tsc --noEmit` · `eslint` · `next build` — all clean.
- **E2E:** OrgForge Playwright baseline **3/3** (mocked APIs) preserved for regression.
- **QA gates:** zod everywhere, sanitized errors, SSRF guards (https + allowlist), multer allowlist, HMAC-signed records. (OrgForge's legacy rate-limit tiers ship with the mounted capability routers — not re-implemented in the unified `backend/src`.)

## 10. Environments & rollout

- **Dev:** `npm run dev:api` + `npm run dev:web`; `.env.example` at root + `frontend/.env.example` — **canonical env names** (SALESFORCE_*, GOOGLE_AI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, FORGE_* flags) with legacy Agentforge/OrgForge aliases honored as fallbacks; `JWT_SECRET` retired (Pass 36).
- **Prod:** Next.js on Vercel + Express API on Render; Supabase hosted Postgres; Redis (managed).
- **Feature flags:** `FORGE_UNIFIED_API=on` (capability routers), `FORGE_MOUNT_AGENTFORGE=on` (legacy aliases `/api/auth`, `/api/org` — deleted Phase 5), `FORGE_UNIFIED_FRONTEND` (canary chip), `FORGE_ECA_PACKAGE_VERSION_ID` (package check override).
- **Rollout (D5):** zero-downtime — legacy apps stay deployed and serving; 301 old domains after the new domain is proven; decommission only after Phase-5 soak + sign-off.
