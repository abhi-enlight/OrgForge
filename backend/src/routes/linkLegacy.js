import { Router } from 'express';
import { z } from 'zod';
import { createAuthMiddleware, tenantIsolation } from '@orgforge/auth';
import { linkLegacyAgentforgeOrgs } from '@orgforge/org-connections';

const bodySchema = z.object({
  legacyToken: z.string().min(1),
});

/**
 * POST /api/v1/auth/link-legacy (plan §8.4, endpoint map §10.1)
 *
 * One-time session/org re-link: the client sends the leftover legacy
 * Agentforge JWT (localStorage.auth_token) once, alongside its Supabase
 * session. The server verifies the legacy JWT with LEGACY_JWT_SECRET and
 * re-parents all `salesforce_connections` rows with that agentforge_user_id
 * onto the signed-in Supabase user.
 *
 * Best-effort convenience, never a blocker (EC-02/EC-38): expired or foreign
 * legacy tokens are silently discarded, and the response always explains what
 * happened. The guaranteed path is re-connecting orgs via the one OAuth flow.
 */
export function createLinkLegacyRouter({ linkFn = linkLegacyAgentforgeOrgs, authMiddleware = createAuthMiddleware() } = {}) {
  const router = Router();
  const requireAuth = authMiddleware;

  router.post('/', requireAuth, tenantIsolation, async (req, res) => {
    try {
      const parsed = bodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', issues: parsed.error.errors });
      }

      const result = await linkFn({
        supabase: req.supabaseClient,
        legacyJwt: parsed.data.legacyToken,
        userId: req.user.id,
      });

      // Never a hard error: the user can always re-connect orgs.
      return res.json({
        linked: result.linked,
        agentforgeUserId: result.agentforgeUserId,
        ...(result.reason ? { reason: result.reason } : {}),
      });
    } catch (err) {
      console.error('[link-legacy] error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

export const linkLegacyRouter = createLinkLegacyRouter();
