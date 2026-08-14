# Unified Forge — API Contract (frozen)

**Status:** FROZEN baseline — the single source of truth for the unified API surface.
**Date:** Pass 18 (Phase 0 leftover). Any change to a documented endpoint, request, or response
shape requires a changelog entry below (additive-only policy until Phase 5 sign-off).
**Base URL:** `/api/v1` (all unified + capability endpoints). Transition aliases under `/api/`
(Agentforge) are listed separately and are removed in Phase 5.

Supersedes, as the forward contract:
- `OrgForge/docs/architecture/API.md` — OrgForge v2.0 REST & Real-Time spec
- `Agentforge/docs/api.md` — Agentforge internal API doc

**Docs set (one product):** [`unification_plan.md`](./unification_plan.md) (design) · [`DECISIONS.md`](./DECISIONS.md) (decisions) · [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (tracker) · [`PRD.md`](./PRD.md) (requirements) · [`API.md`](./API.md) (readable reference — this file is the frozen contract) · [`APP_FLOW.md`](./APP_FLOW.md) (flows) · [`TECH_STACK.md`](./TECH_STACK.md) (stack) · [`DESIGN.md`](./DESIGN.md) (design system) · [`PHASE5_PLAN.md`](./PHASE5_PLAN.md) (phase 5) · [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (audit) · legacy PRDs ([`OrgForge`](./legacy/OrgForge_PRD.md) · [`Agentforge`](./legacy/Agentforge_PRD.md))

---

## 1. Conventions

### 1.1 Auth & tenancy
- Every endpoint except those marked **public** requires
  `Authorization: Bearer <supabase_jwt>` (Supabase session JWT).
- `requireAuth` verifies the JWT; `tenantIsolation` scopes every downstream query to
  `req.user.id`. **RLS is never a backstop** on service-role clients — every query passes the
  verified user id explicitly.
- **Public:** `GET /api/v1/health`, `GET /api/v1/health/db`, `GET /api/v1/auth/salesforce/callback`,
  `GET /api/v1/auth/github/callback`.

### 1.2 Errors
- Body-parser / zod failures → `400 { error, issues?: [...] }` (zod: `issues` = `error.errors`).
- Unknown API path → `404 { error: 'Route not found' }` (JSON, never HTML).
- Unhandled errors → `500 { error: 'Internal server error' }` — sanitized, no stack, no internals.
- Pre-SSE errors (validation, credentials, single-flight, attachments) are **plain JSON**;
  once SSE has started, failures are **SSE error frames** (see §1.3).

### 1.3 SSE envelope (`POST /api/v1/chat/stream`)
Every frame is the unified envelope: `{ type, content?, summary?, errors?, card?,
capability?, ...additive }`.
- `type` vocabulary — Agentforge vocabulary, extended (`packages/ai` `SSE_TYPES`):
  `message`, `status`, `action`, `error`, `build_widget`, `stream_chunk`, `deploy`,
  `deploy_success`, `deploy_warning`, `deploy_error`. Unknown types are rejected by the
  envelope builder; the stream degrades them to a `status` frame (never kill the stream).
- `card` — inline card rendered inside the chat (plan §6.3): `blast_radius`,
  `refusal_gates`, `artifact`, `dry_run`, `deploy`, `record`, `build_progress`.
- `capability` tag on engine frames: `agent` | `org_change` (absent on pre-engine frames).
  `both` runs emit agent-tagged frames, then an `org_change`-tagged handoff status, then
  org-tagged frames — the frontend splits per-segment progress cards on this tag (EC-23).
- Termination: `[DONE]` marker on success; `error` frame on failure. Client disconnect
  aborts in-flight agent generation server-side.

---

## 2. Unified endpoints (frozen)

### 2.1 Health

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/v1/health` | public | — | `200 { status: 'ok', timestamp }` |
| GET | `/api/v1/health/db` | public | — | `200 { status: 'healthy', schema: 'forge', missingTables: [], timestamp }`; `503 { status: 'unhealthy', schema: 'forge', missingTables, timestamp }` (+ `migrationPending: true, note` when the `forge` schema itself is absent) |

`/health/db` probes all six `forge.*` tables (`org_connections`, `agents`, `chat_sessions`,
`routing_log`, `diagnostics`, `ai_logs`). Missing-table errors (migration 008 pending, S-2)
degrade to 503 with the exact missing tables; any **other** DB error fails loudly (500).

### 2.2 Auth

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/v1/auth/link-legacy` | JWT + tenant | `{ legacyToken: string }` | `200 { linked: boolean, agentforgeUserId: string, reason?: string }` |

One-time re-link of a leftover Agentforge JWT to the signed-in Supabase user; re-parents all
`salesforce_connections` for that legacy user id. **Best-effort, never a blocker** (EC-02/EC-38):
expired/foreign tokens are silently discarded. The guaranteed path is the one OAuth flow.
OrgForge OAuth endpoints (`/api/v1/auth/salesforce/*`, `/api/v1/auth/github/*`) are preserved
verbatim — see §4.

### 2.3 Diagnostics (pre-flight)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/v1/diagnostics` | JWT + tenant | `?orgId=<18-char id>` | full pre-flight report (license, ECA package by SubscriberPackageId, permission sets, Einstein Agent user, org type) with `checkedAt` + `cached` flags |
| POST | `/api/v1/diagnostics/recheck` | JWT + tenant | `?orgId=<18-char id>` | same shape, forced fresh run |

- Cached server-side 24h per (user, org) with promise dedup; `recheck` bypasses.
- Credentials auto-refresh with per-org dedup (EC-10): refresh failure → `401 { error: 'Reconnect this org — Salesforce access could not be refreshed' }`; missing row → `404 { error: 'Org connection not found' }`.
- On an auth break (401/403) the refresh-failure hook **invalidates** this org's diagnostics
  cache so the next read re-checks fresh (EC-14 `invalidateAndRecheck`); transient 500s leave
  the cache untouched. A run that detects `package.installed=false` is **never pinned**: the
  row is cleared instead of cached, so every read re-checks until the package is installed
  (the banner self-heals — no manual `POST /recheck` needed).

### 2.4 Routing

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/v1/chat/route` | JWT + tenant | `{ message: string (1–50 000), pinned?: 'agent'\|'org_change'\|'both'\|'clarify' }` | `200 { capability, confidence, overrideSource? }` |

Standalone classifier (Gemini + deterministic §7.1 overrides). Every decision is logged to
`orgforge.routing_log` (prompt hash, capability, confidence, override source) — best-effort;
the route answers even while migration 008 is pending.

### 2.5 Copilot stream (SSE)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/v1/chat/stream` | JWT + tenant | JSON `{ message, orgId, capability?, pinned?, sessionId? }` or `multipart/form-data` (+ `file`) | `text/event-stream` (§1.3) |

- `message` 1–50 000 chars (EC-28 zod cap); `orgId` 3–18; `sessionId` optional (defaults per
  user+org).
- `capability` is **authoritative** when present; absent ⇒ the stream classifies itself
  (defense in depth for direct callers) and logs to `routing_log`. Routing and `ai_logs`
  always see the **raw** message — never the file-injected text.
- `clarify` short-circuits: status frame + clarification message, no engine work.
- Single-flight: a busy agent session → `409 { error }` pre-SSE (checked before and after the
  credential await). Keyed `{user_id, org_id, session_id}` in Redis (plan §7.3).
- Credentials: `404` / `401` pre-SSE (same wording as §2.3). Instance URL validated
  (https + allowlist) — SSRF guard.
- Attachments (multer, legacy parity): field `file`, memory storage, 10MB cap, mime allowlist
  (pdf/docx/txt/md + png/jpeg/webp). Documents: extracted text (pdf-parse / mammoth / raw) is
  injected into the engine prompt via the legacy SYSTEM-INJECTION block (50k injected-char cap).
  Images (Pass 21, Gemini `inlineData`): the **agent** engine receives the legacy
  `[{ text }, { inlineData }]` parts (base64 + mimeType) directly; the **org-change** engine
  receives a vision description (`packages/ai` `describeImage`, hint = raw message) injected
  through the same SYSTEM-INJECTION block. A describe failure or empty result degrades to the
  raw message with an explicit `deploy_warning` frame (deliberate warn-and-continue — refusal
  gates + dry run remain the safety net).
  - MulterError / allowlist rejection / unreadable file / empty document extraction → **400 plain JSON**.
- Engine frames are capability-tagged; `both` runs agent → org sequentially (EC-23).
- Session spine: capability segments + bounded transcript persisted to `orgforge.chat_sessions` **after** engine work (durable context memory — Pass 47; `transcript`/`context_summary` from migration 012; cold starts resume from summary + recent verbatim tail)
  (a persistence failure surfaces as an error frame, never blocks a deployment).
- `orgforge.ai_logs` writes are fire-and-forget (never fail the request) — plan §3/§7.3.

### 2.6 Agents

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/v1/agents` | JWT + tenant | — | `200 { agents: [...], orgId, fetchedAt, cached: boolean }` |
| GET | `/api/v1/agents/:developerName/yaml` | JWT + tenant | `?orgId=<18-char id>` | `200 { developerName, yaml }` · `404 { error, detail }` |

- `:developerName` = the AiAuthoringBundle fullName (≤200 chars); `orgId` required. Retrieves the **generated `.agent` YAML** for one agent via Metadata API `retrieve()` (async zip job, ~3s polls — slow; clients should use a heavy timeout). `404` when the bundle is not retrievable (built outside Agentforce or deleted). No server cache — the bundle can change on every deploy.

### 2.7 Session context (reset / history / resume)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| DELETE | `/api/v1/chat/:contextId` | JWT + tenant | `?orgId=<18-char id>` | `200 { success: true }` |
| GET | `/api/v1/chat/sessions` | JWT + tenant | `?orgId=<18-char id>` | `200 { sessions: [{ sessionId, updatedAt, lastSummary, hasSummary }] }` |
| GET | `/api/v1/chat/sessions/:sessionId` | JWT + tenant | `?orgId=<18-char id>` | `200 { sessionId, transcript, contextSummary, segments, updatedAt }` · `404` foreign/unknown |

- `contextId` = the client's session id (i.e. `default` when the stream was called without an explicit `sessionId`); `orgId` required. Reserved names `stream` / `route` → 400.
- Explicit conversation reset (legacy Agentforge `DELETE /api/chat/:contextId` parity): aborts any in-flight generation, drops the live `ConversationManager`, and clears the Redis busy-lock + persisted state — the escape hatch a crash-stuck request needs (without it, a dead run blocks the conversation with 409s for up to the 10-min lock TTL).
- `GET /chat/sessions` — tenant-scoped light list (newest `updated_at`
  first, limit clamped 1–50) for the History picker: `lastSummary` (newest
  capability-segment summary) + `hasSummary` (flash-compressed head present),
  never the full transcript. Missing table (migration 008 pending) →
  `200 { sessions: [] }` (S-2 degrade).
- `GET /chat/sessions/:sessionId` — full-spine restore for resume
  (`transcript` parsed from both JSONB arrays and legacy string-encoded
  forms, plus `contextSummary` + capability segments). Triple-scoped via the
  shared spine lookup — another user's/org's session reads as `404`, never a
  leak. Lifecycle: session ids live in the browser's `sessionStorage`
  (per-tab isolation); the nightly `session-cleanup` job
  (`CHAT_SESSIONS_RETENTION_DAYS`, default 7) garbage-collects orphaned rows
  (Pass 49/50).
- Session key composed exactly like chat/stream's (`{userId}|{orgId}|{contextId}`). Idempotent: resetting a free/absent conversation is a no-op success.
- Scope note: the abort is best-effort/in-process (the live Gemini session is per-instance); the Redis clear is cross-instance.

- Live Salesforce Agent/Agentforce list fetched from the connected org's Tooling/REST API,
  **SSRF-guarded** (https + instance-url allowlist).
- Normalized **additive** shape: Agentforge field names preserved, plus a UI-friendly `name`
  alias (`masterLabel` when present, else `developerName`). Cached server-side.

### 2.8 Refusal log (PRD FR-5 "refusal log")

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/v1/refusal-logs` | JWT + tenant | `?orgId=<18-char id>` (optional) | `200 { refusals: [...] }` |

- The dedicated refusal audit trail: every gate that REFUSED (REF-01..10) plus
  the REF-07 production acknowledgments, from the legacy `refusal_logs` table
  (public schema, OrgForge migration 003), joined with the originating change
  intent.
- **Tenant isolation:** `refusal_logs` has no user column — the query joins
  through `change_intents` (`change_intent_id` FK, postgREST `!inner` embed)
  and filters `change_intents.user_id = req.user.id` (optional `orgId` filters
  `change_intents.org_id`). RLS is never a backstop on service-role clients.
- Entry shape (camelCase, `user_id` stripped): `{ id, changeIntentId,
  gateCode, reason, missingEvidence, unblockPath, orgId, intent, createdAt }`.
- Degradation (S-3): a missing `refusal_logs` / `change_intents` table
  (OrgForge migrations 003–005 pending) → `200 { refusals: [], note }`;
  any OTHER DB error → `500 { error: 'Failed to load refusal log' }`.

---

## 3. Changelog vs legacy docs

### 3.1 vs Agentforge `docs/api.md` (superseded)

| Legacy | Unified replacement | Notes |
|---|---|---|
| `GET /api/auth/login` | `POST /api/v1/auth/link-legacy` + OrgForge `/api/v1/auth/salesforce/connect` | Session-cookie PKCE → Supabase JWT; legacy re-link is a one-time convenience |
| `GET /api/auth/callback` | `/api/v1/auth/salesforce/callback` | same OAuth callback role |
| `GET /api/auth/status` | — (no direct port) | session → JWT; the Supabase JWT itself is the auth status; connection state lives per-connection under `/api/v1/orgs` |
| `POST /api/chat/stream` | `POST /api/v1/chat/stream` | Same SSE vocabulary + multer attach; adds capability routing, single-flight 409, per-segment tags, session spine, ai_logs |
| `GET /api/org/health-check` | `GET /api/v1/diagnostics` | Richer pre-flight (license, package, perms, Einstein user, org type), 24h cache + recheck + EC-14 invalidation |
| `GET /api/org/instance` | `GET /api/v1/diagnostics` (org type) + `GET /api/v1/orgs/:orgId/context` | superseded, no direct port |
| `POST /api/seeding/generate`, `DELETE /api/seeding/cleanup` | — | Planned V7 endpoints — **not carried** into the unified surface |

### 3.2 vs OrgForge `API.md` (preserved)

All OrgForge v2.0 endpoints are mounted **unchanged** under the same `/api/v1` base — the
contract is preserved verbatim (see §4). Changes around it:
- **Auth model:** OrgForge's session-cookie auth → Supabase JWT bearer + `tenantIsolation`
  (the transition `express-session` middleware and the Agentforge mount it served were
  removed in Phase 5, 2026-08-14).
- `/health/db` extended from OrgForge's table check to the six `forge.*` tables with
  503/degraded semantics (§2.1).
- New unified endpoints added: diagnostics (§2.3), chat/route (§2.4), chat/stream (§2.5),
  agents (§2.6), link-legacy (§2.2).
- **Error contract unified:** every API path now returns sanitized JSON errors; zod failures
  carry `issues`.

---

## 4. Capability routers (mounted unchanged)

| Mount | Router (OrgForge) | Contract source |
|---|---|---|
| `/api/v1/auth` | `routes/auth.js` | OrgForge API.md §1 |
| `/api/v1/auth/github` | `routes/github.js` | OrgForge API.md §1.2 |
| `/api/v1/orgs` | `routes/orgs.js` (`GET /`, `POST /:orgId/index`, `GET /:orgId/package-health`, `GET /:orgId/context`, `GET /:orgId/status`, `GET /:orgId/index-stream`, `DELETE /:orgId`) | OrgForge API.md §1.3, §6 |
| `/api/v1/changes` | `routes/changes.js` (`POST /intent`, `POST /intent/:intentId/clarify`, `POST /generate`) | OrgForge API.md §2, §3.1 |
| `/api/v1/impact` | `routes/impact.js` (`POST /:intentId/impact-brief`) | OrgForge API.md §3.2 |
| `/api/v1/gates` | `routes/gates.js` (`POST /evaluate`) | OrgForge API.md §4.1 |
| `/api/v1/deployments` | `routes/deployments.js` (`POST /dry-run`, `GET /status/:id`, `POST /backup`, `POST /backup/status/:id`, `POST /execute`, `GET /status-stream/:id`) | OrgForge API.md §4.2–4.3 |
| `/api/v1/rollback` | `routes/rollback.js` (`POST /`) | OrgForge API.md §5.2 |
| `/api/v1/change-records` | `routes/changeRecords.js` (`GET /`) | OrgForge API.md §5.1 |

These are gated on `FORGE_UNIFIED_API=on` (capability phase flag, plan §5.1).

~~**Transition aliases (Agentforge, gated on `FORGE_MOUNT_AGENTFORGE=on`):** `/api/auth`~~
~~(Agentforge auth router) and `/api/org` (orgHealth) mirror the legacy paths for one release~~
~~cycle. They serve the **legacy frontend only** and are deleted in Phase 5.~~
**Removed (Phase 5, 2026-08-14):** the `/api/auth` + `/api/org` transition aliases and the
`FORGE_MOUNT_AGENTFORGE` gate are gone — the legacy apps are decommissioned. No `/api/v1/*`
consumer is affected.

---

## 5. Known gaps & planned items

| Item | State |
|---|---|
| Migration 008 (S-2) | All `forge.*` consumers degrade gracefully; `/health/db` reports `migrationPending` until applied. |

---

## 6. Stability policy

- **Additive-only** until Phase 5 sign-off: new fields are always additive; no field removal,
  renames, or response-shape changes without a changelog entry in §7 + a migration note.
- New endpoints get a row in §2 and a mapping in §3 when they replace a legacy surface.
- ~~When Phase 5 removes the transition mounts (`/api/auth`, `/api/org`), strike §4's alias
  paragraph and bump the changelog — no consumer of `/api/v1/*` is affected.~~
- **Done (2026-08-14):** the transition mounts were removed; §4's alias paragraph is struck
  above and the changelog was bumped — no consumer of `/api/v1/*` was affected.

## 7. Forward changelog

Dated entries for every contract change (per §6). Newest first.

| Date | Change | Breaking? | Migration note |
|---|---|---|---|
| EC-37 (2026-08-14) | **Added** `kind` (`'org_change'` default / `'agent_deploy'`), `agentName`, `agentSnapshot` to `GET /api/v1/change-records` responses — agent deploys now produce signed records via the agent engine (`deploy_success` → signed `agent_deploy` record; failures surface as `deploy_warning`, never block the stream). Additive fields; existing org_change rows default to `kind: 'org_change'` | no — additive | Migration `014_change_records_agent_kind.sql` (adds `kind`/`agent_name`/`agent_snapshot` to `orgforge.change_records`); 🔷 apply via MCP |
| Phase 5 decommission (2026-08-14) | **Removed** the legacy transition aliases `/api/auth` + `/api/org` (Agentforge auth + orgHealth routers) and the `FORGE_MOUNT_AGENTFORGE` gate; the `express-session` middleware and its `SESSION_SECRET` requirement are gone (§4 alias paragraph struck). Only the legacy surfaces were removed — no `/api/v1/*` consumer is affected | no — breaking-by-design for the legacy aliases only | None |
| Pass 52 (Aug 2026) | **Docs only** — §2.5/§2.7 updated for Passes 46–51 (context memory, session history/resume, expiry job, schema rename `forge.*` → `orgforge.*`); contract shape unchanged | no | None |
| Pass 50 (Aug 2026) | **Added** `GET /api/v1/chat/sessions` + `GET /api/v1/chat/sessions/:sessionId` (§2.7) — tenant-scoped session list (light: `sessionId`, `updatedAt`, `lastSummary`, `hasSummary`; missing table → `[]`) and full-spine restore (transcript parsed from JSONB + legacy string forms; foreign/unknown → 404). Powers the History picker resume flow | no — additive (new GETs; existing reset/stream untouched) | Reads `orgforge.chat_sessions` (008 + 012); 012 adds `transcript`/`context_summary` columns |
| Pass 47 (Aug 2026) | **Behavioral (documentation)** — session spine now persists a bounded text-only `transcript` + flash-compressed `context_summary` per turn (migration 012); agent engine resumes cold starts from summary + recent tail; org engine gets the `priorContext` digest. No wire-shape change to §2.5 — the stream contract is unchanged | no — additive (durable memory behind the same endpoint) | 012 adds `transcript JSONB` + `context_summary TEXT` to `orgforge.chat_sessions` |
| Pass 46 (Aug 2026) | **Behavioral** — credential-refresh 401s now carry `code: 'ORG_RECONNECT_REQUIRED'` (§2.3, §2.5, agents, orgforge routes) so clients can distinguish a Salesforce-org reconnect from session expiry; `error` wording normalized (em-dash removed). Additive `code` field; clients that ignore it keep current behavior | no — additive field | None |
| Pass 27 (Aug 2026) | **Added** `GET /api/v1/agents/:developerName/yaml` (§2.6) — the generated `.agent` YAML for one agent (PRD FR-5 "detail drawer with YAML"); Metadata API AiAuthoringBundle retrieve via the wrapped Agentforge SalesforceClient (`retrieveAgent`), tenant-scoped creds + SSRF guard; `404 { error, detail }` when not retrievable. Frontend: **YAML detail drawer** on /agents (slide-in, loading/error/retry, Copy, Edit-in-chat) | no — additive (fills a documented PRD gap) | No schema change; reads live org metadata on demand |
| Pass 25 (Aug 2026) | **Added** `GET /api/v1/refusal-logs` (§2.8) — dedicated refusal audit trail (PRD FR-5 "refusal log" + OrgForge Group 7); tenant-scoped through `change_intents` (the table has no user column); optional `?orgId`; missing-table → `200 { refusals: [], note }` (S-3), other DB errors → 500. Frontend: **Refusals** tab on Changes & Audit (gate badge, plain-language reason, missing evidence, unblock path, org, discuss-in-chat) | no — additive (fills a documented PRD gap) | Reads the legacy `public.refusal_logs`; no schema change |
| Pass 22 (Aug 2026) | **Behavioral** — diagnostics caching (§2.3): a run detecting `package.installed=false` is never pinned (row cleared, not cached) and a cached package-missing verdict is treated as stale; every read re-checks until installed (banner self-heals, no manual `POST /recheck`). Removed from §5 gaps | no — additive (fills a documented gap); strictly more accurate verdicts | No migration; cache rows self-correct on next read |
| Pass 21 (Aug 2026) | **Added** image attachments via Gemini `inlineData` (§2.5) — agent engine receives legacy `[{ text }, { inlineData }]` parts; org engine gets a `describeImage` vision description injected as document text; removed from §5 gaps. Frontend picker advertises png/jpeg/webp | no — additive (fills a documented gap) | Legacy Agentforge image flow maps 1:1; org-change images are a new capability (vision description) |
| Pass 19 (Aug 2026) | **Added** `DELETE /api/v1/chat/:contextId` (§2.7) — explicit conversation reset (legacy Agentforge parity); removed from §5 gaps. Client `resetChatSession()`; Clear button resets the old spine server-side before rotating | no — additive (fills a documented gap) | Legacy consumers of Agentforge's `DELETE /api/chat/:contextId` now call `/api/v1/chat/:contextId?orgId=…` with the Supabase JWT |
| Pass 18 (Aug 2026) | Initial freeze — `docs/api_contract.md` created; unified `/api/v1` surface documented vs both legacy docs | — | Baseline; §3.1 maps legacy Agentforge consumers, §3.2 documents behavior changes around preserved OrgForge endpoints |
