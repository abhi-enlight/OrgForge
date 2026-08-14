-- 014_change_records_agent_kind.sql
-- EC-37 / F-2: agent deploys get the same signed-record audit trail as org
-- changes. Extends orgforge.change_records so an agent build's deploy is
-- recorded with kind = 'agent_deploy' plus the pre-deploy YAML snapshot.
-- Additive + idempotent: existing org_change rows are untouched (kind
-- defaults to 'org_change'); safe to run multiple times.

ALTER TABLE orgforge.change_records ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'org_change';
ALTER TABLE orgforge.change_records ADD COLUMN IF NOT EXISTS agent_name TEXT;
ALTER TABLE orgforge.change_records ADD COLUMN IF NOT EXISTS agent_snapshot JSONB;

-- Keep the existing user-owned RLS policy shape (no policy change needed —
-- the new columns ride the same row-level gate).
