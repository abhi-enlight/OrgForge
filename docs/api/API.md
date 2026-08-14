# Forge — API Reference

**Base URL:** `/api/v1` (proxied to the unified backend, port **3001**; `frontend` rewrites `/api/*` via `next.config`).
**Authoritative contract:** [`api_contract.md`](./api_contract.md) — **frozen**, additive-only until Phase 5 sign-off. This document is the readable developer reference; any discrepancy, the contract wins.
**Legacy superseded docs:** OrgForge `docs/architecture/API.md`, Agentforge `docs/api.md`.
**Docs set (one product):** [`unification_plan.md`](./unification_plan.md) (design) · [`DECISIONS.md`](./DECISIONS.md) (decisions) · [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (tracker) · [`PRD.md`](./PRD.md) (requirements) · [`APP_FLOW.md`](./APP_FLOW.md) (flows) · [`TECH_STACK.md`](./TECH_STACK.md) (stack) · [`DESIGN.md`](./DESIGN.md) (design system) · [`PHASE5_PLAN.md`](./PHASE5_PLAN.md) (phase 5) · [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (audit) · legacy PRDs ([`OrgForge`](./legacy/OrgForge_PRD.md) · [`Agentforge`](./legacy/Agentforge_PRD.md))

---

## 1. Conventions

### 1.1 Auth & tenancy

- Every endpoint except the four marked **public** requires `Authorization: Bearer <supabase_jwt>`.
- `requireAuth` verifies the JWT (server-side `supabase.auth.getUser`); `tenantIsolation` scopes every downstream query to `req.user.id`. **RLS is never a backstop** on service-role clients — the verified user id is passed explicitly on every query.
- **Public:** `GET /api/v1/health`, `GET /api/v1/health/db`, `GET /api/v1/auth/salesforce/callback`, `GET /api/v1/auth/github/callback`.

### 1.2 Errors

| Situation | Response |
|---|---|
| Body-parser / zod failure | `400 { error, issues?: [...] }` (`issues` = zod `error.errors`) |
| Unknown path | `404 { error: 'Route not found' }` (JSON, never HTML) |
| Unhandled error | `500 { error: 'Internal server error' }` — sanitized, no stack, no internals |
| Pre-SSE failures (validation, credentials, single-flight, attachments) | **plain JSON** |
| Failures after SSE starts | **SSE error frames** (never plain JSON mid-stream) |

Client side: `frontend/src/lib/api.ts` normalizes transport failures, timeouts (45s default / 120s heavy), structured `issues`, and 401s (session cleared → redirect `/login`) into a single `ApiError` with `.status` and `.issues`.

### 1.3 The SSE envelope (`POST /api/v1/chat/stream`)

Every frame: `{ type, content?, summary?, errors?, card?, capability?, ...additive }` (unknown additive fields pass through untouched).

- **`type`** — `message`, `status`, `action`, `error`, `build_widget`, `stream_chunk`, `deploy`, `deploy_success`, `deploy_warning`, `deploy_error`. Unknown types are degraded to a `status` frame by the envelope builder (never kill the stream).
- **`card`** — inline card rendered inside the chat: `blast_radius`, `refusal_gates`, `artifact`, `dry_run`, `deploy`, `record`, `build_progress`.
- **`capability`** — engine frames tagged `agent` | `org_change` (absent on pre-engine frames). `both` runs emit agent-tagged frames → an `org_change`-tagged handoff status → org-tagged frames; the frontend splits per-segment progress cards on this tag (EC-23).
- **Termination** — `[DONE]` on success; `error` frame on failure. Client disconnect aborts in-flight agent generation server-side.

Wire format: frames delimited by `\n\n`, `data: ` prefix, `[DONE]` terminator (Agentforge contract, preserved).

---

## 2. Unified endpoints

### 2.1 Health

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/v1/health` | public | — | `200 { status: 'ok', timestamp }` |
| GET | `/api/v1/health/db` | public | — | `200 { status: 'healthy', schema: 'orgforge', missingTables: [], timestamp }`; `503 { status: 'unhealthy', schema: 'orgforge', missingTables, timestamp }` (+ `migrationPending: true, note` when the `orgforge` schema is absent) |

`/health/db` probes all six `orgforge.*` tables: `org_connections`, `agents`, `chat_sessions`, `routing_log`, `diagnostics`, `ai_logs`. Missing-table errors (migration 008 pending) degrade to 503 with the exact missing tables; **any other DB error fails loudly (500)**.

### 2.2 Auth

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/v1/auth/link-legacy` | JWT + tenant | `{ legacyToken: string }` | `200 { linked: boolean, agentforgeUserId: string, reason?: string }` |

One-time re-link of a leftover Agentforge JWT to the signed-in Supabase user; re-parents all `salesforce_connections` for that legacy user id. **Best-effort, never a blocker** — expired/foreign tokens are silently discarded. The guaranteed path is the one OAuth flow.

### 2.3 Diagnostics (pre-flight)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/v1/diagnostics` | JWT + tenant | `?orgId=<18-char id>` | full pre-flight report with `checkedAt` + `cached` flags |
| POST | `/api/v1/diagnostics/recheck` | JWT + tenant | `?orgId=<18-char id>` | same shape, forced fresh run |

- Cached server-side **24h** per (user, org) with in-memory promise dedup; `recheck` bypasses.
- Credentials auto-refresh with per-org dedup (EC-10): refresh failure → `401 { error: 'Reconnect this org. Salesforce access could not be refreshed', code: 'ORG_RECONNECT_REQUIRED' }` (the `code` discriminates this from a session-auth 401 — clients must check it BEFORE signing out); missing row → `404 { error: 'Org connection not found' }`.
- **EC-14 invalidation:** 401/403 → refresh-failure hook invalidates the cache (next read re-checks fresh; transient 500s leave the cache untouched). A run detecting `package.installed=false` is **never pinned** — the row is cleared, not cached, so reads self-heal after install (Pass 22).

Report shape (from `packages/diagnostics` preflight):

```jsonc
{
  "state": "ok | attention | error",
  "capability": { "agents": "ok|attention", "org_change": "ok|attention" },
  "checks": {
    "instanceUrl": { "ok": true },
    "license": { "supported": true, "reason": "" },
    "package": { "installed": true, "reason": "" },
    "provisioning": { "ok": true, "agentUsername": null, "permissionsAssigned": true, "reason": "" },
    "orgType": { "detected": "production|sandbox|scratch", "corrected": false }
  },
  "checkedAt": "...", "cached": false
}
```

### 2.4 Routing (standalone classifier)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/v1/chat/route` | JWT + tenant | `{ message: string (1–50 000), pinned?: 'agent'\|'org_change'\|'both'\|'clarify' }` | `200 { capability, confidence, overrideSource? }` |

Gemini + deterministic §7.1 overrides. Every decision logged to `orgforge.routing_log` (prompt hash, capability, confidence, override source) — best-effort; answers even while migration 008 is pending.

### 2.5 Copilot stream (SSE)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/v1/chat/stream` | JWT + tenant | JSON `{ message, orgId, capability?, pinned?, sessionId? }` or `multipart/form-data` (+ `file`) | `text/event-stream` (§1.3) |

- `message` 1–50 000 chars (zod cap); `orgId` 3–18; `sessionId` optional (defaults per user+org).
- `capability` is **authoritative** when present; absent ⇒ the stream classifies itself and logs to `routing_log`. Routing and `ai_logs` always see the **raw** message — never file-injected text.
- `clarify` short-circuits: `status` frame + clarification message, no engine work.
- **Single-flight:** busy agent session → `409 { error }` pre-SSE (checked before and after the credential await). Keyed `{user_id, org_id, session_id}` in Redis.
- **Credentials:** `404` / `401` pre-SSE (same wording as §2.3). Instance URL validated (https + allowlist) — SSRF guard.
- **Attachments** (multer, legacy parity): field `file`, memory storage, **10MB cap**, mime allowlist `pdf/docx/txt/md + png/jpeg/webp`.
  - Documents: extracted text (pdf-parse / mammoth / raw) injected via the SYSTEM-INJECTION block (50k injected-char cap).
  - Images (Pass 21): **agent** engine receives legacy `[{ text }, { inlineData }]` parts (base64 + mimeType); **org-change** engine receives a vision description (`describeImage`, hint = raw message) via SYSTEM-INJECTION. Describe throw/empty → `deploy_warning` frame + degrade to raw message (warn-and-continue; refusal gates + dry run are the safety net).
  - MulterError / allowlist rejection / unreadable file / empty extraction → **400 plain JSON**.
- **Session spine + durable context memory:** capability segments AND a
  bounded text-only transcript (`transcript JSONB`) + flash-compressed
  summary (`context_summary`) persist to `orgforge.chat_sessions` after
  engine work (persistence failure → error frame, never blocks a deploy).
  The agent engine resumes a cold start (process restart / new instance)
  from **summary + recent verbatim tail** — not a full-history replay; the
  org engine gets the bounded `priorContext` digest (summary head + merged
  segments + newest verbatim turns) so follow-ups like "now do the same for
  Account" resolve. Every read/write is triple-scoped
  `(user_id, org_id, session_id)` + RLS — no cross-chat or cross-tenant
  leakage.
- `orgforge.ai_logs` writes are fire-and-forget (never fail the request).

### 2.6 Agents

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/v1/agents` | JWT + tenant | — | `200 { agents: [...], orgId, fetchedAt, cached: boolean }` |
| GET | `/api/v1/agents/:developerName/yaml` | JWT + tenant | `?orgId=<18-char id>` | `200 { developerName, yaml }` · `404 { error, detail }` |

Live Salesforce Agent/Agentforce list from the connected org (Tooling/REST), SSRF-guarded. Normalized **additive** shape: Agentforge field names preserved + UI-friendly `name` alias (`masterLabel` when present, else `developerName`). Cached server-side.

`GET /agents/:developerName/yaml` retrieves the generated `.agent` YAML for one agent (Metadata API `AiAuthoringBundle` retrieve — async, can take tens of seconds). `404` with a `detail` hint when the bundle isn't retrievable. No cache. Frontend: /agents YAML detail drawer (Pass 27).

### 2.8 Refusal log

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/v1/refusal-logs` | JWT + tenant | `?orgId=<18-char id>` (optional) | `200 { refusals: [...] }` |

- The dedicated refusal audit trail (PRD FR-5 "refusal log"): every gate that
  REFUSED (REF-01..10) plus REF-07 production acknowledgments, from the legacy
  `public.refusal_logs` (read-only legacy data — the app's own tables live in
  `orgforge`), joined with the originating `change_intents`.
- **Tenant isolation:** `refusal_logs` has no user column — the query embeds
  `change_intents!inner` and filters `change_intents.user_id` (optional
  `orgId` filters `org_id`); `user_id` is stripped from the response.
- Entry: `{ id, changeIntentId, gateCode, reason, missingEvidence,
  unblockPath, orgId, intent, createdAt }`.
- Missing-table (migrations 003–005 pending, S-3) → `200 { refusals: [], note }`;
  other DB errors → `500 { error: 'Failed to load refusal log' }`.

### 2.7 Session context (reset / history / resume)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| DELETE | `/api/v1/chat/:contextId` | JWT + tenant | `?orgId=<18-char id>` | `200 { success: true }` |
| GET | `/api/v1/chat/sessions` | JWT + tenant | `?orgId=<18-char id>` | `200 { sessions: [{ sessionId, updatedAt, lastSummary, hasSummary }] }` |
| GET | `/api/v1/chat/sessions/:sessionId` | JWT + tenant | `?orgId=<18-char id>` | `200 { sessionId, transcript, contextSummary, segments, updatedAt }` · `404` foreign/unknown |

- `contextId` = the client's session id (`default` when the stream was called without an explicit `sessionId`); `orgId` required. Reserved names `stream` / `route` → 400.
- Explicit conversation reset (legacy Agentforge `DELETE /api/chat/:contextId` parity): aborts in-flight generation, drops the live `ConversationManager`, and clears the Redis busy-lock + persisted state — the escape hatch for crash-stuck requests (without it, a dead run blocks the conversation with 409s for up to the 10-min lock TTL).
- `GET /chat/sessions` — tenant-scoped light list (newest `updated_at`
  first, limit clamped 1–50) for the History picker; ships `lastSummary`
  (newest capability-segment summary) + `hasSummary` (flash-compressed head
  present), **never** the full transcript. Missing table (migration 008
  pending) → `200 { sessions: [] }` (S-2 degrade).
- `GET /chat/sessions/:sessionId` — full-spine restore for resume:
  `transcript` parsed from both JSONB arrays and legacy string-encoded
  forms, plus `contextSummary` and the capability segments. Triple-scoped
  via the shared spine lookup — a session owned by another user/org reads as
  `404`, never a leak.
- **Lifecycle:** session ids live in the browser's `sessionStorage`
  (per-tab isolation — two open chats never share one conversation); the
  nightly `session-cleanup` job (03:05, `CHAT_SESSIONS_RETENTION_DAYS`,
  default 7, clamp 1–90) garbage-collects orphaned rows from closed tabs;
  History makes sessions resumable within the retention window.
- Session key composed exactly like chat/stream's: `{userId}|{orgId}|{contextId}`. Idempotent: resetting a free/absent conversation is a no-op success.
- Scope note: the abort is best-effort/in-process (live Gemini session is per-instance); the Redis clear is cross-instance.

---

## 3. Preserved OrgForge capability routers (mounted unchanged)

Mounted verbatim under `/api/v1`, gated on `FORGE_UNIFIED_API=on` (capability phase flag). Contract: OrgForge API.md.

| Mount | Router | Routes |
|---|---|---|
| `/api/v1/auth` | `routes/auth.js` | OAuth connect / callback / status (OrgForge §1) |
| `/api/v1/auth/github` | `routes/github.js` | GitHub App install + repo (OrgForge §1.2) |
| `/api/v1/orgs` | `routes/orgs.js` | `GET /`, `POST /:orgId/index`, `GET /:orgId/package-health`, `GET /:orgId/context`, `GET /:orgId/status`, `GET /:orgId/index-stream` (SSE), `DELETE /:orgId` |
| `/api/v1/changes` | `routes/changes.js` | `POST /intent`, `POST /intent/:intentId/clarify`, `POST /generate` |
| `/api/v1/impact` | `routes/impact.js` | `POST /:intentId/impact-brief` |
| `/api/v1/gates` | `routes/gates.js` | `POST /evaluate` (REF-01..10) |
| `/api/v1/deployments` | `routes/deployments.js` | `POST /dry-run`, `GET /status/:id`, `POST /backup`, `POST /backup/status/:id`, `POST /execute`, `GET /status-stream/:id` (SSE) |
| `/api/v1/rollback` | `routes/rollback.js` | `POST /` |
| `/api/v1/change-records` | `routes/changeRecords.js` | `GET /` |

**Removed (Phase 5, 2026-08-14):** the legacy transition aliases `/api/auth` (Agentforge auth router) and `/api/org` (orgHealth) were deleted along with the `FORGE_MOUNT_AGENTFORGE` gate — the legacy apps are decommissioned.

---

## 4. Legacy parity map

| Agentforge legacy | Unified replacement |
|---|---|
| `GET /api/auth/login` | `POST /api/v1/auth/link-legacy` + OrgForge `/api/v1/auth/salesforce/connect` |
| `GET /api/auth/callback` | `/api/v1/auth/salesforce/callback` |
| `GET /api/auth/status` | — (Supabase JWT *is* the auth status; connection state under `/api/v1/orgs`) |
| `POST /api/chat/stream` | `POST /api/v1/chat/stream` (same SSE vocabulary + multer; adds capability routing, 409 single-flight, per-segment tags, session spine, ai_logs) |
| `DELETE /api/chat/:contextId` | `DELETE /api/v1/chat/:contextId?orgId=…` |
| `GET /api/org/health-check` | `GET /api/v1/diagnostics` (richer pre-flight + 24h cache + EC-14 invalidation) |
| `GET /api/org/instance` | `GET /api/v1/diagnostics` (org type) + `GET /api/v1/orgs/:orgId/context` |
| `POST /api/seeding/generate`, `DELETE /api/seeding/cleanup` | — (planned V7 endpoints, **not carried**) |

Behavior changes vs preserved OrgForge endpoints: session-cookie auth → Supabase JWT bearer + tenantIsolation; `/health/db` extended to the six `orgforge.*` tables; unified error contract (sanitized JSON + zod `issues`) on every path.

---

## 5. Server → client data flow (SSE timeline)

1. Client POSTs `/api/v1/chat/stream` (JSON or multipart) with Bearer JWT.
2. Server: auth → zod → single-flight check → credentials (404/401 pre-SSE) → attachment parse (400 pre-SSE).
3. If no `capability` given: classify via `routeIntent` (Gemini + overrides), log to `routing_log`.
4. `clarify` → short-circuit status + question.
5. Engine work:
   - `agent` → ConversationManager (Gemini + Salesforce tools, ReAct loop) → `build_widget` / `stream_chunk` / `deploy` frames (capability `agent`).
   - `org_change` → intent pipeline → `blast_radius` / `refusal_gates` / `dry_run` / `deploy` cards → `deploy_success` + signed record (capability `org_change`).
   - `both` → agent frames, then org_change-tagged handoff status, then org frames.
6. Persist capability segments + transcript to `orgforge.chat_sessions`; fire-and-forget `orgforge.ai_logs`.
7. `[DONE]` on success; `error` frame on failure.
