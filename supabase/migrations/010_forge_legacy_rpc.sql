-- 010_forge_legacy_rpc.sql
-- Legacy connection re-link RPCs (plan §8.4). These power
-- packages/org-connections/src/reLink.js (linkLegacyAgentforgeOrgs).
--
-- The Agentforge `public.salesforce_connections` table was created in the
-- shared Supabase project via the SQL editor (its DDL is not in-repo). This
-- migration ensures the table + RPCs exist regardless of how it was created —
-- CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS merge with any
-- pre-existing shape. Idempotent.
--
-- Column contract (matches Agentforge src/services/dbClient.js RPC usage):
--   agentforge_user_id  uuid        -- random UUID minted per browser session
--   org_id              varchar(18)
--   instance_url        text
--   org_type            varchar(50)
--   alias               varchar(255)
--   access_token        text        -- AES-256-GCM encrypted (iv:authTag:data)
--   refresh_token       text        -- AES-256-GCM encrypted
--   token_expires_at    timestamptz

CREATE TABLE IF NOT EXISTS public.salesforce_connections (
    agentforge_user_id UUID NOT NULL,
    org_id VARCHAR(18) NOT NULL,
    instance_url TEXT NOT NULL,
    org_type VARCHAR(50) DEFAULT 'production',
    alias VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (agentforge_user_id, org_id)
);

ALTER TABLE public.salesforce_connections ADD COLUMN IF NOT EXISTS org_type VARCHAR(50) DEFAULT 'production';
ALTER TABLE public.salesforce_connections ADD COLUMN IF NOT EXISTS alias VARCHAR(255);
ALTER TABLE public.salesforce_connections ADD COLUMN IF NOT EXISTS access_token TEXT;
ALTER TABLE public.salesforce_connections ADD COLUMN IF NOT EXISTS refresh_token TEXT;
ALTER TABLE public.salesforce_connections ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

-- NOTE: this legacy table intentionally has NO row-level security. It is only
-- ever accessed via the RPCs below (service-role paths), mirroring Agentforge's
-- original design. The unified forge.org_connections table (008) carries the
-- real RLS posture; the legacy surface is retired at Phase 5.

-- Agentforge's original RPCs (created in the SQL editor) may or may not exist;
-- recreate them idempotently so the legacy engine keeps working unchanged.
CREATE OR REPLACE FUNCTION public.upsert_salesforce_connection(
    p_agentforge_user_id uuid,
    p_org_id varchar,
    p_instance_url text,
    p_access_token text,
    p_refresh_token text,
    p_token_expires_at timestamptz
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO public.salesforce_connections
        (agentforge_user_id, org_id, instance_url, access_token, refresh_token, token_expires_at)
    VALUES
        (p_agentforge_user_id, p_org_id, p_instance_url, p_access_token, p_refresh_token, p_token_expires_at)
    ON CONFLICT (agentforge_user_id, org_id) DO UPDATE SET
        instance_url = EXCLUDED.instance_url,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.get_salesforce_connection(p_org_id varchar)
RETURNS TABLE (
    agentforge_user_id uuid,
    org_id varchar,
    instance_url text,
    access_token text,
    refresh_token text,
    token_expires_at timestamptz
) LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    SELECT s.agentforge_user_id, s.org_id, s.instance_url, s.access_token, s.refresh_token, s.token_expires_at
    FROM public.salesforce_connections s
    WHERE s.org_id = p_org_id
    LIMIT 1;
END $$;

CREATE OR REPLACE FUNCTION public.update_salesforce_connection_tokens(
    p_org_id varchar,
    p_access_token text,
    p_token_expires_at timestamptz
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.salesforce_connections
    SET access_token = p_access_token,
        token_expires_at = p_token_expires_at,
        updated_at = now()
    WHERE org_id = p_org_id;
END $$;

-- ============================================================
-- Re-link RPCs consumed by @forge/org-connections reLink.js (§8.4)
-- ============================================================

-- Lists every legacy row belonging to an agentforge_user_id so the unified
-- app can re-parent them onto the signed-in Supabase user.
--
-- NOTE (D4 / EC-41): legacy tokens are encrypted with the legacy
-- ENCRYPTION_KEY and are NEVER re-encrypted. This RPC therefore returns org
-- METADATA ONLY — reLink.js upserts the org with an empty credential blob and
-- disconnected_at set, so the UI shows "Reconnect this org" (EC-10) and the
-- user completes the one-time OAuth re-connect. This is the D4 design.
CREATE OR REPLACE FUNCTION public.get_connections_by_agentforge_user(p_agentforge_user_id uuid)
RETURNS TABLE (
    org_id varchar,
    org_type varchar,
    instance_url text,
    alias varchar
) LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    SELECT s.org_id,
           COALESCE(s.org_type, 'production'),
           s.instance_url,
           s.alias
    FROM public.salesforce_connections s
    WHERE s.agentforge_user_id = p_agentforge_user_id;
END $$;

-- Removes a single legacy row after it has been re-parented, so the same
-- legacy identity can never re-link twice.
CREATE OR REPLACE FUNCTION public.delete_salesforce_connection_by_user(
    p_agentforge_user_id uuid,
    p_org_id varchar
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM public.salesforce_connections
    WHERE agentforge_user_id = p_agentforge_user_id AND org_id = p_org_id;
END $$;
