import { createConversationStore, getDefaultRedisClient } from '../lib/redisConversations.js';
import { ConversationManager } from '../agentforge/services/aiOrchestrator.js';
import { changeRecordService as defaultChangeRecordService } from '../orgforge/services/changeRecordService.js';

/** In-process manager eviction: Agentforge's 4h hard cap + LRU bound. */
const MANAGER_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_MANAGERS = 100;

/**
 * The ConversationManager fields that are JSON-serializable and safe to persist
 * to Redis. The Gemini chat session (`this.chat`), model and Salesforce ctx are
 * NOT serializable — they are re-initialized on hydrate; handleMessage calls
 * init() when `!this.chat`, and init() re-applies existingAgentYaml /
 * agentName (the "modifying existing agent" context survives a restart).
 */
const SERIALIZABLE_FIELDS = [
  'state',
  'deployHistory',
  'agentName',
  'existingAgentYaml',
  'requirementsConfirmed',
  'activeDeployId',
  'compressionCount',
  'sfUserId',
  'sfOrgId',
  'createdAt',
  // Durable context memory (context-memory pass): the bounded verbatim turns
  // + flash summary survive restarts / evictions / multi-instance routing so
  // the manager can rebuild its Gemini history on a cold start.
  'transcriptTurns',
  'contextSummary',
];

/**
 * Agent engine adapter (plan §10.1, §7.3) — runs the Agentforce capability.
 *
 * Wraps Agentforge's `ConversationManager` — now a first-class module in this
 * repo (backend/src/agentforge, ported CJS->ESM; the @orgforge/compat loader is gone).
 * Conversation state moves to Redis (plan §7.3): the busy lock is a Redis
 * SET-NX-PX (correct 409 across instances) and the manager's serializable
 * snapshot persists after every turn (survives restarts). The live Gemini
 * session stays in-process — on a miss (new instance / restart) the manager is
 * hydrated from the persisted snapshot before its first message.
 *
 * Degradation: when Redis is unreachable, the engine falls back to the same
 * in-memory lock + state it used before this pass (warned once per failure) —
 * a request never hangs or 500s because Redis is down.
 *
 * @param {object} [opts]
 * @param {object} [opts.store] - conversation store (acquireLock/isLocked/releaseLock/getState/saveState)
 * @param {Function} [opts.ManagerClass] - injectable manager class (tests use a fake)
 * @param {object} [opts.changeRecordService] - injectable change-record writer
 *   (EC-37 signed audit records; defaults to the shared singleton)
 */
