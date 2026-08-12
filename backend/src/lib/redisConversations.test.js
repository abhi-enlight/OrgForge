import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationStore, CONV_KEY_PREFIX, LOCK_SUFFIX, LOCK_TTL_MS } from './redisConversations.js';
import { fakeRedis } from './fakeRedis.test-helper.js';

function downRedis() {
  return {
    set: async () => { throw new Error('ECONNREFUSED'); },
    get: async () => { throw new Error('ECONNREFUSED'); },
    del: async () => { throw new Error('ECONNREFUSED'); },
    exists: async () => { throw new Error('ECONNREFUSED'); },
    eval: async () => { throw new Error('ECONNREFUSED'); },
  };
}

const KEY = 'u1|00D000000000001|sess-1';

test('acquireLock: SET NX semantics — owner token returned, second acquire while held is false', async () => {
  const store = createConversationStore({ redis: fakeRedis(), warn: () => {} });
  const token = await store.acquireLock(KEY);
  assert.equal(typeof token, 'string', 'first acquire returns the owner token');
  assert.equal(await store.acquireLock(KEY), false, 'held elsewhere → false');
  assert.equal(await store.isLocked(KEY), true);
});

test('releaseLock with the owner token frees the lock for the next acquirer', async () => {
  const store = createConversationStore({ redis: fakeRedis(), warn: () => {} });
  const token = await store.acquireLock(KEY);
  assert.equal(await store.releaseLock(KEY, token), true);
  const next = await store.acquireLock(KEY);
  assert.equal(typeof next, 'string', 're-acquirable after release');
  assert.equal(await store.isLocked(KEY), true);
});

test('releaseLock without the owner token cannot release a lock it does not own', async () => {
  const store = createConversationStore({ redis: fakeRedis(), warn: () => {} });
  await store.acquireLock(KEY);
  assert.equal(await store.releaseLock(KEY), true, 'no-op resolves (best-effort contract)');
  assert.equal(await store.isLocked(KEY), true, 'lock still held by the real owner');
});

test('stale releaser (expired lock re-acquired by another owner) cannot delete the new lock', async () => {
  const store = createConversationStore({ redis: fakeRedis(), warn: () => {} });
  const tokenA = await store.acquireLock(KEY);
  assert.equal(await store.acquireLock(KEY), false, 'B cannot acquire while A holds');
  // A's lock expires and B acquires; then A's late finally tries to release.
  await store.releaseLock(KEY, tokenA); // simulate expiry: A's lock is gone
  const tokenB = await store.acquireLock(KEY);
  assert.equal(typeof tokenB, 'string', 'B now holds the lock');
  await store.releaseLock(KEY, tokenA); // A's stale release — must be a no-op
  assert.equal(await store.isLocked(KEY), true, 'B still holds the lock (no double-execution window)');
  await store.releaseLock(KEY, tokenB);
  assert.equal(await store.isLocked(KEY), false, 'B releases cleanly');
});

test('lock auto-expires after its TTL (crash-safe: no stale busy conversation)', async () => {
  let now = 1_000_000;
  const clock = { now: () => now };
  const store = createConversationStore({ redis: fakeRedis(clock), warn: () => {} });
  await store.acquireLock(KEY);
  assert.equal(await store.isLocked(KEY), true);
  now += LOCK_TTL_MS + 1;
  assert.equal(await store.isLocked(KEY), false, 'expired lock reads as free');
});

test('state save/load round-trips JSON and honors the TTL', async () => {
  let now = 1_000_000;
  const clock = { now: () => now };
  const store = createConversationStore({ redis: fakeRedis(clock), warn: () => {} });
  assert.equal(await store.getState(KEY), null, 'absent state → null');
  await store.saveState(KEY, { agentName: 'sales-agent', deployHistory: [{ id: 'x' }] }, 2);
  const state = await store.getState(KEY);
  assert.equal(state.agentName, 'sales-agent');
  assert.deepEqual(state.deployHistory, [{ id: 'x' }]);
  now += 2_001;
  assert.equal(await store.getState(KEY), null, 'expired state reads as absent');
});

test('keys are namespaced (prefix + :lock suffix) so conversation vs lock never collide', async () => {
  const redis = fakeRedis();
  const store = createConversationStore({ redis, warn: () => {} });
  await store.acquireLock(KEY);
  await store.saveState(KEY, { agentName: 'a' });
  assert.ok(redis.data.has(CONV_KEY_PREFIX + KEY + LOCK_SUFFIX));
  assert.ok(redis.data.has(CONV_KEY_PREFIX + KEY));
});

test('Redis down → every operation degrades to null (never throws)', async () => {
  const warnings = [];
  const store = createConversationStore({ redis: downRedis(), warn: (m) => warnings.push(m) });
  assert.equal(await store.acquireLock(KEY), null);
  assert.equal(await store.isLocked(KEY), null);
  assert.equal(await store.releaseLock(KEY), null);
  assert.equal(await store.getState(KEY), null);
  assert.equal(await store.saveState(KEY, {}), null);
  assert.equal(await store.clearConversation(KEY), null);
  assert.ok(warnings.length >= 6, 'each failure warns so ops can see the degrade');
});

test('clearConversation deletes BOTH the persisted state and the busy lock', async () => {
  const redis = fakeRedis();
  const store = createConversationStore({ redis, warn: () => {} });
  await store.acquireLock(KEY);
  await store.saveState(KEY, { agentName: 'sales-agent' });
  assert.equal(await store.isLocked(KEY), true, 'lock held before clear');
  assert.ok((await store.getState(KEY)).agentName, 'state present before clear');

  assert.equal(await store.clearConversation(KEY), true);
  assert.equal(await store.isLocked(KEY), false, 'stuck lock released — the crash/TTL escape hatch');
  assert.equal(await store.getState(KEY), null, 'persisted state wiped');
  assert.ok(!redis.data.has(CONV_KEY_PREFIX + KEY + LOCK_SUFFIX));
  assert.ok(!redis.data.has(CONV_KEY_PREFIX + KEY));
});

test('clearConversation is idempotent — clearing an absent conversation is a no-op success', async () => {
  const store = createConversationStore({ redis: fakeRedis(), warn: () => {} });
  assert.equal(await store.clearConversation(KEY), true);
  assert.equal(await store.clearConversation(KEY), true);
});
