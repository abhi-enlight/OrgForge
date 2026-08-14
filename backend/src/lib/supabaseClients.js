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
  db: { schema: 'orgforge' },
});

/**
 * Service-role Supabase client scoped to the orgforge schema.
 * All queries explicitly target `orgforge.*` tables to strictly isolate
 * application data from the legacy `public` schema.
 *
 * NOTE: The legacy `public.org_connections` is no longer the authoritative
 * credential store. All operations read/write strictly to `orgforge.org_connections`.
 */
export const publicDb = createClient(url, key, {
  ...BASE_OPTS,
  db: { schema: 'orgforge' },
});

/**
 * Backward-compatible alias for legacy orgforge services and jobs.
 */
export const supabaseAdmin = forgeDb;

