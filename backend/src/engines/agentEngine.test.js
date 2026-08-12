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
