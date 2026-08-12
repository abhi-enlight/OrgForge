# Forge — Implementation Plan (Master)

> **Source of truth:** [`unification_plan.md`](./unification_plan.md) (design) +
> [`DECISIONS.md`](./DECISIONS.md) (locked decisions D1–D8).
> **Docs set (one product):** [`api_contract.md`](./api_contract.md) (frozen API) ·
> [`PRD.md`](./PRD.md) (requirements) · [`API.md`](./API.md) (reference) ·
> [`APP_FLOW.md`](./APP_FLOW.md) (flows) · [`TECH_STACK.md`](./TECH_STACK.md) (stack) ·
> [`DESIGN.md`](./DESIGN.md) (design system) · [`PHASE5_PLAN.md`](./PHASE5_PLAN.md) (phase 5) ·
> [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (audit) · legacy PRDs
> ([`OrgForge`](./legacy/OrgForge_PRD.md) · [`Agentforge`](./legacy/Agentforge_PRD.md))
> **Status:** Phases 1–4 **code complete** — Pass 17 (EC-23 per-segment
> progress cards) closed the last Phase 4 item; Pass 18 closed the Phase 0
> leftovers (OrgForge Playwright e2e baseline 3/3 + frozen `docs/api_contract.md`);
> Pass 19 implemented the contract's first gap
> (`DELETE /api/v1/chat/:contextId`); Pass 21 closed the LAST contract gap
> (image attachments via Gemini `inlineData`); Pass 22 closed the last
> flagged follow-up (EC-14 package-missing auto-recheck — a run detecting
> `package.installed=false` is never pinned, reads self-heal after install);
> Pass 23 added the forge-schema verifier (`backend/scripts/verifySchema.mjs`);
> Pass 32 made the repo one self-contained app (OrgForge + Agentforge ported
> in-repo, `@forge/compat` retired); Pass 34 re-homed the OrgForge service unit
> tests; Pass 35 added the agentforge offline smoke + worker-boot guard; backend
> **402/402**. Still
> open: migration 011 (🔷 S-5, drafted when Phase 3 data work starts), Supabase
> MCP migrations (S-1/S-2/S-4), and Phase 5 canary/soak. All
> tasks are checkbox-tracked.
> **Legend:** ✅ done · ⬜ todo · 🔷 **SUPABASE TASK** (deferred — applied later via Supabase MCP) · 🔒 blocked-by

---

## 0. Current state (verified 2026-08-10)

| Area | Status |
|---|---|
| `packages/auth` — requireAuth + tenantIsolation | ✅ 8 tests |
| `packages/org-connections` — crypto, refresh dedup, re-link | ✅ 17 tests |
| ~~`packages/compat` — CJS↔ESM router adapter~~ | ✅ **retired** (Pass 32 — no CJS router remains; Agentforge is native ESM) |
| `backend/` — merged Express entry, health, JSON 404, `link-legacy` route | ✅ 4 tests; merged mounts smoke-verified |
| Migrations `008`/`010` SQL | ✅ **Applied live via MCP (Pass 43)** — 6 `forge.*` tables + RLS policies verified (`org_connections`, `agents`, `chat_sessions`, `routing_log`, `diagnostics`, `ai_logs`) |
| `frontend` — Next 16 + Tailwind v4 shell, auth gate, login + 3-step onboarding, dashboard, Copilot, Agents | ✅ tsc/lint/build; smoke-verified (10 static routes + `/`→`/dashboard`) |
| Canary: `FORGE_UNIFIED_FRONTEND=on` flag + stub rule-based classifier chip (§14.2 Phase 1) | ✅ flag-on build serves `/chat`; stub `classifyWithStub` in `packages/ai` |
| Conversation state (§7.3): Redis lock + persistence | ✅ token-owned SET-NX-PX lock (600s TTL, atomic Lua owner-checked release), in-memory degrade when Redis is down, live-Redis smoke verified |
| `ai_logs` unification: single writer in `packages/ai` → `forge.ai_logs` | ✅ `writeAiLog` wired into chat/stream agent + org steps (success + failure rows) |
| **402/402** unified tests (incl. the re-homed OrgForge service tests in `backend/src/orgforge`, Pass 34) | ✅ |

> **Change log:** every implementation pass is recorded in
> [`tasks/remaining_tasks.md`](../tasks/remaining_tasks.md) (+ `tasks/todo.md`,
> `tasks/lessons.md`), mirroring the `OrgForge/tasks/` convention.

---

## 1. Phase 0 — Baseline (regression oracle) — *mostly done*

- [x] OrgForge backend test suite recorded: 138/138
- [x] unified-forge package tests recorded: 97/97
- [x] Agentforge backend: no unit tests in `src/` (documented)
- [x] OrgForge frontend Playwright e2e baseline (`cd OrgForge/frontend && npm run test:e2e`) — **Pass 18: 3 passed (16.4s)** — ambiguity-escape (rephrase + free-text hatches) + 10-stage operator flow, chromium
- [x] Freeze API contract changelog — **Pass 18: `docs/api_contract.md`** (frozen baseline; diff vs `OrgForge/docs/architecture/API.md` + `Agentforge/docs/api.md`; §6 additive-only policy)

## 2. Phase 1 — Unified identity + gateway — *in progress*

### Backend packages (done in this repo)
- [x] `packages/auth`: `requireAuth` (Supabase JWT via `auth.getUser`), GET-only query tokens, `tenantIsolation`, injectable verifier
- [x] `packages/org-connections`: `getOrgCredentials` (5-min refresh margin + BUG-3 per-org dedup), `refreshSalesforceAccessToken`, `linkLegacyAgentforgeOrgs`, unified `cryptoUtils` (iv:authTag:data)
- [x] ~~`packages/compat`: `loadCjsRouter` for Agentforge CJS routers~~ — **retired (Pass 32)**: Agentforge is now native ESM in `backend/src/agentforge/`, so no CJS loader remains

### API
- [x] `backend/src/app.js` `createApp()` factory: helmet, CORS, morgan, 10mb json, flag-gated session, health, JSON 404, sanitized error handler
- [x] `backend/src/index.js` thin entry; mount failure → `exit(1)` when flags are ON
- [x] OrgForge routers mounted at `/api/v1/*` (behind `FORGE_UNIFIED_API=on`)
- [x] Agentforge routers mounted at legacy `/api/auth`, `/api/org` (behind `FORGE_MOUNT_AGENTFORGE=on`) — Pass 32: from the ported `backend/src/agentforge/routes/` (ESM); the compat adapter is gone
- [x] `POST /api/v1/auth/link-legacy` wired (§8.4) with zod validation
- [ ] **🔷 SUPABASE TASK:** apply `010_forge_legacy_rpc.sql` so `get_connections_by_agentforge_user` / `delete_salesforce_connection_by_user` exist (re-link won't work without them)
- [x] Add `GET /api/v1/health/db` (Pass 13) — `healthRouter` in `backend/src/routes/health.js`: liveness `/api/v1/health` + readiness over the 6 `forge.*` tables from 008 incl. `ai_logs` (Pass 14) (missing-table → 503 with the list + `migrationPending` when the schema is absent; any other DB error → 500 fail-loud)

### Auth flow
- [x] Supabase login page flow (client-side `supabase.auth.signInWithPassword`/OAuth) — Pass 4/9, `login-flow.tsx`
- [x] Frontend `link-legacy` call on first sign-in: read `localStorage.auth_token`, POST it once, destroy token (EC-02) — `linkLegacyOnce`
- [ ] **🔷 SUPABASE TASK:** confirm Supabase Auth configured (email provider, rate limits, redirect URLs) for the shared project

## 3. Phase 2 — Single API process — *complete (Pass 14)*

- [x] Both routers mounted in one Express process; both test suites run against merged process
- [x] Legacy apps remain runnable (flags default OFF)
- [x] Move Agentforge conversation state (in-memory `activeConversations` Map) to Redis keyed by `{user_id, org_id}` (plan §7.3) — Pass 14: `backend/src/lib/redisConversations.js` (token-owned SET-NX-PX busy lock, 600s TTL, atomic Lua owner-checked release, state snapshot with 4h TTL, in-memory fallback when Redis is down) + `agentEngine.js` rewrite (lock, persist-after-turn, hydrate-on-miss, manager eviction) + `chatStream` awaits the async `isBusy`; keyed by `{user_id, org_id, session_id}`
- [x] Unify `ai_logs` writes: single writer in `packages/ai` writing to `forge.ai_logs` (both engines) — Pass 14: `packages/ai/src/aiLogs.js` `writeAiLog` fire-and-forget (missing table → warn+skip; other errors fail-loud); wired into chat/stream agent + org steps (success + failure rows); `forge.ai_logs` added to migration 008 + health readiness set
- [ ] **🔷 SUPABASE TASK:** apply `008_forge_schema.sql` (forge schema + RLS) before unifying ai_logs / diagnostics
- [ ] Legacy apps read-only display mode (EC-39): point legacy reads at `forge.*` views, add "continue in Forge" banner — **defers to Phase 5 if legacy stays read-write for now**

## 4. Phase 3 — Data unification + diagnostics

### packages/diagnostics (Appendix A step 6)
- [x] Port Agentforge `orgConfigService.runPreFlightCheck` → `packages/diagnostics`: instance-URL validation, license check, ECA package by SubscriberPackageId (one unified ECA — D7), `discoverPermissionSets`, `findOrCreateAgentUser` (reactivate-if-deactivated), org-type detection (EC-13)
- [x] Capability split: `agents` needs license+package+provisioning; `org_change` needs package + valid token (EC-16)
- [x] Server-side 24h cache + promise dedup writing to `forge.diagnostics` (replaces localStorage cache); table-missing degrades gracefully
- [x] Unit tests: each check + state machine + cache TTL/dedup/forceRecheck (23 tests)
- [x] `invalidateAndRecheck` on 401/403 (EC-14) — Pass 15: `invalidateDiagnostics` in `packages/diagnostics` (delete stale `forge.diagnostics` row + drop the in-flight dedup slot, S-2 degrade/fail-loud) wired into the org-connections **refresh-failure path** via the `onRefreshFailure` hook in the diagnostics route (fires inside the refresh path on 401/403 only, so a transient 500 never drops the cache) — the next read re-checks fresh instead of serving a stale 24h "ok"; route still surfaces 401 → "Reconnect org" (EC-10)

### Diagnostics API (plan §10.1)
- [x] `GET /api/v1/diagnostics` (cached) + `POST /api/v1/diagnostics/recheck` (force) — `backend/src/routes/diagnostics.js`, forge-schema client for cache
- [x] Mounted in `backend/src/app.js`; route tests incl. 401-reconnect + 400/404 paths (5 tests)
- [x] `forge.diagnostics` server cache fail-loud (S-2 code: real-table write/read, missing table → uncached run, other errors throw proper Errors)
- [ ] **🔷 SUPABASE TASK:** apply migration `008` so `forge.diagnostics` (and the other forge tables) persist for real (code is written + tested; this lands the schema)

### Data
- [ ] Re-link flow verification against real project (after 010 applied)
- [ ] Extend `change_records` to agent deploys: `kind: 'org_change' | 'agent_deploy'` (EC-37: snapshot pre-deploy YAML/Apex into the record) — **🔷 SUPABASE TASK:** migration `011` (change_records kind + agent snapshot columns)
- [ ] **🔷 SUPABASE TASK:** backfill `forge.org_connections` from `orgforge.org_connections` (idempotent)

## 5. Phase 4 — Real router + inline cards + onboarding

### packages/ai (classifier)
- [x] `routeIntent` → `{capability: agent|org_change|both|clarify, confidence, reason, overrideSource}` — Gemini Flash default, ~200 tokens (§7.2); fails CLOSED to clarify if model unreachable
- [x] Deterministic overrides applied AFTER the model (§7.1): refund/delete-field/validation-rule/permission-set → `org_change` (refund excludes guardrail phrasing; overrides never fire on `both` — EC-23)
- [x] Golden test set **49 prompts** incl. adversarial, unsafe refusals, low-confidence, and override-beats-model cases (§15.1)
- [x] Every decision logged to `forge.routing_log` (§7.4) via `POST /api/v1/chat/route` — fail-loud since Pass 10 (missing table → warn + skip; any other DB error → 500)
- [x] Unified SSE event envelope: `{type, capability, content, summary, errors, card}` — additive only (§10.2); `createSseEnvelope` + `serializeSseFrame`
- [x] `POST /api/v1/chat/stream` — the Copilot SSE endpoint wiring the router → engines (Phase 4 prep). Routed `capability` is authoritative; absent ⇒ re-route + log. Single-flight 409 pre-SSE; `both` runs agent → org sequentially (EC-23); clarify short-circuits. Client disconnect aborts the agent generation. (File upload via multer = follow-up.)

### Router + session store
- [x] `POST /api/v1/chat/route` (standalone classifier) mounted + tested
- [x] `POST /api/v1/chat/stream` (SSE) — mounted + tested (16 tests: framing, handoff, both-order, clarify, abort, 409, 400/401/404, unknown-type degrade)
- [x] `POST /api/v1/chat/stream` multer file-attach support (legacy parity) — Pass 16: `upload.single('file')` (memory storage, 10MB, legacy mime allowlist), document text extracted (pdf-parse / mammoth / utf-8) and injected into the engine prompt via the legacy SYSTEM-INJECTION block (50k cap); routing + ai_logs keep the raw message; empty / unreadable documents → pre-SSE 400; MulterError / allowlist rejection → 400. Frontend: attach button + file chip, multipart FormData client (file: File). **Images: Pass 21 closed this gap** — Gemini `inlineData` parts for the agent engine, vision description for the org engine
- [x] `DELETE /api/v1/chat/:contextId` explicit conversation reset (legacy parity, plan §10.1) — Pass 19: `chatContext.js` (mounted at `/api/v1/chat`, reserved names → 400), `agentEngine.resetConversation` (abort → drop manager → clear Redis lock + state), store `clearConversation`; contract gap row removed, §2.7 + §7 changelog. Client: `resetChatSession()` + Clear button resets the old spine server-side
- [x] Image attachments via Gemini `inlineData` (legacy parity, plan §10.1) — Pass 21: agent engine receives `[{text},{inlineData}]` parts (pre-init guard for the fresh-session `toLowerCase` crash); org engine gets a `describeImage` vision description injected via SYSTEM-INJECTION (throw/empty → `deploy_warning` + degrade); **closes the last §5 contract gap**
- [x] EC-14 package-missing auto-recheck — Pass 22: a fresh run whose verdict
  detects `checks.package.installed === false` is **never pinned** — the
  `forge.diagnostics` row is cleared instead of cached (missing-table degrades;
  real delete errors fail loudly), and a cached package-missing verdict (pre-rule
  rows) is treated as stale — every read re-runs the pre-flight until the package
  is installed, so the banner self-heals without a manual Re-check (completes
  the EC-14 `invalidateAndRecheck` behavior, plan §7)
- [x] `forge.chat_sessions` as shared context spine (§7.3) — chat/stream appends capability segments + rolling compressed_history per turn (Pass 11); `session_id` column added to 008; 🔷 table lands with the migration
- [x] Handoff: `both` capability → sequential execution with per-segment progress cards (EC-23) — Pass 17: chat groups progress by the capability tag (agent card, then org-change card, each with a labeled pill); the interleaved handoff status is tagged org_change so it opens the org card. (EC-35 serialize+queue when both touch the same metadata stays engine-internal / deferred.)

### Frontend (Appendix A step 4) — `frontend`
- [x] Scaffold `frontend` (Next.js 16 + Tailwind v4 `@theme`) + added to root workspaces + `dev:web`/`lint`/`typecheck` scripts; build passes (8 static routes + `/` → `/dashboard` 307)
- [x] Global `AppShell`/`Sidebar`/`Header` (OrgForge slimmed to 5 items, §6.1) with org pill + avatar
- [x] Login page (Supabase) + 3-step onboarding: sign-in → connect Salesforce (Prod/Sandbox/Scratch OAuth) → optional GitHub (§12.2)
- [x] Dashboard: hero "Ask Forge" + 3 stat tiles + attention banner + unified activity feed (§6.2)
- [x] Copilot: port Agentforge `chat/page.tsx` (SSE reader, markdown, CodeBlock, BuildProgressCard) + capability chip (§6.3) — `lib/chat-stream.ts` + `components/chat/*`; pins routeIntent (Auto/Agent/Org Change/Both); grouped progress cards; clarify short-circuit renders natively; no-org → connect CTA
- [x] Inline org-change cards in chat (§6.3): orgEngine rewritten as a staged orchestrator over OrgForge's real services (parse → generate → impact → gates → dry-run → deploy → record), honest per-stage gaps, `artifact`/`blast_radius`/`refusal_gates`/`dry_run`/`deploy`/`record` SSE cards rendered by `OrgChangeCard` (6 tests)
- [x] Agents page (read-only over `GET /api/v1/agents` — live list via tenant creds + Agentforge `SalesforceClient`, SSRF-guarded, 7 route tests) — **🔷 SUPABASE TASK (remaining):** `forge.agents` cache table comes with 008; populate from `sfClient.getAgents` + deploy events to replace the live call; dashboard agents tile now fetches this route
- [x] Changes & Audit page (OrgForge history renamed — search + status filters + expandable signed-record cards over `GET /api/v1/change-records`) + Settings (Connections with disconnect + Integrations/GitHub install + repo picker with the D8 audit-status indicator + Advanced) — Suspense-wrapped; `org-context` setters memoized
- [x] Design tokens: Tailwind v4 `@theme` with OrgForge `brand-*` mapping (§6.5)
- [x] GitHub onboarding step: install URL + repo picker + skip path (§12.3) — shared `GithubConnectCard` (Settings + login step 3); **persistent audit-status indicator (D8)** — "Audit records committed to `<repo>`" vs "saved locally"
- [x] `FORGE_UNIFIED_FRONTEND=on` canary flag + stub rule-based classifier chip (Pass 12) — `NEXT_PUBLIC_FORGE_UNIFIED_FRONTEND` gate in `lib/flags.ts`; canonical zero-dep `classifyWithStub` in `packages/ai` (mirrors §7.1 overrides via shared `overrides.js`, 9 tests); live rule-based routing preview in `CapabilityChip` (labeled "Stub", pin still wins, never sent to the server)

### Migration & ops
- [x] Copy/brand audit (§11.3): grep `agentforge\|orgforge` in `frontend/src` UI strings — clean (provenance comments only); metadata/title/OG = "Forge"; chat greeting = "Forge copilot"
- [x] `.env.example` finalized; `SESSION_SECRET`/`LEGACY_JWT_SECRET` marked transition-only
- [x] `npm run typecheck` merged; per-app lint (`frontend`: tsc + eslint clean)

## 6. Phase 5 — Decommission & soak (final)

- [ ] Canary: internal team + 2 friendly customers on flags; watch route mis-classifications, SSE drops, diagnostics false-negatives (§14.3)
- [ ] 2-week soak; fix regression deltas vs Phase-0 oracle
- [ ] Point old domains at new app (301s); verify DNS atomically (D5: never 404)
- [ ] Remove the legacy `/api/auth` + `/api/org` alias mounts; stop legacy deploys
- [ ] **🔷 SUPABASE TASK:** after sign-off — drop legacy `public.salesforce_connections` / old `orgforge` views (additive-first; never delete before sign-off)
- [ ] Delete `LEGACY_JWT_SECRET`, `SESSION_SECRET`, `FORGE_MOUNT_AGENTFORGE` block
- [ ] Optional: rename internal identifiers (npm names, schemas) — explicitly out of merge scope

---

## 7. 🔷 SUPABASE TASKS — all deferred (applied via Supabase MCP)

> These are the only tasks the user executes outside this repo. Order matters —
> each is gated by the migration numbered above.

| # | Task | Migration/file | Blocks |
|---|---|---|---|
| S-1 | Apply `010_forge_legacy_rpc.sql` (legacy table + re-link RPCs) | `supabase/migrations/010_forge_legacy_rpc.sql` | link-legacy end-to-end |
| S-2 | Apply `008_forge_schema.sql` (forge schema, tables, RLS) | `supabase/migrations/008_forge_schema.sql` | ai_logs, diagnostics, agents, chat_sessions, routing_log |
| S-3 | Apply OrgForge 001–007 if not already present | `/Users/abhi/Enlight/archive/OrgForge/supabase/migrations/` (legacy repo archived, Pass 33) | everything |
| S-4 | Confirm Supabase Auth config (email provider, redirect URLs, rate limits) | Dashboard → Auth | login flow |
| S-5 | Migration 011: change_records `kind` + agent-deploy snapshot columns | draft when Phase 3 starts | EC-37 rollback-for-agents |
| S-6 | Backfill `forge.org_connections` from `orgforge.org_connections` (idempotent) | SQL job | data continuity |
| S-7 | Post-sign-off: drop legacy `public.salesforce_connections` + old views | Phase 5 only | — |

## 8. Dependency order (what to build next)

```
1. ✅ packages/diagnostics (done — 23 tests) + api routes (done — 5 tests)
2. ✅ packages/ai (done — 19 tests) + POST /api/v1/chat/route (done — 4 tests)
3. ✅ api: chat/stream SSE endpoint (Copilot) — done (16 tests); org-engine pipeline internals land with the Phase 4 frontend
4. ✅ frontend scaffold + shell + login + 3-step onboarding (done — tsc/lint/build green, smoke-verified); Copilot port + inline cards next (step 5)
5. ✅ Dashboard + Copilot (done — chat page streaming live over chat/stream; chips + cards wired); inline org-change cards in chat next
6. ✅ Agents page + activity feed (done — GET /api/v1/agents live, 12 tests incl. the read-through cache paths; page + dashboard tile wired; Refresh sends `?refresh=1` to bypass the cache)
7. ✅ Changes & Audit + Settings pages (done — signed-record trail + Connections/GitHub/Advanced; SSR smoke 200, lint/tsc/build clean)
8. ✅ Inline org-change cards in chat (done — orgEngine pipeline stages + 6 card types; 6 tests)
9. ✅ **S-2 code wiring (Passes 10–11)** — `forge.agents` read-through cache, `routing_log` + diagnostics + `chat_sessions` fail-loud (missing table degrades; other errors throw); session spine (§7.3) with stable per-org session ids; backend **136/136**; 🔷 apply migration 008 via MCP next
9b. ✅ **Canary flag + stub classifier (Pass 12)** — `FORGE_UNIFIED_FRONTEND=on` + rule-based stub chip (§14.2 Phase 1); backend **145/145**
10. ✅ **Redis conversation state + unified ai_logs (Pass 14)** — §7.3 busy-lock + state persistence (token-owned release, in-memory degrade) + `writeAiLog` in packages/ai wired to both engine steps; backend **177/177**; live-Redis smoke verified
11. ✅ **EC-14 invalidateAndRecheck (Pass 15)** — diagnostics cache invalidated on 401/403 via the refresh-failure hook; backend **183/183**
12. ✅ **multer file-attach (Pass 16)** — chat/stream accepts documents (pdf/docx/txt/md) via multipart, injects extracted text into the engine prompt (legacy parity); frontend attach button + FormData client; backend **199/199**
13. ✅ **EC-23 per-segment progress cards (Pass 17)** — `both` renders one labeled card per capability; backend **200/200**
14. Canary/soak/decommission    ← needs all
```

## 9. Validation gates

| Gate | Command | When |
|---|---|---|
| Unified tests | `cd unified-forge && npm test` (target 30+ → grows) | after every package |
| OrgForge baseline (archived Pass 33) | re-homed suite `backend/src/orgforge/*.test.js` — part of `npm test` (402/402) | after API mount changes |
| Merged smoke | flags ON + curl health/auth/orgs/link-legacy | after API changes |
| Frontend | `cd frontend && npm run lint && npm run typecheck` | after frontend work |
| E2E (later) | Playwright onboarding + chat + dual-run matrix (§15.2–15.3) | Phase 4 |
