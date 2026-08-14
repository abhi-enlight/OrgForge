-- 011_github_connections.sql
-- GitHub audit-destination store (plan §12.3, D8).
--
-- OrgForge unifies the AI capability with the version control integration.
-- GitHub connections are strictly scoped to the `orgforge` schema.
-- Idempotent: safe to run multiple times. Additive — touches nothing else.

CREATE TABLE IF NOT EXISTS orgforge.github_connections (
    user_id UUID PRIMARY KEY,                    -- auth.users.id (one audit repo per user)
    installation_id TEXT NOT NULL,               -- GitHub App installation id (stored as text)
    repo_owner TEXT NOT NULL,                    -- repo the audit records are pushed to
    repo_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_github_connections_user ON orgforge.github_connections(user_id);

-- Row-Level Security — same tenant contract as the orgforge tables:
-- a user can only ever read/write their own row.
ALTER TABLE orgforge.github_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "github connections users own" ON orgforge.github_connections;
CREATE POLICY "github connections users own"
ON orgforge.github_connections FOR ALL
USING (auth.uid()::text = user_id::text)
WITH CHECK (auth.uid()::text = user_id::text);
