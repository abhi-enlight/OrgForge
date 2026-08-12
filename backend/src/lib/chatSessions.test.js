import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendChatSegment, getChatSession } from './chatSessions.js';

const USER = 'auth-users-1';
const ORG = '00D000000000001';
const SID = 'sess-123';

const OPTS = { userId: USER, orgId: ORG, sessionId: SID, capability: 'agent', engineRef: 'agentforce', summary: 'Agent done.' };

/**
 * Fake forge-schema client with a single in-memory chat_sessions row.
 * `cfg.failRead` / `cfg.failWrite` are mutable so tests can flip a failure
 * after a successful first write.
 */
function makeFakeDb(cfg = {}) {
  const state = { row: null, inserts: 0, updates: 0 };
  const db = {
    state,
    cfg,
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (cfg.failRead) return { data: null, error: { message: cfg.failRead } };
                if (cfg.missing) return { data: null, error: { message: "Could not find the table 'forge.chat_sessions' in schema cache" } };
                return state.row
                  ? { data: { capability_segments: state.row.capability_segments, compressed_history: state.row.compressed_history }, error: null }
                  : { data: null, error: null };
              },
            }),
          }),
        }),
      }),
      insert: async (row) => {
        if (cfg.failWrite) return { error: { message: cfg.failWrite } };
        if (cfg.missing) return { error: { message: "Could not find the table 'forge.chat_sessions' in schema cache" } };
        state.row = { ...row, capability_segments: JSON.parse(row.capability_segments) };
        state.inserts += 1;
        return { error: null };
      },
      update: (row) => ({
        eq: () => ({
          eq: () => ({
            eq: async () => {
              if (cfg.failWrite) return { error: { message: cfg.failWrite } };
              if (cfg.missing) return { error: { message: "Could not find the table 'forge.chat_sessions' in schema cache" } };
              state.row = { ...state.row, ...row, capability_segments: JSON.parse(row.capability_segments) };
              state.updates += 1;
              return { error: null };
            },
          }),
        }),
      }),
    }),
  };
  return db;
}

test('first append inserts the row with one capability segment', async () => {
  const db = makeFakeDb();
  const res = await appendChatSegment({ db, ...OPTS });
  assert.deepEqual(res, { inserted: true });
  assert.equal(db.state.inserts, 1);
  assert.equal(db.state.updates, 0);
  const row = db.state.row;
  assert.equal(row.session_id, SID);
  assert.equal(row.user_id, USER);
  assert.equal(row.org_id, ORG);
  assert.equal(row.capability_segments.length, 1);
  assert.equal(row.capability_segments[0].capability, 'agent');
  assert.equal(row.capability_segments[0].engineRef, 'agentforce');
  assert.equal(row.capability_segments[0].summary, 'Agent done.');
  assert.ok(row.compressed_history.includes('agent (agentforce): Agent done.'), 'history has a capability line');
});

test('second append updates the same row (segments grow, history rolls)', async () => {
  const db = makeFakeDb();
  await appendChatSegment({ db, ...OPTS });
  await appendChatSegment({
    db,
    userId: USER,
    orgId: ORG,
    sessionId: SID,
    capability: 'org_change',
    engineRef: 'orgforge',
    summary: 'Org change queued.',
  });
  assert.equal(db.state.inserts, 1, 'one row only');
  assert.equal(db.state.updates, 1, 'second append updates');
  assert.equal(db.state.row.capability_segments.length, 2);
  assert.deepEqual(
    db.state.row.capability_segments.map((s) => s.capability),
    ['agent', 'org_change']
  );
  const lines = db.state.row.compressed_history.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('org_change (orgforge): Org change queued.'));
});

test('summary is capped at 240 chars', async () => {
  const db = makeFakeDb();
  await appendChatSegment({ db, ...OPTS, summary: 'x'.repeat(500) });
  assert.equal(db.state.row.capability_segments[0].summary.length, 240);
});

test('missing table (migration 008 pending) → { missing: true }, no throw', async () => {
  const db = makeFakeDb({ missing: true });
  const res = await appendChatSegment({ db, ...OPTS });
  assert.deepEqual(res, { missing: true });
  assert.equal(db.state.inserts, 0);
});

test('real READ error fails loudly', async () => {
  const db = makeFakeDb({ failRead: 'connection refused' });
  await assert.rejects(() => appendChatSegment({ db, ...OPTS }), /chat_sessions read failed/);
});

test('real INSERT error fails loudly', async () => {
  const db = makeFakeDb({ failWrite: 'connection refused' });
  await assert.rejects(() => appendChatSegment({ db, ...OPTS }), /chat_sessions insert failed/);
});

test('real UPDATE error fails loudly (after a successful first write)', async () => {
  const db = makeFakeDb();
  await appendChatSegment({ db, ...OPTS });
  db.cfg.failWrite = 'connection refused';
  await assert.rejects(() => appendChatSegment({ db, ...OPTS }), /chat_sessions update failed/);
});

test('getChatSession returns the spine; null for missing row / missing table', async () => {
  const db = makeFakeDb();
  assert.equal(await getChatSession({ db, userId: USER, orgId: ORG, sessionId: SID }), null, 'no row yet');

  await appendChatSegment({ db, ...OPTS });
  const row = await getChatSession({ db, userId: USER, orgId: ORG, sessionId: SID });
  assert.ok(row);
  assert.equal(row.capability_segments.length, 1);

  const missingDb = makeFakeDb({ missing: true });
  assert.equal(await getChatSession({ db: missingDb, userId: USER, orgId: ORG, sessionId: SID }), null, 'missing table degrades');

  const brokenDb = makeFakeDb({ failRead: 'connection refused' });
  await assert.rejects(() => getChatSession({ db: brokenDb, userId: USER, orgId: ORG, sessionId: SID }), /chat_sessions read failed/);
});
