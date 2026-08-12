import { createClient } from '@supabase/supabase-js';

// Module-level singleton (OrgForge supabaseClient pattern) — the default
// verifier reuses one client instead of creating one per request.
const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy_key',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * Default token → user verifier backed by the Supabase Auth service (GoTrue).
 * `supabase.auth.getUser(token)` is the officially recommended server-side
 * validation: it verifies the JWT signature, expiry, and audience against the
 * configured Supabase project, and returns the user row.
 *
 * IMPORTANT (plan §8.1): Agentforge's legacy self-signed JWT (`JWT_SECRET`,
 * containing `{agentforgeUserId, orgId}`) is NOT a Supabase JWT, so getUser()
 * rejects it — this single middleware retires the legacy auth path.
 */
async function verifyUserWithSupabase(token) {
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error(error?.message || 'Invalid or expired token');
    err.status = 401;
    throw err;
  }
  return data.user;
}

/**
 * Builds the requireAuth middleware.
 *
 * @param {object} [opts]
 * @param {(token: string) => Promise<{id: string, email?: string}>} [opts.verifyUser]
 *   Injectable verifier (defaults to Supabase GoTrue). Tests inject a stub to
 *   prove the middleware contract without network access.
 * @returns {import('express').RequestHandler}
 */
export function createAuthMiddleware({ verifyUser = verifyUserWithSupabase } = {}) {
  return async function requireAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization || '';

      // Query-string tokens are only accepted on GET requests (SSE streaming
      // via EventSource cannot set custom headers). They are ignored elsewhere
      // to avoid leaking tokens into logs, history, and referrers.
      const queryToken = req.method === 'GET' ? req.query.access_token : undefined;

      let token = null;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      } else if (typeof queryToken === 'string' && queryToken.length > 0) {
        token = queryToken;
      }

      if (!token) {
        return res.status(401).json({ error: 'Missing authentication token' });
      }

      const user = await verifyUser(token);

      req.user = {
        id: user.id,
        email: user.email,
      };
      req.accessToken = token;

      next();
    } catch (err) {
      // Always a generic 401 so no internal detail leaks to the client.
      return res.status(401).json({ error: 'Authentication failed' });
    }
  };
}

export const requireAuth = createAuthMiddleware();
