import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendChatSegment,
  getChatSession,
  deleteChatSession,
  buildSessionDigest,
  listChatSessions,
} from './chatSessions.js';

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
                  ? {
                      data: {
                        capability_segments: state.row.capability_segments,
                        compressed_history: state.row.compressed_history,
                        transcript: state.row.transcript,
                        context_summary: state.row.context_summary,
                      },
                      error: null,
                    }
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
      delete: () => ({
        eq: () => ({
          eq: () => ({
            eq: async () => {
              if (cfg.failWrite) return { error: { message: cfg.failWrite } };
              if (cfg.missing) return { error: { message: "Could not find the table 'forge.chat_sessions' in schema cache" } };
              state.row = null;
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

// ── durable context memory (context-memory pass) ────────────────────────────

test('append persists the durable transcript snapshot + context summary', async () => {
  const db = makeFakeDb();
  const turns = [
    { role: 'user', text: 'build an agent for Order tracking' },
    { role: 'model', text: 'Done — agent Order_Tracker is live.' },
  ];
  await appendChatSegment({ db, ...OPTS, transcript: turns, contextSummary: 'Agent Order_Tracker built.' });
  assert.equal(db.state.row.transcript, JSON.stringify(turns), 'transcript stored as JSON');
  assert.equal(db.state.row.context_summary, 'Agent Order_Tracker built.');

  // getChatSession returns them for resume.
  const row = await getChatSession({ db, userId: USER, orgId: ORG, sessionId: SID });
  assert.deepEqual(JSON.parse(row.transcript), turns);
  assert.equal(row.context_summary, 'Agent Order_Tracker built.');
});

test('a capability-only append (no transcript) never clobbers stored memory', async () => {
  const db = makeFakeDb();
  await appendChatSegment({ db, ...OPTS, transcript: [{ role: 'user', text: 'hi' }], contextSummary: 's1' });
  // Second segment (e.g. the org half of a `both` run) carries no transcript.
  await appendChatSegment({
    db,
    userId: USER,
    orgId: ORG,
    sessionId: SID,
    capability: 'org_change',
    engineRef: 'orgforge',
    summary: 'Org change queued.',
  });
  assert.equal(db.state.row.transcript, JSON.stringify([{ role: 'user', text: 'hi' }]), 'transcript untouched');
  assert.equal(db.state.row.context_summary, 's1', 'summary untouched');
  assert.equal(db.state.row.capability_segments.length, 2, 'both segments present');
});

test('transcript is bounded (turn cap + char cap, oldest dropped)', async () => {
  const db = makeFakeDb();
  const many = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'model', text: `turn ${i}` }));
  await appendChatSegment({ db, ...OPTS, transcript: many });
  const stored = JSON.parse(db.state.row.transcript);
  assert.ok(stored.length <= 40, 'turn cap applied');
  assert.equal(stored[0].text, 'turn 20', 'oldest dropped, newest kept');
  assert.equal(stored[stored.length - 1].text, 'turn 59');
});

test('deleteChatSession wipes the spine row; missing table degrades; real error throws', async () => {
  const db = makeFakeDb();
  await appendChatSegment({ db, ...OPTS });
  const res = await deleteChatSession({ db, userId: USER, orgId: ORG, sessionId: SID });
  assert.deepEqual(res, { deleted: true });
  assert.equal(await getChatSession({ db, userId: USER, orgId: ORG, sessionId: SID }), null, 'row gone');

  const missingDb = makeFakeDb({ missing: true });
  assert.deepEqual(await deleteChatSession({ db: missingDb, userId: USER, orgId: ORG, sessionId: SID }), { missing: true });

  const brokenDb = makeFakeDb({ failWrite: 'connection refused' });
  await assert.rejects(() => deleteChatSession({ db: brokenDb, userId: USER, orgId: ORG, sessionId: SID }), /chat_sessions delete failed/);
});

test('buildSessionDigest: recent capability segments + context summary, bounded', async () => {
  const db = makeFakeDb();
  await appendChatSegment({ db, ...OPTS, contextSummary: 'Built agent Order_Tracker.' });
  await appendChatSegment({
    db,
    userId: USER,
    orgId: ORG,
    sessionId: SID,
    capability: 'org_change',
    engineRef: 'orgforge',
    summary: 'Added validation rule Inv_Amount on Invoice.',
  });
  const row = await getChatSession({ db, userId: USER, orgId: ORG, sessionId: SID });
  const digest = buildSessionDigest(row);
  assert.ok(digest.includes('Session summary: Built agent Order_Tracker.'), 'summary first');
  assert.ok(digest.includes('[agent]'), 'agent segment listed');
  assert.ok(digest.includes('[org_change]: Added validation rule Inv_Amount on Invoice.'), 'org segment with summary');

  assert.equal(buildSessionDigest(null), '', 'no spine → empty digest');
  const tiny = buildSessionDigest(row, { maxChars: 30 });
  assert.ok(tiny.length <= 30, 'digest char cap applies');
});

test('buildSessionDigest: keep-tail — newest transcript turns verbatim, older turns excluded', async () => {
  const db = makeFakeDb();
  await appendChatSegment({
    db,
    ...OPTS,
    contextSummary: 'Session so far.',
    transcript: [
      { role: 'user', text: 't0' },
      { role: 'model', text: 't1' },
      { role: 'user', text: 't2' },
      { role: 'model', text: 't3' },
      { role: 'user', text: 't4' },
      { role: 'model', text: 't5' },
    ],
  });
  const row = await getChatSession({ db, userId: USER, orgId: ORG, sessionId: SID });
  const digest = buildSessionDigest(row);
  assert.ok(digest.includes('Recent conversation:'), 'tail header present');
  assert.ok(digest.includes('USER: t2') && digest.includes('ASSISTANT: t3'), 'kept tail turns verbatim');
  assert.ok(digest.includes('USER: t4') && digest.includes('ASSISTANT: t5'), 'newest turns present');
  assert.ok(!digest.includes('t0') && !digest.includes('t1'), 'older turns dropped (beyond the keep-tail)');
  assert.ok(
    digest.indexOf('Recent conversation:') > digest.indexOf('Session summary:'),
    'summary head precedes the verbatim tail'
  );
});

test('buildSessionDigest: consecutive same-capability segments merge into one line (content preserved)', async () => {
  const db = makeFakeDb();
  await appendChatSegment({ db, ...OPTS, summary: 'first change' });
  await appendChatSegment({ db, ...OPTS, capability: 'org_change', engineRef: 'orgforge', summary: 'second change' });
  await appendChatSegment({ db, ...OPTS, capability: 'org_change', engineRef: 'orgforge', summary: 'third change' });
  const row = await getChatSession({ db, userId: USER, orgId: ORG, sessionId: SID });
  const digest = buildSessionDigest(row);
  const orgLine = digest.split('\n').find((l) => l.startsWith('- [org_change]'));
  assert.ok(orgLine, 'org_change line present');
  assert.ok(orgLine.includes('second change') && orgLine.includes('third change'), 'both summaries merged into one line');
  assert.equal(orgLine.match(/\[org_change\]/g).length, 1, 'single merged line, not two');
  assert.ok(digest.includes('first change'), 'agent segment survives too');
});

test('buildSessionDigest: over budget drops whole oldest segment lines, never slices mid-line, keeps the summary head', async () => {
  const db = makeFakeDb();
  await appendChatSegment({ db, ...OPTS, contextSummary: 'Built agent Order_Tracker.', summary: 'agent turn one' });
  await appendChatSegment({ db, ...OPTS, capability: 'org_change', engineRef: 'orgforge', summary: 'Added validation rule Inv_Amount on Invoice.' });
  const row = await getChatSession({ db, userId: USER, orgId: ORG, sessionId: SID });
  // Budget fits the summary head (43) + the newest org_change line (61) +
  // newline (105 total), but not both segments (130) — the oldest one must be
  // dropped as a WHOLE line.
  const digest = buildSessionDigest(row, { maxChars: 110 });
  assert.ok(digest.includes('Session summary: Built agent Order_Tracker.'), 'summary head survives whole');
  assert.ok(digest.includes('Added validation rule Inv_Amount on Invoice.'), 'newest segment survives as a whole line');
  assert.ok(!digest.includes('agent turn one'), 'oldest segment dropped as a whole line');
  assert.ok(digest.length <= 110, 'cap respected');
});

test('buildSessionDigest: legacy string-encoded transcript is parsed for the tail', async () => {
  const row = {
    capability_segments: [],
    compressed_history: '',
    transcript: JSON.stringify([
      { role: 'user', text: 't0' },
      { role: 'model', text: 't1' },
      { role: 'user', text: 't2' },
      { role: 'model', text: 't3' },
      { role: 'user', text: 't4' },
      { role: 'user', text: 'now do the same for Account' },
    ]),
    context_summary: null,
  };
  const digest = buildSessionDigest(row);
  assert.ok(digest.includes('USER: now do the same for Account'), 'legacy transcript tail parsed');
  assert.ok(digest.includes('USER: t2'), 'kept tail turns included');
  assert.ok(!digest.includes('t0') && !digest.includes('t1'), 'older turns excluded from the tail');
  assert.ok(digest.includes('Recent conversation:'), 'tail header present');
});

// ─────────────────────────────────────────────────────────────
//  listChatSessions — the History picker backend
// ─────────────────────────────────────────────────────────────

/** Fake client for the .select().eq().eq().order().limit() list chain. */
function makeListDb(rows, cfg = {}) {
  return {
    from: () => ({
      select: () => {
        const eqs = {};
        const builder = {
          eq: (col, val) => {
            eqs[col] = val;
            return builder;
          },
          order: (col, { ascending } = {}) => ({
            limit: async (n) => {
              if (cfg.missingTable) {
                return { data: null, error: { message: "Could not find the table 'forge.chat_sessions' in schema cache" } };
              }
              if (cfg.fail) return { data: null, error: { message: cfg.fail } };
              const matches = rows.filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v));
              matches.sort((a, b) =>
                ascending ? new Date(a[col]) - new Date(b[col]) : new Date(b[col]) - new Date(a[col])
              );
              return { data: matches.slice(0, n), error: null };
            },
          }),
        };
        return builder;
      },
    }),
  };
}

test('listChatSessions: tenant-scoped (user+org), newest first, derived labels', async () => {
  const rows = [
    {
      session_id: 's1', user_id: USER, org_id: ORG,
      updated_at: '2026-08-13T10:00:00Z',
      capability_segments: [{ capability: 'org_change', summary: 'Added validation rule Inv_Amount.' }],
      context_summary: null,
    },
    {
      session_id: 's2', user_id: USER, org_id: ORG,
      updated_at: '2026-08-13T09:00:00Z',
      capability_segments: [],
      context_summary: 'Built agent X',
    },
    { session_id: 'other-user', user_id: 'someone-else', org_id: ORG, updated_at: '2026-08-14T00:00:00Z', capability_segments: [], context_summary: null },
    { session_id: 'other-org', user_id: USER, org_id: '00D000000000099', updated_at: '2026-08-14T00:00:00Z', capability_segments: [], context_summary: null },
  ];
  const { sessions } = await listChatSessions({ db: makeListDb(rows), userId: USER, orgId: ORG });
  assert.deepEqual(sessions.map((s) => s.sessionId), ['s1', 's2'], 'scoped to user+org, newest first');
  assert.equal(sessions[0].lastSummary, 'Added validation rule Inv_Amount.', 'newest segment summary as the label');
  assert.equal(sessions[0].hasSummary, false);
  assert.equal(sessions[1].lastSummary, null, 'no segment summaries → null label');
  assert.equal(sessions[1].hasSummary, true, 'context_summary presence surfaced');
});

test('listChatSessions: limit clamped 1..50', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    session_id: `s${i}`, user_id: USER, org_id: ORG,
    updated_at: new Date(2026, 7, 1, 0, i).toISOString(),
    capability_segments: [], context_summary: null,
  }));
  const { sessions } = await listChatSessions({ db: makeListDb(rows), userId: USER, orgId: ORG, limit: 2 });
  assert.equal(sessions.length, 2, 'limit honored');
  assert.equal(sessions[0].sessionId, 's5', 'newest first');
});

test('listChatSessions: missing table → { missing: true, sessions: [] }, other errors throw', async () => {
  const missing = await listChatSessions({ db: makeListDb([], { missingTable: true }), userId: USER, orgId: ORG });
  assert.equal(missing.missing, true);
  assert.deepEqual(missing.sessions, []);
  await assert.rejects(
    () => listChatSessions({ db: makeListDb([], { fail: 'connection refused' }), userId: USER, orgId: ORG }),
    /chat_sessions list failed: connection refused/
  );
});