export function createAgentEngine({
  store = null,
  ManagerClass: injectedManager = null,
  changeRecordService = defaultChangeRecordService,
} = {}) {
  // The default Redis-backed store is created LAZILY on first use so importing
  // the module (or the chat/stream router that owns the singleton) never opens
  // a Redis connection — keeps tests from hanging on an open handle and keeps
  // boots cheap. An injected `store` (tests) is used as-is.
  let convStore = store;
  const getStore = () => {
    if (!convStore) convStore = createConversationStore({ redis: getDefaultRedisClient() });
    return convStore;
  };

  /** Live managers stay in-process (Gemini session) — bounded + TTL-swept. */
  const managers = new Map();
  /** In-memory lock fallback used only while Redis is unreachable. */
  const memoryLocks = new Map();

  let ManagerClass = injectedManager;

  async function getManagerClass() {
    if (ManagerClass) return ManagerClass;
    ManagerClass = ConversationManager;
    if (!ManagerClass) {
      throw new Error('ConversationManager not found. Is the Agentforge engine present?');
    }
    return ManagerClass;
  }

  function serializeManager(m) {
    const out = { sessionId: m.sessionId };
    for (const field of SERIALIZABLE_FIELDS) {
      if (m[field] !== undefined) out[field] = m[field];
    }
    return out;
  }

  function hydrateManager(m, state) {
    if (!state) return;
    for (const field of SERIALIZABLE_FIELDS) {
      if (state[field] !== undefined) m[field] = state[field];
    }
  }

  function evictStale() {
    const now = Date.now();
    for (const [key, entry] of managers) {
      if (now - entry.lastUsedAt > MANAGER_TTL_MS) managers.delete(key);
    }
    if (managers.size > MAX_MANAGERS) {
      const sorted = [...managers.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
      for (let i = 0; i < sorted.length - MAX_MANAGERS; i++) managers.delete(sorted[i][0]);
    }
  }

  async function getManager(sessionKey, Manager) {
    const existing = managers.get(sessionKey);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.manager;
    }
    const manager = new Manager(sessionKey);
    const persisted = await getStore().getState(sessionKey);
    if (persisted) hydrateManager(manager, persisted);
    managers.set(sessionKey, { manager, lastUsedAt: Date.now() });
    evictStale();
    return manager;
  }

  /**
   * Acquires the busy lock. Returns the owner token (string) when held in
   * Redis, 'memory' when held in-process (Redis down), or 'busy' when held
   * elsewhere → 409. The token is required for the owner-checked release.
   */
  async function lockState(sessionKey) {
    const acquired = await getStore().acquireLock(sessionKey);
    if (acquired === null) {
      if (memoryLocks.has(sessionKey)) return 'busy';
      memoryLocks.set(sessionKey, Date.now());
      return 'memory';
    }
    return acquired === false ? 'busy' : acquired;
  }

  return {
    /** True while a request is in flight for this conversation key (async — Redis-backed). */
    async isBusy(sessionKey) {
      const locked = await getStore().isLocked(sessionKey);
      if (locked === null) return memoryLocks.has(sessionKey);
      return locked;
    },

    /**
     * Runs one user message through the Agentforce engine, relaying progress
     * events ({type, content}) through `onEvent`. Returns {role, content}.
     *
     * @param {object} opts
     * @param {string | Array<{text?: string} | {inlineData: object} | object>} opts.message
     *   - the user prompt (post-routing). May be a Gemini parts array for an
     *   image attachment (`[{text}, {inlineData}]`, legacy parity).
     * @param {string} opts.accessToken - live Salesforce access token
     * @param {string} opts.instanceUrl - org instance URL
     * @param {string} opts.sessionKey - `${userId}|${orgId}|${sessionId}` conversation key
     * @param {(ev: {type: string, content?: string}) => void} opts.onEvent
     * @param {{turns?: Array<{role: string, text: string}>, summary?: string|null}} [opts.resume]
     *   - durable context snapshot from chat_sessions, applied ONLY on a cold
     *   start (no live chat, no Redis-hydrated snapshot) so the manager
     *   rebuilds its Gemini history instead of forgetting the conversation.
     * @returns {Promise<{role: string, content?: string, context?: {turns: Array, summary: string|null}}>}
     */
    /**
     * EC-37: a successful agent deploy also gets a signed change record (kind
     * 'agent_deploy') — the same tamper-evident audit trail org changes get in
     * the org pipeline's step 7. Best-effort by design: the deployment already
     * succeeded, so a record failure surfaces as an honest deploy_warning
     * event instead of failing the request. The audit payload travels inside
     * the deploy_success event and is stripped before the wire frame.
     */
    async writeAgentDeployRecord({ userId, orgId, manager, message, onEvent, agentAudit }) {
      try {
        const record = changeRecordService.assembleChangeRecord(
          `cs_${Date.now()}`,
          null,
          agentAudit.deployId || null,
          null,
          typeof message === 'string' ? message : 'Agent build deployed via Copilot',
          'Agent deployment via Copilot',
          userId,
          orgId,
          null,
          {
            kind: 'agent_deploy',
            agentName: agentAudit.agentName || null,
            agentSnapshot: agentAudit.agentYaml
              ? { yaml: agentAudit.agentYaml, deployedAt: agentAudit.deployedAt || null }
              : null,
          }
        );
        // Signs internally (fail-loud on a missing HMAC_SECRET), exports to
        // the user's audit repo (local fallback), and persists. Uses the
        // returned record so the displayed hash matches the persisted one.
        const persisted = await changeRecordService.exportAndPersist(record, process.env.HMAC_SECRET);
        onEvent({
          type: 'status',
          content: `Signed audit record created for agent "${agentAudit.agentName || 'deploy'}".`,
          summary: 'Signed audit record created',
        });
        return persisted;
      } catch (err) {
        onEvent({
          type: 'deploy_warning',
          content: `The agent deployed, but its audit record could not be persisted: ${err?.message || err}`,
          summary: 'Audit record not saved',
        });
        return null;
      }
    },

    async runAgent({ message, accessToken, instanceUrl, sessionKey, onEvent, resume }) {
      const lock = await lockState(sessionKey);
      if (lock === 'busy') {
        const err = new Error('A request is already running in this conversation. Please wait for it to complete.');
        err.status = 409;
        throw err;
      }
      try {
        const Manager = await getManagerClass();
        const manager = await getManager(sessionKey, Manager);
        // EC-37: wrap the caller's onEvent so a deploy_success carrying the
        // audit payload also writes a signed change record. The agentAudit
        // field is stripped before relaying (additive passthrough in the SSE
        // envelope would otherwise leak it to the client frame).
        const [userId, orgId] = sessionKey.split('|');
        const relay = (ev) => {
          if (ev?.type === 'deploy_success' && ev?.agentAudit) {
            const { agentAudit, ...clean } = ev;
            onEvent(clean);
            void this.writeAgentDeployRecord({ userId, orgId, manager, message, onEvent, agentAudit });
          } else {
            onEvent(ev);
          }
        };
        // Cold start with a caller-supplied durable snapshot (chat_sessions):
        // only applied when neither a live chat nor a Redis-hydrated snapshot
        // exists (Redis is fresher — it is written every turn).
        if (!manager.chat && resume && !manager.transcriptTurns?.length && !manager.contextSummary) {
          manager.applyResumeContext?.(resume);
        }
        // Legacy quirk: ConversationManager.init → _extractSchemaContext does
        // prompt.toLowerCase(), which CRASHES on a parts array. On a fresh
        // session (this.chat unset) handleMessage would call init with the
        // array — so pre-initialize with a safe string first (the text part);
        // handleMessage then skips init and sends the array to Gemini. This
        // guard DEPENDS on init assigning this.chat — the same contract
        // handleMessage's own `if (!this.chat)` check relies on — so there is
        // no double-init.
        if (Array.isArray(message) && !manager.chat) {
          const textPart = message.find((p) => typeof p?.text === 'string')?.text ?? '';
          await manager.init(accessToken, instanceUrl, textPart);
        }
        const result = await manager.handleMessage(message, accessToken, instanceUrl, relay);
        // Best-effort snapshot (Redis down → warn, never block the user).
        await getStore().saveState(sessionKey, serializeManager(manager));
        // The durable context snapshot rides back on the result so the route
        // can persist it to chat_sessions (the beyond-4h-TTL memory store).
        const context = manager.getContextSnapshot?.();
        return context ? { ...result, context } : result;
      } finally {
        if (lock === 'memory') {
          memoryLocks.delete(sessionKey);
        } else {
          // Redis-held: release with this acquisition's owner token (never 'memory').
          await getStore().releaseLock(sessionKey, lock);
        }
      }
    },

    /** Aborts an in-flight generation (client disconnect, §10.2). */
    abort(sessionKey) {
      managers.get(sessionKey)?.manager?.abort?.();
    },

    /**
     * Explicit conversation reset (DELETE /api/v1/chat/:contextId, legacy
     * Agentforge parity). Unlike abort (fire-and-forget on the live manager),
     * this wipes the whole conversation server-side:
     *   1. aborts any in-flight generation,
     *   2. drops the live manager + in-memory fallback lock,
     *   3. clears the Redis busy lock AND persisted state (best-effort — Redis
     *      down warns and returns, the in-memory parts above are already done).
     * Idempotent: resetting an absent/free conversation is a no-op success.
     * The Redis del is unconditional (not owner-checked) by design — the
     * caller owns this conversation key ({userId}|{orgId}|{sessionId}) and is
     * asking to wipe it, including a crash-stuck lock whose TTL has not
     * elapsed (the escape hatch a stuck 409 needs).
     *
     * Honesty notes: the abort is best-effort and in-process — the live Gemini
     * session lives in this instance's manager map (plan §7.3), so on a
     * multi-instance deployment the clear (Redis) is cross-instance while the
     * abort only reaches THIS process; and an in-flight run whose
     * handleMessage resolves after the clear can re-persist its stale snapshot
     * via saveState (same class as the disconnect-abort path — low risk, and
     * the lock itself cannot be resurrected: the owner-checked release of a
     * cleared lock is a no-op).
     */
    async resetConversation(sessionKey) {
      managers.get(sessionKey)?.manager?.abort?.();
      managers.delete(sessionKey);
      memoryLocks.delete(sessionKey);
      await getStore().clearConversation(sessionKey);
    },

    _managers: managers,
    _memoryLocks: memoryLocks,
  };
}

export const agentEngine = createAgentEngine();
