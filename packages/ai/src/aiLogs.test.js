import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeAiLog } from './aiLogs.js';

function fakeDb(insertFn) {
  return {
    from(table) {
      assert.equal(table, 'ai_logs', 'writer must target forge.ai_logs');
      return { insert: insertFn };
    },
  };
}

test('successful insert returns {ok:true} with merged columns mapped', async () => {
  let inserted = null;
  const db = fakeDb(async (row) => {
    inserted = row;
    return { error: null };
  });
  const res = await writeAiLog({
    db,
    userId: 'auth-users-1',
    orgId: '00D000000000001',
    sessionId: 'sess-1',
    capability: 'agent',
    prompt: 'build an agent',
    aiResponse: 'Done.',
    toolCalls: [{ name: 'deploy_agent' }],
    status: 'SUCCESS',
    latencyMs: 1234,
    modelVersion: 'gemini-3.1-pro',
  });
  assert.deepEqual(res, { ok: true });
  assert.equal(inserted.user_id, 'auth-users-1');
  assert.equal(inserted.org_id, '00D000000000001');
  assert.equal(inserted.session_id, 'sess-1');
  assert.equal(inserted.capability, 'agent');
  assert.equal(inserted.prompt, 'build an agent');
  assert.equal(inserted.ai_response, 'Done.');
  assert.deepEqual(inserted.tool_calls, [{ name: 'deploy_agent' }]);
  assert.equal(inserted.status, 'SUCCESS');
  assert.equal(inserted.latency_ms, 1234);
  assert.equal(inserted.model_version, 'gemini-3.1-pro');
});

test('org_change rows can carry the OrgForge lineage columns (intent_id)', async () => {
  let inserted = null;
  const db = fakeDb(async (row) => { inserted = row; return { error: null }; });
  await writeAiLog({ db, capability: 'org_change', intentId: 'intent-9' });
  assert.equal(inserted.capability, 'org_change');
  assert.equal(inserted.intent_id, 'intent-9');
});

test('missing table (migration 008 pending) → {missing:true}, never throws', async () => {
  const db = fakeDb(async () => ({ error: { message: "Could not find the table 'forge.ai_logs' in schema cache" } }));
  const res = await writeAiLog({ db, userId: 'u1' });
  assert.deepEqual(res, { missing: true });
});

test('real DB error → {error}, never throws (fire-and-forget contract)', async () => {
  const db = fakeDb(async () => ({ error: { message: 'connection refused' } }));
  const res = await writeAiLog({ db });
  assert.equal(res.error, 'connection refused');
});

test('thrown insert error → {error}, never throws', async () => {
  const db = fakeDb(async () => { throw new Error('pool exhausted'); });
  const res = await writeAiLog({ db });
  assert.equal(res.error, 'pool exhausted');
});

test('no db → {error}, never throws', async () => {
  const res = await writeAiLog({});
  assert.equal(res.error, 'no db provided');
});
