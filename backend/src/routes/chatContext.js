import { Router } from 'express';
import { z } from 'zod';
import { createAuthMiddleware, tenantIsolation } from '@forge/auth';
import { agentEngine } from '../engines/agentEngine.js';

const paramsSchema = z.object({
  contextId: z.string().min(1).max(200), // client session id — same bounds as chat/stream's sessionId
  orgId: z.string().min(3).max(18), // Salesforce org id (tenant-scoped to req.user.id)
});

// This router is mounted at /api/v1/chat, AFTER the chat/stream + chat/route
// routers — a DELETE aimed at those literal segments falls through to here, so
// treat them as invalid rather than resetting a session literally named
// "stream"/"route" (a 400 beats silently wiping the wrong conversation).
const RESERVED_CONTEXT_IDS = ['stream', 'route'];

/**
 * DELETE /api/v1/chat/:contextId?orgId=... (plan §10.1 — legacy Agentforge
 * parity: `DELETE /api/chat/:contextId`).
 *
 * Explicit conversation reset. Unlike a client disconnect (which only aborts
 * the in-flight agent generation), this wipes the conversation server-side:
 *   1. aborts any in-flight generation,
 *   2. drops the live ConversationManager + in-memory fallback lock,
 *   3. clears the Redis busy lock AND persisted state.
 * The last point is the escape hatch a stuck request needs: if a run crashes
 * mid-flight, its lock blocks the conversation with 409s for up to the 10-min
 * TTL — DELETE clears it immediately (agentEngine.resetConversation).
 *
 * Session key is composed exactly like chat/stream's (`{userId}|{orgId}|
 * {contextId}`) so a shared org can't cross-collide conversations. `contextId`
 * is the client's session id — i.e. `default` when the stream was called
 * without an explicit sessionId. Idempotent: resetting a free/absent
 * conversation is a no-op success. Response is the legacy Agentforge shape:
 * `{ success: true }`.
 *
 * @param {object} [opts]
 * @param {object} [opts.authMiddleware] - injectable (tests)
 * @param {{ resetConversation: (sessionKey: string) => Promise<void> }} [opts.agent]
 *   - defaults to the shared agent engine singleton
 */
export function createChatContextRouter({ authMiddleware = createAuthMiddleware(), agent = agentEngine } = {}) {
  const router = Router();
  const requireAuth = authMiddleware;

  router.delete('/:contextId', requireAuth, tenantIsolation, async (req, res, next) => {
    try {
      const parsed = paramsSchema.safeParse({ contextId: req.params.contextId, ...req.query });
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', issues: parsed.error.errors });
      }
      const { contextId, orgId } = parsed.data;
      if (RESERVED_CONTEXT_IDS.includes(contextId)) {
        return res.status(400).json({ error: 'Invalid context id' });
      }
      const sessionKey = `${req.user.id}|${orgId}|${contextId}`;
      await agent.resetConversation(sessionKey);
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const chatContextRouter = createChatContextRouter();
