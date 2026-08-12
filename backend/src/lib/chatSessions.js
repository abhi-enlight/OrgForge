/**
 * forge.chat_sessions store (plan §7.3 — the shared context spine).
 *
 * Each chat/stream turn appends a capability segment
 * `{capability, engineRef, startedAt, lastMessageAt, summary}` to the session
 * row keyed by (user_id, org_id, session_id) and maintains a rolling
 * `compressed_history` line. Engines keep their own internal state
 * (Agentforce ConversationManager, OrgForge intent rows); this row is the
 * shared spine so "list my agents" → "now make the second one use my new
 * field" can span engines.
 *
 * S-2 semantics (same as routing_log / diagnostics / agents cache): a missing
 * table (migration 008 not applied) returns `{ missing: true }` so callers
 * degrade gracefully; ANY other error throws (fail-loud — a real DB bug must
 * surface, never be swallowed).
 *
 * Concurrency: chat/stream is single-flight per sessionKey, so two requests
 * never append to the same row at once (read-modify-write is safe).
 */
import { isMissingTableError } from './isMissingTable.js';

/** Cap segment summaries so rows stay lean (240 chars ≈ one LLM turn). */
const SUMMARY_MAX = 240;
/** Bound the rolling compressed_history so rows can't grow unbounded. */
const HISTORY_MAX = 4000;

function historyLine(segment, existing, maxChars) {
  const time = new Date(segment.lastMessageAt).toISOString().slice(11, 19);
  const suffix = segment.summary ? `: ${segment.summary}` : '';
  const line = `[${time}] ${segment.capability}${segment.engineRef ? ` (${segment.engineRef})` : ''}${suffix}`;
  const next = existing ? `${existing}\n${line}` : line;
  return next.length > maxChars ? next.slice(-maxChars) : next;
}

/**
 * Appends one capability segment to the session spine.
 *
 * @param {object} opts
 * @param {object} opts.db - supabase client scoped to the forge schema
 * @param {string} opts.userId
 * @param {string} opts.orgId
 * @param {string} opts.sessionId - client conversation key (max ~200 chars)
 * @param {'agent'|'org_change'|'clarify'} opts.capability
 * @param {string} [opts.engineRef] - 'agentforce' | 'orgforge' | 'router'
 * @param {string} [opts.startedAt] - ISO timestamp
 * @param {string} [opts.lastMessageAt] - ISO timestamp
 * @param {string} [opts.summary] - short human-readable turn summary
 * @returns {Promise<{missing?: boolean, inserted?: boolean, updated?: boolean}>}
 */
export async function appendChatSegment({
  db,
  userId,
  orgId,
  sessionId,
  capability,
  engineRef,
  startedAt,
  lastMessageAt,
  summary,
}) {
  const now = new Date().toISOString();
  const segment = {
    capability,
    engineRef: engineRef || null,
    startedAt: startedAt || now,
    lastMessageAt: lastMessageAt || now,
    summary: summary ? String(summary).slice(0, SUMMARY_MAX) : null,
  };

  // Read-modify-write: fetch the spine, then insert-or-update.
  const { data, error } = await db
    .from('chat_sessions')
    .select('capability_segments, compressed_history')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('session_id', sessionId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return { missing: true };
    throw new Error(`chat_sessions read failed: ${error.message}`);
  }

  if (!data) {
    const { error: insertError } = await db.from('chat_sessions').insert({
      session_id: sessionId,
      user_id: userId,
      org_id: orgId,
      capability_segments: JSON.stringify([segment]),
      compressed_history: historyLine(segment, null, HISTORY_MAX),
    });
    if (insertError) {
      if (isMissingTableError(insertError)) return { missing: true };
      throw new Error(`chat_sessions insert failed: ${insertError.message}`);
    }
    return { inserted: true };
  }

  const existing = Array.isArray(data.capability_segments) ? data.capability_segments : [];
  const { error: updateError } = await db
    .from('chat_sessions')
    .update({
      capability_segments: JSON.stringify([...existing, segment]),
      compressed_history: historyLine(segment, data.compressed_history || null, HISTORY_MAX),
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('session_id', sessionId);

  if (updateError) {
    if (isMissingTableError(updateError)) return { missing: true };
    throw new Error(`chat_sessions update failed: ${updateError.message}`);
  }
  return { updated: true };
}

/**
 * Reads the session spine (future: resume/multi-device UI, cross-engine
 * context injection). Missing table or missing row → null.
 *
 * @param {object} opts
 * @returns {Promise<object|null>} the chat_sessions row or null
 */
export async function getChatSession({ db, userId, orgId, sessionId }) {
  const { data, error } = await db
    .from('chat_sessions')
    .select('session_id, org_id, capability_segments, compressed_history, created_at, updated_at')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error(`chat_sessions read failed: ${error.message}`);
  }
  return data || null;
}
