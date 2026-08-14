import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentEngine } from './agentEngine.js';
import { createConversationStore } from '../lib/redisConversations.js';
import { fakeRedis } from '../lib/fakeRedis.test-helper.js';

const SESSION_KEY = 'u1|00D000000000001|sess-1';

/** A ConversationManager-shaped fake that records hydration state. */
function makeFakeManager(seenAgentNames = [], seenYamls = []) {
  return class FakeManager {
    constructor(sessionId) {
      this.sessionId = sessionId;
      this.state = 'idle';
      this.agentName = null;
      this.existingAgentYaml = null;
      this.deployHistory = [];
      this.requirementsConfirmed = false;
      this.compressionCount = 0;
    }

    async handleMessage(message, token, instanceUrl, onProgress) {
      // What the manager knew BEFORE this message — proves hydration ran.
      seenAgentNames.push(this.agentName);
      seenYamls.push(this.existingAgentYaml);
      onProgress?.({ type: 'status', content: 'working' });
      this.state = 'clarifying';
      this.agentName = 'sales-agent';
      this.existingAgentYaml = 'yaml: v1';
      this.deployHistory.push({ id: 'deploy-1' });
      return { role: 'assistant', content: `Done: ${message}` };
    }

    abort() {}
  };
}

function makeEngine({ store, seenAgentNames, seenYamls, ManagerClass }) {
  const Manager = ManagerClass || makeFakeManager(seenAgentNames, seenYamls);
  return createAgentEngine({ store, ManagerClass: Manager });
}

function makeRedisStore(clock) {
  return createConversationStore({ redis: fakeRedis(clock), warn: () => {} });
}

/** A manager that tracks the durable-context memory surface (context-memory pass). */
function makeMemoryAwareManager(seen = {}) {
  return class MemoryManager {
    constructor(sessionId) {
      this.sessionId = sessionId;
      this.state = 'idle';
      this.transcriptTurns = [];
      this.contextSummary = null;
      this.chat = null;
      this.resumeCalls = [];
    }

    applyResumeContext(args) {
      this.resumeCalls.push(args);
      if (seen.resumeCalls) seen.resumeCalls.push(args);
      this.transcriptTurns = args?.turns || [];
      this.contextSummary = args?.summary || null;
    }

    getContextSnapshot() {
      return { turns: this.transcriptTurns || [], summary: this.contextSummary || null };
    }

    async handleMessage(message) {
      this.transcriptTurns = [...(this.transcriptTurns || []), { role: 'user', text: String(message) }];
      this.state = 'clarifying';
      return { role: 'assistant', content: `Done: ${message}` };
    }

    abort() {}
  };
}

function makeDownStore() {
  return {
    acquireLock: async () => null,
    isLocked: async () => null,
    releaseLock: async () => null,
    getState: async () => null,
    saveState: async () => null,
    clearConversation: async () => null,
  };
}

