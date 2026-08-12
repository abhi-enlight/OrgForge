import { Router } from 'express';
import { z } from 'zod';
import { createAuthMiddleware } from '@forge/auth';
import { isMissingTableError } from '../lib/isMissingTable.js';
import { publicDb as publicDbSingleton } from '../lib/supabaseClients.js';

/**
 * Public-schema client for the legacy audit tables. `refusal_logs` and its
 * parent `change_intents` live in the `public` schema (OrgForge migration
 * 003) — NOT the `forge` schema (migration 008 created forge.* from scratch;
 * the legacy change/refusal tables were never moved, per plan §9 additive).
 * Shared singleton from lib/supabaseClients.js — no per-route instantiation.
 */


const querySchema = z.object({
  orgId: z.string().min(3).max(18).optional(), // Salesforce org id (tenant-scoped)
});

/** Select columns from the embed (change_intents via the FK). */
const SELECT = 'id, gate_code, reason, missing_evidence, unblock_path, created_at, change_intents!inner(user_id, org_id, prompt)';

/**
 * Builds the unified refusal-logs router (PRD FR-5 "refusal log" + OrgForge
 * PRD Group 7: refusal change records).
 *
 * GET /api/v1/refusal-logs?orgId=... → the dedicated refusal audit trail:
 * every gate that REFUSED (or the REF-07 production acknowledgment), joined
 * with the originating change intent so each row carries the plain-language
 * reason, missing evidence, and human unblock path — the "refusal is a
 * first-class outcome" (Hard Rule 5) read surface.
 *
 * `refusal_logs` has NO user_id column — tenant isolation is enforced by
 * joining through `change_intents` (`change_intent_id` FK) and filtering on
 * `change_intents.user_id = req.user.id` (postgREST `!inner` embed). RLS is
 * never a backstop on the service-role client (tenantIsolation contract).
 *
 * Degradation (S-3): a missing `refusal_logs` / `change_intents` table
 * (OrgForge migrations 003–005 pending) degrades to an empty list with a
 * `note`; any OTHER DB error fails loudly (500).
 *
 * @param {object} [opts]
 * @param {object} [opts.authMiddleware] - injectable (tests)
 * @param {() => object} [opts.dbFactory] - public-schema supabase client (tests)
 */
export function createRefusalLogsRouter({
  authMiddleware = createAuthMiddleware(),
  dbFactory = () => publicDbSingleton,
} = {}) {
  const router = Router();
  const requireAuth = authMiddleware;

  router.get('/', requireAuth, async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', issues: parsed.error.errors });
    }
    const { orgId } = parsed.data;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const db = dbFactory();
      let query = db
        .from('refusal_logs')
        .select(SELECT)
        .eq('change_intents.user_id', userId);
      if (orgId) query = query.eq('change_intents.org_id', orgId);
      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) {
        if (isMissingTableError(error)) {
          return res.json({
            refusals: [],
            note: 'Refusal audit trail unavailable — the legacy audit tables may not be migrated yet (OrgForge migrations 003–005, plan S-3).',
          });
        }
        throw new Error(`Refusal log read failed: ${error.message}`);
      }

      const refusals = (data || []).map((row) => ({
        id: row.id,
        changeIntentId: row.change_intent_id,
        gateCode: row.gate_code,
        reason: row.reason,
        missingEvidence: row.missing_evidence,
        unblockPath: row.unblock_path,
        orgId: row.change_intents?.org_id ?? null,
        intent: row.change_intents?.prompt ?? null,
        createdAt: row.created_at,
      }));
      res.json({ refusals });
    } catch (err) {
      console.error('Refusal log read error:', err.message);
      res.status(500).json({ error: 'Failed to load refusal log' });
    }
  });

  return router;
}

export const refusalLogsRouter = createRefusalLogsRouter();
