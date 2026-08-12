# Forge schema migrations (Phase 3 — planned)

These migrations consolidate both engines onto one `forge` schema inside the
**same Supabase project** (plan §9). They are **additive**: nothing is dropped
until Phase-5 sign-off, and legacy `public` / `orgforge` tables stay untouched
for the legacy apps.

> ⚠️ **org_connections stays in the DEFAULT (public) schema.** The OAuth
> callback, the re-link flow, and every OrgForge router/job read/write
> `org_connections` via clients with **no schema override** → `public`. The
> unified copilot (chat/stream, agents, diagnostics) resolves credentials
> through the same default-schema client so both halves share ONE store.
> `forge.org_connections` (created here by 008) is therefore **vestigial** —
> nothing writes to it. If you apply 008, the table is harmless; the
> authoritative store is `public.org_connections`.
>
> ⚠️ **Re-link column caveat.** `packages/org-connections/src/reLink.js`
> upserts `capabilities`, `legacy_agentforge_user_id`, and `disconnected_at`
> into `org_connections` (public) via `req.supabaseClient`. Those columns are
> guaranteed on `forge.org_connections` (008) but may not exist on the legacy
> public table — if absent, link-legacy best-effort fails to `linked: 0`
> (never a blocker; the one-time OAuth re-connect is the guaranteed path, D4).
> Verify/add the columns on `public.org_connections` when applying 008 if you
> want re-link to re-parent orgs.

> ⚠️ The OrgForge project's migrations live in
> `../OrgForge/supabase/migrations/` (001–007) and were applied to the shared
> project already. Forge migrations are numbered from **008** onward so they
> apply cleanly after the OrgForge set.

## Planned order (plan §9.4)

| # | Migration | Contents |
|---|---|---|
| 008 | `forge_schema.sql` | `forge` schema + `org_connections` (adds `capabilities`, `legacy_agentforge_user_id`, `disconnected_at`), `agents` inventory cache, `chat_sessions`, `routing_log`, `diagnostics` |
| 009 | `forge_views.sql` | Views mapping legacy names so legacy queries/tests keep working (`forge.org_connections` ← `public`/`orgforge.org_connections`) |
| 010 | `forge_legacy_rpc.sql` | RPCs for the re-link flow (§8.4): `get_connections_by_agentforge_user`, `delete_salesforce_connection_by_user` (used by `packages/org-connections/src/reLink.js`) |
| 011 | `forge_rls.sql` | Mirror OrgForge's proven RLS: `auth.uid() = user_id` on every table |

## Draft schema — `forge.org_connections`

```sql
CREATE SCHEMA IF NOT EXISTS forge;

CREATE TABLE forge.org_connections (
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

Not yet applied. The `packages/org-connections` re-link tests mock the RPCs in
010; apply 010 before enabling `POST /api/v1/auth/link-legacy` (Phase 2).
