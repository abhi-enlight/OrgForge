# OrgForge (orgforge)

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
orgforge/
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
    ├── setup/                  # Setup guides (github_app_setup.md, packaged_eca_setup.md)
    ├── specifications/         # Requirements & plan trackers (PRD.md, IMPLEMENTATION_PLAN.md, ...)
    ├── operations/             # Phase 5 rollout & redesign plans (PHASE5_PLAN.md, ...)
    └── legacy/                 # Imported legacy PRDs (OrgForge_PRD.md, Agentforge_PRD.md)
```

## Dev

```bash
npm install                 # from orgforge/
npm run dev                 # starts BOTH: API on :3001 + web on :3000 (concurrently)
npm run dev:api             # API only (:3001, capability flags on)
npm run dev:web             # web only (:3000)
npm test                    # runs all package tests (workspaces)
```

`npm run dev` uses `concurrently` — prefixed logs (`[backend]` / `[frontend]`),
Ctrl+C stops both. The backend dev/start scripts enable the capability flag
(`FORGE_UNIFIED_API=on`) so the web app's APIs are fully mounted.