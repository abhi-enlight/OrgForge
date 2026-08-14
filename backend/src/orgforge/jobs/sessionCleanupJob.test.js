/**
 * Unit tests for the chat_sessions expiry policy (lib/sessionCleanup.js — the
 * pure DB core behind sessionCleanupJob). Scope: the fake supabase client
 * mirrors the .delete().lt().select().limit() chain, so the batch loop,
 * retention cutoff, missing-table degrade, and clamp all get coverage without
 * a database and without importing the BullMQ worker (whose module-scope
 * Redis handles would keep the test process alive).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupExpiredSessions } from '../../lib/sessionCleanup.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-13T12:00:00Z');

/**
 * Fake orgforge-schema client over an in-memory row list. `.delete().lt()`
 * mirrors PostgREST: it removes matching rows and `.select('id').limit(n)`
 * returns up to `n` of the deleted ids. `cfg.missingTable` makes every call
 * fail like an unapplied migration 008.
 */
function makeFakeDb(rows, cfg = {}) {
  const state = { rows: [...rows], deleteCalls: 0 };
  const db = {
    state,
    from: () => ({
      delete: () => ({
        lt: (column, value) => ({
          select: () => ({
            limit: async (n) => {
              state.deleteCalls++;
              if (cfg.missingTable) {
                return { data: null, error: { message: "Could not find the table 'forge.chat_sessions' in schema cache" } };
              }
              const matches = state.rows.filter((r) => r[column] < value);
              const batch = matches.slice(0, n);
              state.rows = state.rows.filter((r) => !batch.includes(r));
              return { data: batch.map((r) => ({ id: r.id })), error: null };
            },
          }),
        }),
      }),
    }),
  };
  return db;
}

const row = (id, updatedAt) => ({ id, user_id: 'u', org_id: 'o', session_id: id, updated_at: updatedAt });

test('cleanupExpiredSessions: deletes only rows idle beyond the retention window', async () => {
  const db = makeFakeDb([
    row('old1', new Date(NOW - 10 * DAY).toISOString()),
    row('old2', new Date(NOW - 8 * DAY).toISOString()),
    row('fresh', new Date(NOW - 2 * DAY).toISOString()),
  ]);
  const result = await cleanupExpiredSessions({ db, retentionDays: 7, now: NOW });
  assert.equal(result.deleted, 2, 'only the two old rows removed');
  assert.deepEqual(
    db.state.rows.map((r) => r.id),
    ['fresh'],
    'rows within the retention window survive'
  );
  assert.equal(result.cutoff, new Date(NOW - 7 * DAY).toISOString(), 'cutoff = now - retention');
});

test('cleanupExpiredSessions: retentionDays is honored and the cutoff moves with it', async () => {
  const db = makeFakeDb([
    row('day2', new Date(NOW - 2 * DAY).toISOString()),
    row('day1', new Date(NOW - DAY).toISOString()),
  ]);
  // 1-day retention → the 2-day-old row goes, the 1-day-old row stays.
  await cleanupExpiredSessions({ db, retentionDays: 1, now: NOW });
  assert.deepEqual(db.state.rows.map((r) => r.id), ['day1']);
});

test('cleanupExpiredSessions: batches deletes until nothing old remains (batch loop)', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(`old-${i}`, new Date(NOW - 9 * DAY).toISOString()));
  const db = makeFakeDb(rows);
  const result = await cleanupExpiredSessions({ db, retentionDays: 7, batchSize: 2, now: NOW });
  assert.equal(result.deleted, 5, 'all five old rows removed across batches');
  assert.equal(db.state.deleteCalls, 3, '5 rows / batch of 2 → 3 DELETE round-trips');
  assert.equal(db.state.rows.length, 0);
});

test('cleanupExpiredSessions: missing table degrades to { missing: true }, never throws', async () => {
  const db = makeFakeDb([row('old', new Date(NOW - 9 * DAY).toISOString())], { missingTable: true });
  const result = await cleanupExpiredSessions({ db, retentionDays: 7, now: NOW });
  assert.equal(result.missing, true, 'migration-not-applied is a skip, not a crash');
  assert.equal(result.deleted, 0);
  assert.equal(db.state.rows.length, 1, 'no rows touched');
});

test('cleanupExpiredSessions: any other DB error fails loudly with a clear message', async () => {
  const db = makeFakeDb([]);
  db.from = () => ({
    delete: () => ({
      lt: () => ({
        select: () => ({
          limit: async () => ({ data: null, error: { message: 'connection refused' } }),
        }),
      }),
    }),
  });
  await assert.rejects(
    () => cleanupExpiredSessions({ db, retentionDays: 7, now: NOW }),
    /chat_sessions cleanup failed: connection refused/
  );
});

test('cleanupExpiredSessions: retention clamp (0/negative → 1, huge → 90) can never nuke everything', async () => {
  // retentionDays 0 or negative clamps to 1 day → only rows older than 1 day
  // are eligible; the 2-hour-old row must survive.
  for (const bad of [0, -5, NaN, 'abc']) {
    const db = makeFakeDb([row('recent', new Date(NOW - 2 * 60 * 60 * 1000).toISOString())]);
    const result = await cleanupExpiredSessions({ db, retentionDays: bad, now: NOW });
    assert.equal(result.deleted, 0, `retention ${bad} clamped — nothing deleted`);
    assert.equal(db.state.rows.length, 1, 'recent row survives');
  }
  // Clamping to 90 days means a row only 60 days old is still kept.
  const db = makeFakeDb([row('sixty-days', new Date(NOW - 60 * DAY).toISOString())]);
  const result = await cleanupExpiredSessions({ db, retentionDays: 999, now: NOW });
  assert.equal(result.deleted, 0, 'huge retention clamped to 90 days → 60-day-old row kept');
  assert.equal(db.state.rows.length, 1);
});
