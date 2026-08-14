import { createClient } from '@supabase/supabase-js';

/**
 * Middleware that scopes every database query to the authenticated tenant.
 *
 * Relies on `requireAuth` running first (it sets req.user + req.accessToken,
 * so the tenant id always comes from a server-verified JWT — never from
 * client-supplied input).
 *
 * SECURITY MODEL: we use the service-role key here rather than the anon key
 * with RLS. Reason: RLS policy state across the shared Supabase project is not
 * guaranteed to be uniform (the OrgForge `orgforge.*` tables have policies,
 * Agentforge's `public` RPC-backed tables may not). Using the service role
 * lets the API function regardless of policy state. To keep this safe, every
 * route MUST scope its queries with an EXPLICIT `.eq('user_id', req.tenantId)`
 * (or an ownership check) derived from the verified token — RLS is no longer a
 * backstop. The same rule applies to Redis keys: org-scoped caches must only
 * be read after verifying the org belongs to the tenant (plan §8.6, EC-48).
 */
export function tenantIsolation(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Tenant isolation failed: missing user context' });
  }

  req.tenantId = req.user.id;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy_key';

  req.supabaseClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: { schema: 'orgforge' },
  });

  next();
}
