/**
 * chat_sessions expiry policy — pure DB logic, no Redis/Worker imports so it
 * can be unit-tested in isolation (sessionCleanupJob wraps this in a BullMQ
 * worker).
 *
 * chat_sessions rows are keyed by (user_id, org_id, session_id), and the
 * session id lives in the tab's sessionStorage — so closing a tab orphans its
 * spine row forever: nothing ever touches it again, and every new tab creates
 * fresh rows. The live conversation memory already expires fast (4h Redis
 * snapshot TTL, 30-min idle manager eviction), so a row idle for
 * RETENTION_DAYS is, by construction, abandoned — deleting it frees storage
 * with no user-visible loss (there is no session-list UI to resume from a
 * closed tab).
 *
 * Deletes are keyed on updated_at (maintained on every appendChatSegment
 * write) and bounded in batches so one run never holds a long transaction.
 * Missing table (migration 008 pending) degrades to a skipped run — any other
 * DB error fails loudly (same S-2 contract as the rest of the app).
 */
import { isMissingTableError } from './isMissingTable.js';

const DEFAULT_RETENTION_DAYS = 7;   // idle sessions older than this are removed
const BATCH_SIZE = 500;             // rows deleted per DELETE round-trip
const MAX_DELETE_BUDGET = 50_000;   // hard cap per run (500 × 100 batches)

/**
 * Deletes chat_sessions rows idle longer than `retentionDays`.
 *
 * @param {object} opts
 * @param {object} opts.db - supabase client scoped to the orgforge schema
 * @param {number} [opts.retentionDays] - idle cutoff in days (clamped 1..90)
 * @param {number} [opts.batchSize] - rows per DELETE batch
 * @param {number} [opts.now] - epoch ms reference for the cutoff (tests)
 * @returns {Promise<{deleted: number, cutoff: string, missing?: boolean}>}
 */
export async function cleanupExpiredSessions({
  db,
  retentionDays = DEFAULT_RETENTION_DAYS,
  batchSize = BATCH_SIZE,
  now = Date.now(),
} = {}) {
  // Clamp so a misconfiguration (0, negative, absurdly large) can never nuke
  // the whole table or delete everything in one run.
  const days = Math.min(Math.max(Number(retentionDays) || DEFAULT_RETENTION_DAYS, 1), 90);
  const cutoff = new Date(now - days * 86_400_000).toISOString();

  let deleted = 0;
  while (deleted < MAX_DELETE_BUDGET) {
    const { data, error } = await db
      .from('chat_sessions')
      .delete()
      .lt('updated_at', cutoff)
      .select('id')
      .limit(batchSize);

    if (error) {
      if (isMissingTableError(error)) return { missing: true, deleted, cutoff };
      throw new Error(`chat_sessions cleanup failed: ${error.message}`);
    }
    const n = Array.isArray(data) ? data.length : 0;
    deleted += n;
    // A short batch means nothing older than the cutoff remains — done.
    if (n < batchSize) break;
  }
  return { deleted, cutoff };
}
