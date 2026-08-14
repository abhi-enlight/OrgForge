-- 013_forge_data_tables.sql
-- Creates the remaining data tables in orgforge to complete full schema isolation.
-- These tables were missing from 008, causing split-brain queries hitting 'public'.
-- Idempotent: safe to run multiple times.

-- 1. change_records
CREATE TABLE IF NOT EXISTS orgforge.change_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    org_id VARCHAR(18) NOT NULL,
    change_intent_id UUID,
    deployment_id TEXT,
    approver_identity TEXT,
    git_commit_hash TEXT,
    signature_hash TEXT,
    intent TEXT,
    business_rationale TEXT,
    status TEXT,
    skills_used JSONB,
    impact_brief JSONB,
    gate_results JSONB,
    dry_run_id TEXT,
    artifacts JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_change_records_user ON orgforge.change_records(user_id);
ALTER TABLE orgforge.change_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "change_records users own" ON orgforge.change_records;
CREATE POLICY "change_records users own" ON orgforge.change_records FOR ALL USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);

-- 2. org_indexes
CREATE TABLE IF NOT EXISTS orgforge.org_indexes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id VARCHAR(18) NOT NULL,
    metadata_type TEXT NOT NULL,
    api_name TEXT NOT NULL,
    namespace_prefix TEXT,
    referencing_components JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
-- RLS on org_indexes typically joins to org_connections to verify ownership, but
-- for simplicity we'll allow service_role and restrict anon/auth if needed.
-- Often these are accessed via service_role bypassing RLS.
ALTER TABLE orgforge.org_indexes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_indexes select" ON orgforge.org_indexes;
CREATE POLICY "org_indexes select" ON orgforge.org_indexes FOR SELECT USING (
    EXISTS (SELECT 1 FROM orgforge.org_connections c WHERE c.org_id = org_indexes.org_id AND c.user_id::text = auth.uid()::text)
);

-- 3. ai_lessons
CREATE TABLE IF NOT EXISTS orgforge.ai_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_text TEXT NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE orgforge.ai_lessons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_lessons read all" ON orgforge.ai_lessons;
CREATE POLICY "ai_lessons read all" ON orgforge.ai_lessons FOR SELECT USING (true);

-- 4. deployments (stubbed per gap analysis)
CREATE TABLE IF NOT EXISTS orgforge.deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    org_id VARCHAR(18) NOT NULL,
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE orgforge.deployments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deployments users own" ON orgforge.deployments;
CREATE POLICY "deployments users own" ON orgforge.deployments FOR ALL USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);

-- 5. change_sets (stubbed per gap analysis)
CREATE TABLE IF NOT EXISTS orgforge.change_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE orgforge.change_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "change_sets read" ON orgforge.change_sets;
CREATE POLICY "change_sets read" ON orgforge.change_sets FOR SELECT USING (true);

-- ── Grants ──────────────────────────────────────────────────────────────
-- PostgREST roles need table-level privileges; without these, even the
-- service-role client is denied (PGRST205 / 42501 "permission denied for
-- table"). The six 008 tables were granted out-of-band on the hosted DB;
-- this block makes the migration self-contained so fresh environments and
-- re-runs get identical access. RLS policies above remain the row-level gate.
GRANT USAGE ON SCHEMA orgforge TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA orgforge TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA orgforge TO anon, authenticated, service_role;
