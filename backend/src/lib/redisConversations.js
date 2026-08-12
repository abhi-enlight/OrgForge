import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

/**
 * Redis-backed conversation state for the agent engine (plan §7.3).
 *
 * Agentforge's in-memory `activeConversations` pattern moves to Redis keyed by
 * `{user_id, org_id, session_id}` so the busy-lock and the conversation's
 * serializable metadata survive restarts and scale across API instances. The
 * live Gemini session itself stays in-process (not serializable) — see
 * agentEngine.js for the hydrate-on-miss behavior.
 *
 * Degradation contract (OrgForge's Redis pattern): an unreachable Redis never
 * crashes the API. Every operation catches connectivity errors, warns once per
 * failure, and returns `null` so callers fall back to in-memory behavior.
 */
export const CONV_KEY_PREFIX = 'forge:conv:v1:';
export const LOCK_SUFFIX = ':lock';
/**
 * Lock TTL: comfortably past any plausible request (multi-tool agent loop +
 * deploy + poll) so the lock never flaps mid-flight. Crash-safe: a dead
 * process blocks its conversation for at most this long, then the lock is
 * re-acquirable (owner-checked release keeps the handoff safe).
 */
export const LOCK_TTL_MS = 600_000;
/** Agentforge's conversation hard cap (§3: 4h) — Redis expiry mirrors it. */
export const STATE_TTL_SECONDS = 4 * 60 * 60;

const convKey = (key) => CONV_KEY_PREFIX + key;
const lockKey = (key) => convKey(key) + LOCK_SUFFIX;

/** Atomic compare-and-delete: `del` only when the lock still holds the given token. */
const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

// Module-level singleton client (OrgForge queue.js pattern). maxRetriesPerRequest
// is small so commands fail fast when Redis is down — the engine degrades to
// in-memory instead of hanging a user request.
let defaultClient = null;
export function getDefaultRedisClient() {
  if (!defaultClient) {
    defaultClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
    });
    // Prevent unhandled 'error' events from crashing the API server while
    // Redis is unreachable (e.g. local dev without a running Redis instance).
    defaultClient.on('error', (err) => {
      console.warn('[redis-conversations] Redis unavailable — conversation locks/state degrade to in-memory:', err.message);
    });
  }
  return defaultClient;
}

/**
 * Builds a conversation store over any redis-like client (tests inject a fake).
 *
 * Return-value convention: `true`/`false` for real answers, `null` when Redis
 * is unreachable (caller falls back to in-memory state).
 *
 * @param {object} opts
 * @param {object} opts.redis - ioredis-compatible client (set/get/del/exists)
 * @param {(msg: string) => void} [opts.warn]
 */
export function createConversationStore({ redis, warn = (msg) => console.warn(msg) } = {}) {
  return {
    /**
     * SET NX PX with a unique owner token as the value. Returns the token when
     * acquired, `false` when held elsewhere, `null` when Redis is down.
     */
    async acquireLock(key) {
      try {
        const token = randomUUID();
        const ok = (await redis.set(lockKey(key), token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
        return ok ? token : false;
      } catch (err) {
        warn(`[redis-conversations] lock acquire failed — degrading to in-memory: ${err.message}`);
        return null;
      }
    },

    /** True = locked, false = free, null = Redis down (caller uses in-memory). */
    async isLocked(key) {
      try {
        return (await redis.exists(lockKey(key))) === 1;
      } catch (err) {
        warn(`[redis-conversations] lock check failed — degrading to in-memory: ${err.message}`);
        return null;
      }
    },

    /**
     * Owner-checked release: deletes the lock ONLY if it still holds THIS
     * acquisition's token. A stale releaser (whose lock TTL expired and was
     * re-acquired by another instance) can never delete the new owner's lock —
     * the double-execution bug a plain DEL would allow. Run as a single atomic
     * Lua script so the compare and the delete cannot be split by the TTL
     * boundary (no TOCTOU window even mid-expiry).
     */
    async releaseLock(key, token) {
      try {
        await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey(key), token);
        return true;
      } catch (err) {
        warn(`[redis-conversations] lock release failed: ${err.message}`);
        return null;
      }
    },

    /** Serialized conversation state, or null when absent / Redis down. */
    async getState(key) {
      try {
        const raw = await redis.get(convKey(key));
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        warn(`[redis-conversations] state read failed — starting fresh: ${err.message}`);
        return null;
      }
    },

    async saveState(key, state, ttlSeconds = STATE_TTL_SECONDS) {
      try {
        await redis.set(convKey(key), JSON.stringify(state), 'EX', ttlSeconds);
        return true;
      } catch (err) {
        warn(`[redis-conversations] state save failed (best-effort): ${err.message}`);
        return null;
      }
    },

    /**
     * Explicit conversation reset (DELETE /api/v1/chat/:contextId, legacy
     * Agentforge parity): deletes the conversation's persisted state AND its
     * busy lock in one call. Unlike the owner-checked releaseLock, this is an
     * unconditional del — the caller is the conversation owner asking to wipe
     * the conversation (including a crash-stuck lock whose 10-min TTL has not
     * elapsed), and the key embeds the user id so it is already tenant-scoped.
     * Idempotent: absent keys are a no-op success. Returns true, or null when
     * Redis is down (in-memory fallback already cleared by the caller).
     */
    async clearConversation(key) {
      try {
        await redis.del(convKey(key), lockKey(key));
        return true;
      } catch (err) {
        warn(`[redis-conversations] conversation clear failed (best-effort): ${err.message}`);
        return null;
      }
    },
  };
}
