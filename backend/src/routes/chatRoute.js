import { Router } from 'express';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createAuthMiddleware, tenantIsolation } from '@forge/auth';
import { routeIntent } from '@forge/ai';
import { createHash } from 'node:crypto';

const bodySchema = z.object({
  message: z.string().min(1).max(50_000), // EC-28 zod cap, matches engines
  pinned: z.enum(['agent', 'org_change', 'both', 'clarify']).optional(),
});

// Module-level singleton scoped to the forge schema (routing_log lives there,
// migration 008 / S-2). Same pattern as @forge/auth and diagnostics.
const forgeDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy_key',
  { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: 'orgforge' } }
);

function hashPrompt(message) {
  return createHash('sha256').update(message).digest('hex').slice(0, 32);
}

/**
 * POST /api/v1/chat/route (plan §10.1) — standalone classifier.
 *
 * Returns the routing decision; the caller then invokes the specialist engine.
 * Every decision is logged to forge.routing_log (prompt hash, capability,
 * confidence, override source) feeding the lessons loop (§7.4). Logging is
 * best-effort: if migration 008 isn't applied yet (S-2), the route still
 * answers — the write failure is swallowed.
 */
export function createChatRouteRouter({ authMiddleware = createAuthMiddleware(), route = routeIntent, db = forgeDb } = {}) {
  const router = Router();
  const requireAuth = authMiddleware;

  router.post('/', requireAuth, tenantIsolation, async (req, res, next) => {
    try {
      const parsed = bodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', issues: parsed.error.errors });
      }
      const { message, pinned } = parsed.data;

      const decision = await route(message, { pinned });

      // Best-effort routing log (never fails the request).
      try {
        await db.from('routing_log').insert({
          user_id: req.user.id,
          prompt_hash: hashPrompt(message),
          capability: decision.capability,
          confidence: decision.confidence,
          override_source: decision.overrideSource,
        });
      } catch (logErr) {
        console.warn('[chat/route] routing_log write skipped (S-2 pending?):', logErr.message);
      }

      return res.json(decision);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const chatRouteRouter = createChatRouteRouter();
