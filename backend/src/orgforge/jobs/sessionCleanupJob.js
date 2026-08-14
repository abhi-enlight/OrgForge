import { Worker } from 'bullmq';
import { createRedisConnection } from './queue.js';
import { forgeDb } from '../../lib/supabaseClients.js';
import { cleanupExpiredSessions } from '../../lib/sessionCleanup.js';

// BullMQ workers require their own connection instance when using blocking commands
const connection = createRedisConnection();

// Daily expiry sweep for orphaned chat_sessions rows (closed tabs — session
// ids live in sessionStorage). The pure policy lives in lib/sessionCleanup.js;
// this worker is just the schedule + orgforge-schema client wiring.
const worker = new Worker('orgforge-session-cleanup', async () => {
  try {
    const result = await cleanupExpiredSessions({ db: forgeDb });
    if (result.missing) {
      console.warn('[session-cleanup] chat_sessions table missing (migration 008 not applied?) — skipping.');
      return { success: true, skipped: 'missing table' };
    }
    console.log(
      `[session-cleanup] removed ${result.deleted} orphaned chat_sessions rows ` +
      `(updated_at < ${result.cutoff}).`
    );
    return { success: true, deleted: result.deleted };
  } catch (error) {
    console.error('Session cleanup job failed:', error);
    throw error;
  }
}, { connection });

export default worker;
