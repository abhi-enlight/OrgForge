# Forge (unified-forge)

One conversational copilot for the whole Salesforce org — the unification of
Agentforge (agent builder) and OrgForge (governed org customization) into one
product, per [`docs/architecture/unification_plan.md`](docs/architecture/unification_plan.md).

**Status:** Phases 1–4 **code complete & database verified** — one self-contained application. Both
legacy engines were ported **into this repo** as first-class modules (Pass 32:
`backend/src/orgforge/` + `backend/src/agentforge/`, Agentforge CJS→ESM); the legacy
sibling repos were archived to `/Users/abhi/Enlight/archive/` (Pass 33). Live Supabase integration verified via MCP (Pass 43: 6 `forge.*` tables with RLS + `@supabase/ssr` session management). Backend suite **402/402**; unified packages **234/234**; `frontend` tsc/lint/build green. See
[`docs/specifications/PRD_COMPLIANCE.md`](docs/specifications/PRD_COMPLIANCE.md).

## Layout

```
unified-forge/
├── frontend/                  # Next.js 16 app (port 3000) — @forge/web (@supabase/ssr middleware)
│   └── src/                   # app router pages, components, lib, middleware.ts
├── backend/                   # ONE Express 5 entry (port 3001) — @forge/api, native ESM
│   ├── src/
│   │   ├── routes/            # unified capability routes (chat, agents, diagnostics, …)
│   │   ├── engines/           # agentEngine + orgEngine (route to the ported engines)
│   │   ├── lib/               # supabaseClients (forgeDb/publicDb singletons), redisConversations, chatSessions, sseEmitter
│   │   ├── orgforge/          # OrgForge backend ported in-repo (routers, services, BullMQ workers)
│   │   └── agentforge/        # Agentforge engine ported CJS→ESM (ConversationManager, SalesforceClient)
│   └── scripts/               # verifySchema, driveWorkspaceFlow (A2 harness), portAgentforge
├── packages/
│   ├── auth/                  # requireAuth + tenantIsolation (Supabase JWT via GoTrue)
│   ├── org-connections/       # unified credential read/refresh + re-link
│   ├── diagnostics/           # Agentforge pre-flight + server-side 24h cache (§12.4)
│   └── ai/                    # classifier (routeIntent) + SSE envelope + writeAiLog (§7)
├── supabase/migrations/       # forge schema + views (008 & 010 applied to live Supabase via MCP)
└── docs/
    ├── README.md               # Documentation map & index
    ├── api/                    # API contract & reference docs (api_contract.md, API.md)
    ├── architecture/           # System design & architecture (unification_plan.md, DECISIONS.md, APP_FLOW.md, ...)
    ├── specifications/         # Requirements & plan trackers (PRD.md, IMPLEMENTATION_PLAN.md, ...)
    ├── operations/             # Phase 5 rollout & redesign plans (PHASE5_PLAN.md, ...)
    └── legacy/                 # Imported legacy PRDs (OrgForge_PRD.md, Agentforge_PRD.md)
```

## Dev

```bash
npm install                 # from unified-forge/
npm run dev                 # starts BOTH: API on :3001 + web on :3000 (concurrently)
npm run dev:api             # API only (:3001, capability flags on)
npm run dev:web             # web only (:3000)
npm test                    # runs all package tests (workspaces)
```

`npm run dev` uses `concurrently` — prefixed logs (`[backend]` / `[frontend]`),
Ctrl+C stops both. The backend dev/start scripts enable the capability flags
(`FORGE_UNIFIED_API=on FORGE_MOUNT_AGENTFORGE=on`) so the web app's APIs are
fully mounted.

Env reference: `.env.example`. **Do not commit `.env`.**

## Build order (plan Appendix A)

1. ✅ `packages/auth` — requireAuth + tenantIsolation
2. ✅ `packages/org-connections` — unified read/refresh + re-link
3. ✅ Merge API entry (E1 → Pass 32 native port): OrgForge + Agentforge routers
   are first-class in-repo modules (`backend/src/orgforge/` + `backend/src/agentforge/`);
   the `@forge/compat` CJS adapter was retired. `/api/v1/health`, JSON 404,
   `POST /api/v1/auth/link-legacy` wired (§8.4); both route surfaces verified
   booting (OrgForge `401`, Agentforge `302`/`401`)
4. ✅ Unified frontend shell + login (3-step onboarding incl. GitHub install + repo picker) + dashboard + Copilot chat (with inline org-change cards) + Agents + Changes & Audit + Settings (Phase 4: `frontend`, streaming over `/api/v1/chat/stream`)
5. ✅ `forge` schema + org re-link + encryption-key decision — SQL applied to live Supabase project via MCP (Pass 43: created 6 `forge.*` tables with RLS policies: `org_connections`, `agents`, `chat_sessions`, `routing_log`, `diagnostics`, `ai_logs`).
6. ✅ `packages/diagnostics` — Agentforge pre-flight, server-side cached (24h cache with S-2 degrade and EC-14 package-missing self-healing).
7. ✅ Canary flag + soak ready — `@supabase/ssr` middleware route protection, `forgeDb`/`publicDb` client singletons, chat sessions spine, and all Phase 4 features live.
8. ⏳ Copy audit, canary, soak, decommission

## Phase-0 baseline (regression oracle — recorded 2026-08-10)

| Suite | Result |
|---|---|
| OrgForge backend (`OrgForge/backend`) | **138/138 pass** |
| OrgForge frontend Playwright e2e | pending (`npm run test:e2e`) |
| Agentforge backend | no unit-test files in `src/` (AI Judge cron tested manually) |
| unified-forge packages | **97/97 pass** (`npm test`) |
| `frontend` (Next 16 + Tailwind v4) | tsc ✅ lint ✅ build ✅ (10 static routes; Copilot streaming + chips + inline org-change cards; Agents + Changes + Settings pages) |

Freeze these before Phase 2 mounts the routers; any merged-process regression must be measured against this table (§14.2).

