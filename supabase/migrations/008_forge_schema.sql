-- 008_forge_schema.sql
-- Forge unified schema (plan §9). ADDITIVE: creates the `orgforge` schema and
-- its tables; nothing here drops or modifies the legacy `public` tables. Run
-- AFTER the OrgForge 001–007 migrations in the shared project.
-- Idempotent: safe to run multiple times.
--
-- NOTE: the schema was renamed from `forge` to `orgforge` (unified codebase
-- rename). Environments that already applied the earlier 008 as `forge` are
-- migrated in place below — the old schema is renamed to `orgforge` when
-- `orgforge` does not already exist.

CREATE SCHEMA IF NOT EXISTS orgforge;

-- One-time compatibility: rename an already-applied `forge` schema to
-- `orgforge` (skipped when `orgforge` already exists — e.g. both present from
-- a partial run — or when `forge` was never created).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'forge')
       AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'orgforge') THEN
        ALTER SCHEMA forge RENAME TO orgforge;
    END IF;
END $$;

-- ============================================================
-- Org Connections — the single connection store (plan §9.1, D4)
-- ============================================================
-- One row per (user, org). Both engines resolve credentials from here.
-- `capabilities` splits agent vs org-change capability per org (EC-16).
-- `legacy_agentforge_user_id` records the pre-merge identity after the
-- re-link flow (§8.4) for audit. `disconnected_at` is set by EC-10 when a
-- token refresh fails (revoked app access).
CREATE TABLE IF NOT EXISTS orgforge.org_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,                            -- auth.users.id
    org_id VARCHAR(18) NOT NULL,
    org_type VARCHAR(50) NOT NULL,                    -- sandbox | production | scratch
    alias VARCHAR(255),
    instance_url TEXT NOT NULL,
    encrypted_tokens TEXT NOT NULL,                   -- iv:authTag:encryptedData (AES-256-GCM)
    capabilities TEXT[] DEFAULT '{agents,org_change}',
    context_indexed_at TIMESTAMPTZ,
    legacy_agentforge_user_id UUID,
    disconnected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_forge_org_connections_user ON orgforge.org_connections(user_id);

-- ============================================================
-- Agents — inventory cache powering the read-only /agents page
-- ============================================================
-- Populated from sfClient.getAgents + deploy_agent events (plan §9.1, D6).
CREATE TABLE IF NOT EXISTS orgforge.agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    org_id VARCHAR(18) NOT NULL,
    developer_name VARCHAR(255) NOT NULL,
    label VARCHAR(255),
    description TEXT,
    status VARCHAR(50),
    yaml_ref TEXT,
    last_deployed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, org_id, developer_name)
);

CREATE INDEX IF NOT EXISTS idx_forge_agents_org ON orgforge.agents(org_id);

-- ============================================================
-- Chat Sessions — the shared context spine across engines (§7.3)
-- ============================================================
CREATE TABLE IF NOT EXISTS orgforge.chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,                          -- client-generated conversation key (plan §7.3)
    user_id UUID NOT NULL,
    org_id VARCHAR(18) NOT NULL,
    capability_segments JSONB DEFAULT '[]',           -- [{capability, engineRef, startedAt, lastMessageAt, summary}]
    compressed_history TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, org_id, session_id)
);

-- ============================================================
-- Routing Log — every classifier decision (§7.4)
-- ============================================================
CREATE TABLE IF NOT EXISTS orgforge.routing_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID,
    prompt_hash TEXT NOT NULL,
    capability VARCHAR(20) NOT NULL,                  -- agent | org_change | both | clarify
    confidence NUMERIC(4,3),
    override_source TEXT,                             -- model | deterministic | user_chip
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Diagnostics — server-side pre-flight cache (§12.4.7, EC-21)
-- ============================================================
CREATE TABLE IF NOT EXISTS orgforge.diagnostics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    org_id VARCHAR(18) NOT NULL,
    state VARCHAR(20) NOT NULL,                       -- ok | attention | error
    detail JSONB,                                     -- {missingPackage, licenseSupported, provisioning, ...}
    checked_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, org_id)
);

-- ============================================================
-- AI Logs — ONE merged writer for BOTH engines (plan §9.1, §3)
-- ============================================================
-- Superset of Agentforge's agentforge_logs.ai_logs (user_id, session_id,
-- prompt, ai_response, tool_calls, salesforce_error, error_code, status,
-- latency_ms, model_version) and OrgForge's orgforge.ai_logs (intent_id,
-- dry_run_errors, ai_repair_attempts). The unified writer is
-- packages/ai/src/aiLogs.js — fire-and-forget, never blocks a request.
CREATE TABLE IF NOT EXISTS orgforge.ai_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID,
    org_id VARCHAR(18),
    session_id TEXT,
    capability VARCHAR(20),              -- agent | org_change
    prompt TEXT,
    ai_response TEXT,
    tool_calls JSONB,
    salesforce_error TEXT,
    status VARCHAR(20),                  -- SUCCESS | FAILED
    error_code TEXT,
    latency_ms INTEGER,
    model_version TEXT,
    intent_id UUID,                      -- org-change pipeline lineage (OrgForge)
    dry_run_errors JSONB,                -- OrgForge dry-run failure trace
    ai_repair_attempts INTEGER,          -- OrgForge repair loop counter
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forge_ai_logs_user ON orgforge.ai_logs(user_id, created_at DESC);

-- ============================================================
-- Row-Level Security — mirror OrgForge's proven policies (§9.2)
-- ============================================================
ALTER TABLE orgforge.org_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgforge.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgforge.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgforge.routing_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgforge.diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgforge.ai_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orgforge users own connections" ON orgforge.org_connections;
CREATE POLICY "orgforge users own connections"
ON orgforge.org_connections FOR ALL
USING (auth.uid()::text = user_id::text)
WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "orgforge users own agents" ON orgforge.agents;
CREATE POLICY "orgforge users own agents"
ON orgforge.agents FOR ALL
USING (auth.uid()::text = user_id::text)
WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "orgforge users own chat sessions" ON orgforge.chat_sessions;
CREATE POLICY "orgforge users own chat sessions"
ON orgforge.chat_sessions FOR ALL
USING (auth.uid()::text = user_id::text)
WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "orgforge users own routing log" ON orgforge.routing_log;
CREATE POLICY "orgforge users own routing log"
ON orgforge.routing_log FOR ALL
USING (auth.uid()::text = user_id::text)
WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "orgforge users own diagnostics" ON orgforge.diagnostics;
CREATE POLICY "orgforge users own diagnostics"
ON orgforge.diagnostics FOR ALL
USING (auth.uid()::text = user_id::text)
WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "orgforge users own ai logs" ON orgforge.ai_logs;
CREATE POLICY "orgforge users own ai logs"
ON orgforge.ai_logs FOR ALL
USING (auth.uid()::text = user_id::text)
WITH CHECK (auth.uid()::text = user_id::text);
