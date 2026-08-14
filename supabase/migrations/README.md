# OrgForge schema migrations (Phase 3 — planned)

These migrations consolidate both engines onto one `orgforge` schema inside the
**same Supabase project** (plan §9). They are **additive**: nothing is dropped
until Phase-5 sign-off, and legacy `public` tables stay untouched for the
legacy apps.

> ✅ **Strict Orgforge Schema Isolation.** All database operations in this app
> (OAuth callback, re-link flow, OrgForge routes/jobs, and the unified copilot)
> read and write strictly to the `orgforge` schema. The `public` schema is
> untouched to protect legacy data. `orgforge.org_connections` is the
> authoritative store.

> ⚠️ The OrgForge project's migrations live in
> `../OrgForge/supabase/migrations/` (001–007) and were applied to the shared
> project already. OrgForge migrations are numbered from **008** onward so they
> apply cleanly after the OrgForge set.

## Migration order

| # | Migration | Contents |
|---|---|---|
| 008 | `forge_schema.sql` | `orgforge` schema + `org_connections` (adds `capabilities`, `legacy_agentforge_user_id`, `disconnected_at`), `agents` inventory cache, `chat_sessions`, `routing_log`, `diagnostics` (+ RLS on every table). **Idempotent:** includes a compat block that renames an already-applied `forge` schema to `orgforge` in place. |
| 010 | `forge_legacy_rpc.sql` | RPCs for the re-link flow (§8.4): `get_connections_by_agentforge_user`, `delete_salesforce_connection_by_user` (used by `packages/org-connections/src/reLink.js`) |
| 011 | `github_connections.sql` | `orgforge.github_connections` — the GitHub audit App's connection rows (one per user); a missing table reads as "disconnected", never a 500 |
| 012 | `forge_context_memory.sql` | **Durable conversation memory** (context-memory pass): adds `transcript JSONB` (bounded text-only turns) + `context_summary TEXT` (flash-compressed head) to `orgforge.chat_sessions`; idempotent `ADD COLUMN IF NOT EXISTS` |
| 013 | `forge_data_tables.sql` | Additional missing data tables in `orgforge` schema (`change_records`, `org_indexes`, `ai_lessons`, `deployments`, `change_sets`) with RLS applied to enforce full isolation from `public`. |
| 014 | `change_records_agent_kind.sql` | **EC-37** — agent deploys get the same signed-record trail as org changes: `kind TEXT NOT NULL DEFAULT 'org_change'` (`'agent_deploy'` for agent builds), `agent_name TEXT`, `agent_snapshot JSONB` (pre-deploy YAML snapshot). Additive `ADD COLUMN IF NOT EXISTS`; existing rows keep `kind = 'org_change'`. |

> Planned/not yet written: 009 (legacy-name compat views) and the OrgForge-RLS
> mirror — RLS already ships inside 008; the views were deferred.

## Draft schema — `orgforge.org_connections`

```sql
CREATE SCHEMA IF NOT EXISTS orgforge;

CREATE TABLE orgforge.org_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,                       -- auth.users.id
    org_id VARCHAR(18) NOT NULL,
    org_type VARCHAR(50) NOT NULL,
    alias VARCHAR(255),
    instance_url TEXT NOT NULL,
    encrypted_tokens TEXT NOT NULL,              -- iv:authTag:encryptedData (one ENCRYPTION_KEY, D4)
    capabilities TEXT[] DEFAULT '{agents,org_change}',
    context_indexed_at TIMESTAMPTZ,
    legacy_agentforge_user_id UUID,              -- audit trail from the re-link (§8.4)
    disconnected_at TIMESTAMPTZ,                 -- EC-10: set when refresh fails
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, org_id)
);
```

## Status

Applied in order 008 → 010 → 011 → 012 → 013 (idempotent; 008's compat block
handles environments where it previously landed as `forge`). RLS ships inside
008 + 013. **All five migrations are applied to the live hosted project
(Passes 43 + 51)** with the `orgforge` schema exposed in PostgREST
(`pgrst.db_schemas`) and GRANTs for anon/authenticated/service_role — 013
carries its own GRANT block (USAGE + ALL TABLES + ALL SEQUENCES) because
schema-level grants do NOT cover tables created afterward (the five data
tables shipped grant-less once and got 42501 for service_role).
`orgforge.chat_sessions` rows are garbage-collected by the nightly
`session-cleanup` job (03:05, retention `CHAT_SESSIONS_RETENTION_DAYS`, default
7 days) — see `backend/src/lib/sessionCleanup.js` and
`backend/src/orgforge/jobs/sessionCleanupJob.js`.