test('runAgent runs the manager and releases the lock afterwards', async () => {
  const store = makeRedisStore();
  const engine = makeEngine({ store });
  const result = await engine.runAgent({
    message: 'build an agent',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  assert.equal(result.content, 'Done: build an agent');
  assert.equal(await store.isLocked(SESSION_KEY), false, 'lock released after completion');
});

test('concurrent request for the same session → 409 (Redis lock is authoritative)', async () => {
  const store = makeRedisStore();
  const engine = makeEngine({ store });
  // Simulate a request already in flight on another instance.
  await store.acquireLock(SESSION_KEY);
  await assert.rejects(
    engine.runAgent({
      message: 'second request',
      accessToken: 't',
      instanceUrl: 'https://acme.my.salesforce.com',
      sessionKey: SESSION_KEY,
      onEvent: () => {},
    }),
    (err) => err.status === 409 && /already running/.test(err.message)
  );
  assert.equal(await engine.isBusy(SESSION_KEY), true, 'isBusy reflects the held lock');
});

test('serializable manager state persists after each turn', async () => {
  const store = makeRedisStore();
  const engine = makeEngine({ store });
  await engine.runAgent({
    message: 'build an agent',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  const state = await store.getState(SESSION_KEY);
  assert.equal(state.sessionId, SESSION_KEY);
  assert.equal(state.agentName, 'sales-agent');
  assert.equal(state.existingAgentYaml, 'yaml: v1');
  assert.equal(state.state, 'clarifying');
  assert.deepEqual(state.deployHistory, [{ id: 'deploy-1' }]);
});

test('new engine instance hydrates the manager from persisted state (restart survival)', async () => {
  const store = makeRedisStore();
  const seenFirst = [];
  const engineA = makeEngine({ store, seenAgentNames: seenFirst });
  await engineA.runAgent({
    message: 'first turn',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });

  // Engine B = a fresh process: empty manager map, same Redis.
  const seenSecondNames = [];
  const seenSecondYamls = [];
  const engineB = makeEngine({ store, seenAgentNames: seenSecondNames, seenYamls: seenSecondYamls });
  await engineB.runAgent({
    message: 'second turn after restart',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  // First call on engine B saw the persisted agentName + yaml → hydrated before
  // the Gemini session re-initialized (the "modifying existing agent" context).
  assert.equal(seenSecondNames[0], 'sales-agent');
  assert.equal(seenSecondYamls[0], 'yaml: v1');
  assert.equal(seenFirst[0], null, 'engine A saw no prior state on its first turn');
});

test('Redis down → in-memory fallback: runs, still 409s concurrent, never crashes', async () => {
  const store = makeDownStore();
  const engine = makeEngine({ store });

  // First request acquires the in-memory fallback lock.
  const first = engine.runAgent({
    message: 'first',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  // While it is in flight, a concurrent request must be refused (in-memory lock).
  await assert.rejects(
    engine.runAgent({
      message: 'second',
      accessToken: 't',
      instanceUrl: 'https://acme.my.salesforce.com',
      sessionKey: SESSION_KEY,
      onEvent: () => {},
    }),
    (err) => err.status === 409
  );
  await first;
  assert.equal(await engine.isBusy(SESSION_KEY), false, 'lock released after completion');
});

test('abort reaches the in-flight manager (client disconnect)', async () => {
  const store = makeRedisStore();
  const seenYamls = [];
  const Manager = makeFakeManager([], seenYamls);
  let abortCalled = false;
  Manager.prototype.abort = function () { abortCalled = true; };
  const engine = createAgentEngine({ store, ManagerClass: Manager });
  let release;
  const pending = engine.runAgent({
    message: 'long build',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  // Let the manager get created, then abort mid-flight.
  await new Promise((r) => setTimeout(r, 5));
  engine.abort(SESSION_KEY);
  assert.equal(abortCalled, true);
  await pending;
});

test('resetConversation aborts the live manager, drops it, and releases a held lock', async () => {
  const store = makeRedisStore();
  let abortCalled = false;
  const Manager = makeFakeManager([], []);
  Manager.prototype.abort = function () { abortCalled = true; };
  const engine = createAgentEngine({ store, ManagerClass: Manager });
  // Simulate a stuck in-flight run: live manager present + state saved, then
  // the lock re-acquired as if a request crashed mid-flight (runAgent releases
  // the lock in its finally, so re-acquire to model the stuck state).
  await engine.runAgent({
    message: 'first turn',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  await store.acquireLock(SESSION_KEY); // re-stick the lock (stuck-run model)
  assert.equal(await engine.isBusy(SESSION_KEY), true, 'lock held before reset');

  await engine.resetConversation(SESSION_KEY);

  assert.equal(abortCalled, true, 'in-flight generation aborted');
  assert.equal(await engine.isBusy(SESSION_KEY), false, 'stuck lock released — next request no longer 409s');
  assert.equal(await store.getState(SESSION_KEY), null, 'persisted state wiped');
  assert.equal(engine._managers.has(SESSION_KEY), false, 'live manager dropped');
});

test('image parts on a FRESH session pre-initialize the manager with the string part (no array toLowerCase crash)', async () => {
  const store = makeRedisStore();
  const initCalls = [];
  const Manager = makeFakeManager([], []);
  Manager.prototype.init = async function (token, instanceUrl, userPrompt) {
    initCalls.push(userPrompt);
    this.chat = { sendMessageStream: async () => ({}) }; // mark initialized
    this.sfUserId = 'u';
    this.sfOrgId = 'o';
  };
  const engine = createAgentEngine({ store, ManagerClass: Manager });
  const parts = [
    { text: 'What does this screenshot show?' },
    { inlineData: { data: 'QUJD', mimeType: 'image/png' } },
  ];
  await engine.runAgent({
    message: parts,
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  assert.deepEqual(initCalls, ['What does this screenshot show?'], 'init ran once, with the string text part');
});

test('image parts on an ESTABLISHED session never re-initialize the manager', async () => {
  const store = makeRedisStore();
  const initCalls = [];
  const Manager = makeFakeManager([], []);
  Manager.prototype.init = async function (token, instanceUrl, userPrompt) {
    initCalls.push(userPrompt);
    this.chat = { sendMessageStream: async () => ({}) };
  };
  const engine = createAgentEngine({ store, ManagerClass: Manager });
  await engine.runAgent({
    message: 'first text turn',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  // Simulate the established chat session the real manager sets in handleMessage.
  engine._managers.get(SESSION_KEY).manager.chat = { sendMessageStream: async () => ({}) };
  const parts = [{ text: 'now look at this', inlineData: { data: 'QUJD', mimeType: 'image/png' } }];
  await engine.runAgent({
    message: parts,
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  assert.equal(initCalls.length, 0, 'established session: the image turn must not re-init');
});

// ── durable context memory (context-memory pass) ────────────────────────────

test('cold start applies the caller-supplied resume; the snapshot persists and survives a restart', async () => {
  const store = makeRedisStore();
  const seenA = { resumeCalls: [] };
  const engineA = createAgentEngine({ store, ManagerClass: makeMemoryAwareManager(seenA) });

  // Engine A — cold: no Redis state → the chat_sessions resume is applied.
  const resume = { turns: [{ role: 'user', text: 'earlier turn' }], summary: 'old summary' };
  const result = await engineA.runAgent({
    message: 'turn one',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
    resume,
  });
  assert.equal(seenA.resumeCalls.length, 1, 'resume applied on the cold start');
  assert.deepEqual(seenA.resumeCalls[0], resume);
  // The result carries the durable snapshot back for the route to persist.
  assert.deepEqual(result.context, {
    turns: [
      { role: 'user', text: 'earlier turn' },
      { role: 'user', text: 'turn one' },
    ],
    summary: 'old summary',
  });

  // The manager's snapshot (resume + new turn) persisted to Redis.
  const state = await store.getState(SESSION_KEY);
  assert.equal(state.transcriptTurns.length, 2, 'transcript persisted');
  assert.equal(state.contextSummary, 'old summary');

  // Engine B — a fresh process (empty manager map), same Redis: the Redis
  // snapshot hydrates the manager, so a chat_sessions resume must NOT be
  // re-applied (Redis is fresher — written every turn).
  const seenB = { resumeCalls: [] };
  const engineB = createAgentEngine({ store, ManagerClass: makeMemoryAwareManager(seenB) });
  await engineB.runAgent({
    message: 'turn two after restart',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
    resume: { turns: [{ role: 'user', text: 'stale db copy' }], summary: 'stale' },
  });
  assert.equal(seenB.resumeCalls.length, 0, 'Redis snapshot wins — no double apply');
  assert.equal(
    engineB._managers.get(SESSION_KEY).manager.transcriptTurns.length,
    3,
    'hydrated turns + the new turn'
  );
});

test('resume is not applied when the manager already has a live chat', async () => {
  const store = makeRedisStore();
  const seen = { resumeCalls: [] };
  const engine = createAgentEngine({ store, ManagerClass: makeMemoryAwareManager(seen) });
  await engine.runAgent({
    message: 'first',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  // Simulate the established Gemini session the real manager sets.
  engine._managers.get(SESSION_KEY).manager.chat = { sendMessageStream: async () => ({}) };
  await engine.runAgent({
    message: 'second',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
    resume: { turns: [{ role: 'user', text: 'stale' }], summary: 'stale' },
  });
  assert.equal(seen.resumeCalls.length, 0, 'a live chat never applies resume');
});

test('resetConversation clears the in-memory fallback lock when Redis is down', async () => {
  const store = makeDownStore();
  const engine = makeEngine({ store });
  // Redis down → first runAgent holds the in-memory fallback lock.
  const first = engine.runAgent({
    message: 'first',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: () => {},
  });
  await assert.rejects(
    engine.runAgent({
      message: 'second',
      accessToken: 't',
      instanceUrl: 'https://acme.my.salesforce.com',
      sessionKey: SESSION_KEY,
      onEvent: () => {},
    }),
    (err) => err.status === 409
  );
  await first;
  await engine.resetConversation(SESSION_KEY);
  // Nothing left to clear, and a follow-up run is not 409'd by a stale lock.
  assert.equal(await engine.isBusy(SESSION_KEY), false);
});

// ── EC-37: signed audit records for agent deploys ─────────────────────────

/** A manager whose handleMessage emits a deploy_success with the audit payload. */
function makeDeployingManager(calls) {
  return class DeployingManager {
    constructor(sessionId) {
      this.sessionId = sessionId;
      this.state = 'idle';
      this.deployHistory = [];
      this.agentName = null;
      this.existingAgentYaml = 'yaml: existing';
      this.chat = null;
      calls.managerCtor = (calls.managerCtor || 0) + 1;
    }

    async handleMessage(message, token, instanceUrl, onProgress) {
      onProgress({
        type: 'deploy_success',
        content: 'https://setup.example.com/lightning',
        summary: 'Deployment succeeded',
        agentAudit: {
          agentName: 'Support_Agent_1',
          deployId: '0Af000000000ABC',
          agentYaml: 'yaml: existing',
          deployedAt: '2026-08-14T00:00:00.000Z',
        },
      });
      this.deployHistory.push({ id: '0Af000000000ABC' });
      return { role: 'assistant', content: 'Deployed.' };
    }

    abort() {}
  };
}

test('EC-37: deploy_success with agentAudit writes a signed agent_deploy record (payload stripped from wire)', async () => {
  const calls = { assemble: [], persisted: [] };
  const fakeRecordService = {
    assembleChangeRecord: (...args) => {
      calls.assemble.push(args);
      return {
        id: 'CR-1',
        changeSetId: args[0], approverIdentity: args[1], deploymentId: args[2],
        intent: args[4], userId: args[6], orgId: args[7], extras: args[9],
      };
    },
    exportAndPersist: async (record, secret) => {
      calls.persisted.push({ record, secret });
      return { ...record, signatureHash: 'a'.repeat(64) };
    },
  };
  const engine = createAgentEngine({
    store: makeRedisStore({}),
    ManagerClass: makeDeployingManager(calls),
    changeRecordService: fakeRecordService,
  });

  const events = [];
  const result = await engine.runAgent({
    message: 'Build a support agent',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: (ev) => events.push(ev),
  });
  assert.equal(result.role, 'assistant');

  // The deploy_success was relayed, but the agentAudit payload was stripped.
  const relayed = events.filter((e) => e.type === 'deploy_success');
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].agentAudit, undefined, 'agentAudit must not leak to the wire');

  // A signed agent_deploy record was assembled + persisted (async, so flush).
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.assemble.length, 1);
  assert.equal(calls.assemble[0][9].kind, 'agent_deploy');
  assert.equal(calls.assemble[0][9].agentName, 'Support_Agent_1');
  assert.equal(calls.assemble[0][9].agentSnapshot.yaml, 'yaml: existing');
  assert.equal(calls.persisted.length, 1);
  assert.equal(calls.persisted[0].secret, process.env.HMAC_SECRET);
  assert.ok(
    events.some((e) => e.type === 'status' && /Signed audit record/.test(e.content)),
    'a status event confirms the signed record'
  );
});

test('EC-37: a failed audit-record write surfaces an honest deploy_warning (deploy already succeeded)', async () => {
  const engine = createAgentEngine({
    store: makeRedisStore({}),
    ManagerClass: makeDeployingManager({}),
    changeRecordService: {
      assembleChangeRecord: () => ({}),
      exportAndPersist: async () => { throw new Error('HMAC_SECRET not configured'); },
    },
  });

  const events = [];
  await engine.runAgent({
    message: 'Build a support agent',
    accessToken: 't',
    instanceUrl: 'https://acme.my.salesforce.com',
    sessionKey: SESSION_KEY,
    onEvent: (ev) => events.push(ev),
  });

  // Flush the fire-and-forget record write.
  await new Promise((r) => setImmediate(r));
  assert.ok(
    events.some((e) => e.type === 'deploy_warning' && /audit record could not be persisted/.test(e.content)),
    'record failure is surfaced, never silent'
  );
  assert.equal(events.some((e) => e.type === 'error'), false, 'the run itself still succeeds');
});
