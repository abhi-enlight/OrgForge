import { Router } from 'express';
import { z } from 'zod';
import { createAuthMiddleware, tenantIsolation } from '@forge/auth';
import { agentEngine } from '../engines/agentEngine.js';
import { forgeDb } from '../lib/supabaseClients.js';
import { deleteChatSession, getChatSession, listChatSessions } from '../lib/chatSessions.js';

const paramsSchema = z.object({
  contextId: z.string().min(1).max(200), // client session id — same bounds as chat/stream's sessionId
  orgId: z.string().min(3).max(18), // Salesforce org id (tenant-scoped to req.user.id)
});

const listSchema = z.object({
  orgId: z.string().min(3).max(18),
});

const restoreSchema = z.object({
  sessionId: z.string().min(1).max(200),
  orgId: z.string().min(3).max(18),
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
 * @param {object} [opts.db] - forge-schema supabase client (chat_sessions)
 *   - defaults to the shared singleton
 */
export function createChatContextRouter({ authMiddleware = createAuthMiddleware(), agent = agentEngine, db = forgeDb } = {}) {
  const router = Router();
  const requireAuth = authMiddleware;

  /**
   * GET /api/v1/chat/sessions?orgId=... — the session list (History UI).
   * Lightweight metadata only (session id, last activity, one-line label);
   * the full spine for a picked session comes from GET /sessions/:sessionId.
   * Tenant-scoped: always filtered to req.user.id + the queried orgId.
   * Missing table (migration 008 pending) → empty list, never an error.
   */
  router.get('/sessions', requireAuth, tenantIsolation, async (req, res, next) => {
    try {
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', issues: parsed.error.errors });
      }
      const { orgId } = parsed.data;
      const result = await listChatSessions({ db, userId: req.user.id, orgId });
      return res.json({ sessions: result.sessions || [] });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/chat/sessions/:sessionId?orgId=... — restore one session's
   * spine (transcript + summary + segments) so the chat UI can rebuild the
   * visible conversation and the next stream turn continues the same session.
   * Triple-scoped (user_id, org_id, session_id) via getChatSession, so a
   * session can never be read outside its owner/org. Unknown session or a
   * missing table (which getChatSession degrades to null) → 404.
   */
  router.get('/sessions/:sessionId', requireAuth, tenantIsolation, async (req, res, next) => {
    try {
      const parsed = restoreSchema.safeParse({ sessionId: req.params.sessionId, ...req.query });
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', issues: parsed.error.errors });
      }
      const { sessionId, orgId } = parsed.data;
      const session = await getChatSession({ db, userId: req.user.id, orgId, sessionId });
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      let transcript = [];
      if (Array.isArray(session.transcript)) transcript = session.transcript;
      else if (typeof session.transcript === 'string') {
        try {
          const parsedTranscript = JSON.parse(session.transcript);
          if (Array.isArray(parsedTranscript)) transcript = parsedTranscript;
        } catch { /* non-JSON legacy value — no turns */ }
      }
      return res.json({
        session: {
          sessionId: session.session_id,
          transcript,
          contextSummary: session.context_summary || null,
          segments: Array.isArray(session.capability_segments) ? session.capability_segments : [],
        },
      });
    } catch (err) {
      next(err);
    }
  });

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
      // Durable-memory wipe (context-memory pass): Clear / Stop&reset must
      // also delete the session's chat_sessions spine (transcript + summary)
      // so the rotated-away session leaves no reachable memory and rows can't
      // accumulate. Best-effort: the primary job is the lock/state clear — a
      // DB failure or missing table (migration 008 pending) is warned, never
      // fatal to the reset.
      try {
        await deleteChatSession({
          db,
          userId: req.user.id,
          orgId,
          sessionId: contextId,
        });
      } catch (delErr) {
        console.warn('[chat/context] chat_sessions spine delete failed (best-effort):', delErr.message);
      }
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const chatContextRouter = createChatContextRouter();
