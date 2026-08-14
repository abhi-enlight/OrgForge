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
 * CONTEXT MEMORY (context-memory pass): the row also carries the durable
 * conversation snapshot — `transcript` (bounded verbatim text turns, the
 * agent engine's own memory) and `context_summary` (flash-compressed head).
 * It is the beyond-Redis-TTL memory store: `getChatSession` feeds a cold
 * engine on restart, and `buildSessionDigest` gives the org engine a compact
 * view of what happened earlier in this session. RLS + the triple
 * (user_id, org_id, session_id) key keep every read/write inside its own
 * session — no cross-chat or cross-user leakage.
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
/** Cap the transcript column at 40k chars so rows stay small and cheap. */
const TRANSCRIPT_MAX_CHARS = 40_000;
const TRANSCRIPT_MAX_TURNS = 40;

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
 * @param {Array<{role: 'user'|'model', text: string}>} [opts.transcript]
 *   - durable conversation snapshot (agent engine's bounded text turns).
 *   REPLACES the stored transcript (the snapshot is the full view), unlike the
 *   append-only capability_segments. Only written when provided.
 * @param {string} [opts.contextSummary] - flash-compressed summary of older
 *   turns (nullable). Only written when provided.
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
  transcript,
  contextSummary,
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

  const boundsTurns = (turns) => {
    if (!Array.isArray(turns)) return turns;
    const capped = turns.map((t) => ({
      role: t.role === 'user' ? 'user' : 'model',
      text: String(t.text || '').slice(0, 4000),
      ...(t.ts !== undefined ? { ts: t.ts } : {}),
    }));
    while (capped.length > TRANSCRIPT_MAX_TURNS) capped.shift();
    let total = capped.reduce((n, t) => n + t.text.length, 0);
    while (total > TRANSCRIPT_MAX_CHARS && capped.length > 1) {
      capped.shift();
      total = capped.reduce((n, t) => n + t.text.length, 0);
    }
    return capped;
  };

  // The transcript snapshot REPLACES the stored one (it is the full bounded
  // view from the engine); capability_segments stay append-only. Only include
  // the columns when the caller provided them so capability-only writes
  // (org_change segments) never clobber the agent memory.
  const transcriptPayload = transcript !== undefined ? boundsTurns(transcript) : undefined;
  const summaryPayload = contextSummary !== undefined ? String(contextSummary).slice(0, 6000) : undefined;

  if (!data) {
    const { error: insertError } = await db.from('chat_sessions').insert({
      session_id: sessionId,
      user_id: userId,
      org_id: orgId,
      capability_segments: JSON.stringify([segment]),
      compressed_history: historyLine(segment, null, HISTORY_MAX),
      ...(transcriptPayload !== undefined ? { transcript: JSON.stringify(transcriptPayload) } : {}),
      ...(summaryPayload !== undefined ? { context_summary: summaryPayload } : {}),
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
      ...(transcriptPayload !== undefined ? { transcript: JSON.stringify(transcriptPayload) } : {}),
      ...(summaryPayload !== undefined ? { context_summary: summaryPayload } : {}),
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
 * Reads the session spine (context-memory pass: resume/cross-engine context
 * injection). Missing table or missing row → null. Always scoped to the exact
 * (user_id, org_id, session_id) triple — a session can never read another
 * session's (or another user's) memory.
 *
 * @param {object} opts
 * @returns {Promise<object|null>} the chat_sessions row or null
 */
export async function getChatSession({ db, userId, orgId, sessionId }) {
  const { data, error } = await db
    .from('chat_sessions')
    .select('session_id, org_id, capability_segments, compressed_history, transcript, context_summary, created_at, updated_at')
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

/**
 * Lists the user's chat_sessions for one org — the "Past conversations"
 * picker behind the chat History UI (resume-from-closed-tab, the durable
 * memory's consumer side). Lightweight by design: session_id + last activity
 * + a one-line label derived from the newest capability segment summary (or
 * the newest transcript turn as a fallback) — the full transcript is fetched
 * on demand by the restore route (getChatSession), not shipped in a list.
 * Always scoped to the exact (user_id, org_id) pair — a user can never list
 * another user's or another org's sessions. Missing table (migration 008
 * pending) → `{ missing: true, sessions: [] }`; other errors throw (fail-loud).
 *
 * @param {object} opts
 * @param {object} opts.db - supabase client scoped to the forge schema
 * @param {string} opts.userId
 * @param {string} opts.orgId
 * @param {number} [opts.limit] - max sessions to return (clamped 1..50)
 * @returns {Promise<{sessions: Array<object>, missing?: boolean}>}
 */
export async function listChatSessions({ db, userId, orgId, limit = 20 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const { data, error } = await db
    .from('chat_sessions')
    .select('session_id, capability_segments, context_summary, updated_at')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(cap);
  if (error) {
    if (isMissingTableError(error)) return { missing: true, sessions: [] };
    throw new Error(`chat_sessions list failed: ${error.message}`);
  }
  const sessions = (data || []).map((row) => ({
    sessionId: row.session_id,
    updatedAt: row.updated_at || null,
    // Newest capability-segment summary is the most accurate "last activity"
    // label (engine steps carry human summaries); fall back to the newest
    // transcript turn when a row somehow has segments without summaries.
    lastSummary: deriveLastSummary(row),
    hasSummary: Boolean(row.context_summary),
  }));
  return { sessions };
}

/** Newest human-readable summary for a spine row (or null). */
function deriveLastSummary(row) {
  const segments = Array.isArray(row.capability_segments) ? row.capability_segments : [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s && s.summary) return String(s.summary).trim().slice(0, SUMMARY_MAX);
  }
  return null;
}

/**
 * Deletes a session's spine row — the durable-memory wipe behind Clear /
 * Stop&reset (chatContext route). Removes the conversation transcript so a
 * rotated-away session leaves no reachable memory and rows can't accumulate.
 * Missing table (migration 008 pending) → `{ missing: true }`; other errors
 * throw (fail-loud).
 *
 * @param {object} opts
 * @returns {Promise<{missing?: boolean, deleted?: boolean}>}
 */
export async function deleteChatSession({ db, userId, orgId, sessionId }) {
  const { error } = await db
    .from('chat_sessions')
    .delete()
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('session_id', sessionId);
  if (error) {
    if (isMissingTableError(error)) return { missing: true };
    throw new Error(`chat_sessions delete failed: ${error.message}`);
  }
  return { deleted: true };
}

/**
 * Builds a compact, bounded "what happened earlier in this session" digest
 * from the spine — the org engine's conversational memory. Mirrors the agent
 * engine's keep-tail protection: the flash-compressed summary is the HEAD,
 * the newest capability segments are the MIDDLE, and the newest VERBATIM
 * transcript turns are the TAIL — so follow-ups like "now do the same for
 * Account" have the immediate thread word-for-word. Consecutive
 * same-capability segments are MERGED (all content preserved, fewer tokens).
 * Bounding drops whole OLDEST lines first (never a mid-line slice) and only
 * trims the summary head as a last resort. Kept tiny so injecting it never
 * blows the org pipeline's token budget.
 *
 * @param {object|null} spine - a chat_sessions row from getChatSession
 * @param {object} [opts]
 * @param {number} [opts.maxSegments] - recent capability segments to include
 * @param {number} [opts.maxTurns] - newest verbatim transcript turns to include
 * @param {number} [opts.maxChars] - hard cap on the digest
 * @returns {string} empty string when there is nothing to remember
 */
export function buildSessionDigest(spine, { maxSegments = 5, maxChars = 4000, maxTurns = 4 } = {}) {
  if (!spine) return '';

  // HEAD — the flash-compressed summary of the older conversation. Always
  // kept first; trimmed only as a last resort, never dropped while content
  // remains.
  const head = spine.context_summary
    ? [`Session summary: ${String(spine.context_summary).trim().slice(0, 2000)}`]
    : [];

  // MIDDLE — recent capability segments, oldest→newest. Consecutive
  // same-capability runs MERGE into one line (joined, never dropped) so a
  // string of turns of the same engine costs one line, not several.
  const segments = Array.isArray(spine.capability_segments) ? spine.capability_segments : [];
  const merged = [];
  for (const seg of segments.slice(-maxSegments)) {
    const kind = seg.capability || 'turn';
    const summary = seg.summary ? String(seg.summary).trim().slice(0, SUMMARY_MAX) : '';
    if (!summary) continue;
    const last = merged[merged.length - 1];
    if (last && last.kind === kind) last.texts.push(summary);
    else merged.push({ kind, texts: [summary] });
  }
  let segLines = merged.map((m) => `- [${m.kind}]: ${m.texts.join(' | ')}`);

  // TAIL — the newest verbatim transcript turns (keep-tail protection: the
  // immediate thread survives word-for-word, like the agent engine's resume).
  // Handles both JSONB arrays and legacy string-encoded transcripts.
  let turns = [];
  if (Array.isArray(spine.transcript)) turns = spine.transcript;
  else if (typeof spine.transcript === 'string') {
    try {
      const parsed = JSON.parse(spine.transcript);
      if (Array.isArray(parsed)) turns = parsed;
    } catch { /* non-JSON legacy value — no turns */ }
  }
  let turnArr = turns
    .slice(-maxTurns)
    .map((t) => {
      const role = t?.role === 'user' ? 'USER' : 'ASSISTANT';
      const text = String(t?.text ?? '').trim().slice(0, 1000);
      return text ? `${role}: ${text}` : null;
    })
    .filter(Boolean);
  const buildTail = () => (turnArr.length > 0 ? ['Recent conversation:', ...turnArr] : []);
  const length = () => head.concat(segLines, buildTail()).join('\n').length;

  // BOUND — drop whole OLDEST lines first (oldest segments — they duplicate
  // the summary — then oldest tail turns, keeping the newest). Never slice a
  // line mid-text; the summary head is trimmed only as the final resort.
  while (length() > maxChars && segLines.length > 0) segLines.shift();
  while (length() > maxChars && turnArr.length > 1) turnArr.shift();
  if (length() > maxChars && head.length > 0) {
    const rest = segLines.concat(buildTail()).join('\n');
    const keep = maxChars - rest.length - (rest ? 1 : 0);
    if (keep > 0) {
      head[0] = head[0].slice(0, keep);
    } else {
      head.length = 0;
    }
  }
  return head.concat(segLines, buildTail()).join('\n');
}
