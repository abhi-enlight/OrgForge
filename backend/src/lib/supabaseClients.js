import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy_key';

const BASE_OPTS = { auth: { persistSession: false, autoRefreshToken: false } };

/**
 * Service-role Supabase client scoped to the `forge` schema (migration 008).
 * Used by: chatStream, health, agents, diagnostics, refusalLogs, chatRoute.
 *
 * All forge.* tables (routing_log, chat_sessions, ai_logs, agents, diagnostics,
 * org_connections) are accessed through this singleton — one connection pool
 * for the whole API process instead of one per route file.
 */
export const forgeDb = createClient(url, key, {
  ...BASE_OPTS,
  db: { schema: 'forge' },
});

/**
 * Service-role Supabase client scoped to the DEFAULT (public) schema.
 * Used for: public.org_connections (the live OAuth credential store),
 * orgforge.* tables via the orgforge schema override in orgforge routes,
 * and the re-link flow that touches public.salesforce_connections.
 *
 * NOTE: the authoritative credential store is public.org_connections — the
 * same table the OAuth callback and OrgForge routes write. Do NOT use
 * forgeDb for credential lookups (forge.org_connections is vestigial).
 */
export const publicDb = createClient(url, key, BASE_OPTS);
