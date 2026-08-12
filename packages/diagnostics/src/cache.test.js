import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDiagnostics, invalidateDiagnostics, DIAGNOSTICS_TTL_MS, _clearDiagnosticsDedup } from './cache.js';

const USER = 'auth-users-1';
const ORG = '00D000000000001';
const RESULT = { state: 'ok', capability: { agents: 'ok', org_change: 'ok' } };
const PACKAGE_MISSING = {
  state: 'attention',
  capability: { agents: 'ok', org_change: 'attention' },
  checks: { package: { installed: false, detail: 'unified ECA package not installed' } },
};

/**
 * Fake supabase client with an in-memory diagnostics table.
 * @param {object} [opts]
 * @param {boolean} [opts.failTable] - missing-table error (migration 008 pending)
 * @param {string} [opts.failRead] - real read error message (must fail loudly)
 * @param {string} [opts.failWrite] - real write error message (must fail loudly)
 * @param {string} [opts.failDelete] - real delete error message (must fail loudly)
 */
function makeFakeDb({ failTable = false, failRead = null, failWrite = null, failDelete = null } = {}) {
  const rows = new Map();
  return {
    __rows: rows,
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (failRead) return { data: null, error: { message: failRead } };
              if (failTable) return { data: null, error: { message: 'relation does not exist' } };
              return { data: rows.get(`${USER}|${ORG}`) || null, error: null };
            },
          }),
        }),
      }),
      upsert: async (row, opts) => {
        if (failWrite) return { error: { message: failWrite } };
        if (failTable) return { error: { message: 'relation does not exist' } };
        rows.set(`${USER}|${ORG}`, row);
        return { error: null };
      },
      delete: () => ({
        eq: () => ({
          eq: async () => {
            if (failDelete) return { data: null, error: { message: failDelete } };
            if (failTable) return { data: null, error: { message: 'relation does not exist' } };
            rows.delete(`${USER}|${ORG}`);
            return { data: null, error: null };
          },
        }),
      }),
    }),
  };
}

beforeEach(() => {
  _clearDiagnosticsDedup();
});

test('caches result for 24h and serves it on the next read (no re-run)', async () => {
  const db = makeFakeDb();
  let runs = 0;
  const run = async () => { runs += 1; return RESULT; };

  const first = await getDiagnostics({ db, run, userId: USER, orgId: ORG });
  assert.equal(runs, 1);
  assert.equal(first.state, 'ok');

  const second = await getDiagnostics({ db, run, userId: USER, orgId: ORG });
  assert.equal(runs, 1, 'cache hit must not re-run the pre-flight');
  assert.equal(second.cached, true);
});

test('re-runs when the cached result is stale (>24h)', async () => {
  const db = makeFakeDb();
  db.__rows.set(`${USER}|${ORG}`, {
    state: 'ok',
    detail: RESULT,
    checked_at: new Date(Date.now() - DIAGNOSTICS_TTL_MS - 1000).toISOString(),
  });
  let runs = 0;
  const run = async () => { runs += 1; return { ...RESULT, state: 'attention' }; };

  const res = await getDiagnostics({ db, run, userId: USER, orgId: ORG });
  assert.equal(runs, 1, 'stale cache must trigger a re-run');
  assert.equal(res.state, 'attention');
});

test('forceRecheck bypasses a fresh cache (POST /recheck)', async () => {
  const db = makeFakeDb();
  db.__rows.set(`${USER}|${ORG}`, {
    state: 'ok', detail: RESULT, checked_at: new Date().toISOString(),
  });
  let runs = 0;
  const run = async () => { runs += 1; return { ...RESULT, state: 'attention' }; };

  const res = await getDiagnostics({ db, run, userId: USER, orgId: ORG, forceRecheck: true });
  assert.equal(runs, 1);
  assert.equal(res.state, 'attention');
});

test('package-missing run is never pinned: row cleared, every read re-checks (EC-14 package half)', async () => {
  const db = makeFakeDb();
  // A stale "ok" row from before the package was uninstalled sits in the cache.
  db.__rows.set(`${USER}|${ORG}`, {
    state: 'ok', detail: RESULT, checked_at: new Date().toISOString(),
  });
  let runs = 0;
  const run = async () => { runs += 1; return PACKAGE_MISSING; };

  // A fresh run (the user clicked Re-check, or the row was stale) detects the
  // missing package: the verdict is returned to the banner immediately...
  const res = await getDiagnostics({ db, run, userId: USER, orgId: ORG, forceRecheck: true });
  assert.equal(runs, 1);
  assert.equal(res.checks.package.installed, false);
  assert.equal(db.__rows.has(`${USER}|${ORG}`), false, 'a package-missing verdict must never be cached');

  // ...and never pinned: the next read re-runs the pre-flight instead of
  // serving the stale "ok" for 24h. The banner self-heals after install.
  const again = await getDiagnostics({ db, run, userId: USER, orgId: ORG });
  assert.equal(runs, 2, 'package-missing state self-heals: reads re-check until installed');
  assert.equal(again.state, 'attention');
});

test('cached package-missing verdict (pre-rule row) is treated as stale and re-checked', async () => {
  const db = makeFakeDb();
  db.__rows.set(`${USER}|${ORG}`, {
    state: 'attention', detail: PACKAGE_MISSING, checked_at: new Date().toISOString(),
  });
  let runs = 0;
  const run = async () => { runs += 1; return RESULT; };

  const res = await getDiagnostics({ db, run, userId: USER, orgId: ORG });
  assert.equal(runs, 1, 'a cached package-missing verdict must be re-checked, not served for 24h');
  assert.equal(res.state, 'ok');
});

test('package-missing verdict with missing table (pre-migration) degrades, never throws', async () => {
  const db = makeFakeDb({ failTable: true });
  let runs = 0;
  const run = async () => { runs += 1; return PACKAGE_MISSING; };

  const res = await getDiagnostics({ db, run, userId: USER, orgId: ORG });
  assert.equal(runs, 1);
  assert.equal(res.checks.package.installed, false, 'the run result is still returned to the caller');
});

test('package-missing verdict with a real DELETE error fails loudly', async () => {
  const db = makeFakeDb({ failDelete: 'connection refused' });
  const run = async () => PACKAGE_MISSING;

  await assert.rejects(
    () => getDiagnostics({ db, run, userId: USER, orgId: ORG }),
    /Diagnostics cache clear failed/
  );
});

test('concurrent requests for the same (user, org) share ONE run', async () => {
  const db = makeFakeDb();
  let runs = 0;
  const run = async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 20));
    return RESULT;
  };

  const [a, b] = await Promise.all([
    getDiagnostics({ db, run, userId: USER, orgId: ORG }),
    getDiagnostics({ db, run, userId: USER, orgId: ORG }),
  ]);

  assert.equal(runs, 1, 'promise dedup must collapse concurrent runs');
  assert.equal(a.state, b.state);
});

test('table missing (migration 008 not applied): runs uncached, does not throw', async () => {
  const db = makeFakeDb({ failTable: true });
  let runs = 0;
  const run = async () => { runs += 1; return RESULT; };

  const res = await getDiagnostics({ db, run, userId: USER, orgId: ORG });
  assert.equal(res.state, 'ok');
  assert.equal(runs, 1);
});

test('real cache READ error fails loudly (not swallowed like a missing table)', async () => {
  const db = makeFakeDb({ failRead: 'connection refused' });
  const run = async () => RESULT;

  await assert.rejects(
    () => getDiagnostics({ db, run, userId: USER, orgId: ORG }),
    /Diagnostics cache read failed/
  );
});

test('real cache WRITE error fails loudly (not swallowed like a missing table)', async () => {
  const db = makeFakeDb({ failWrite: 'connection refused' });
  const run = async () => RESULT;

  await assert.rejects(
    () => getDiagnostics({ db, run, userId: USER, orgId: ORG }),
    /connection refused/
  );
});

test('invalidateDiagnostics drops the stale row — the next read re-checks fresh (EC-14 invalidateAndRecheck)', async () => {
  const db = makeFakeDb();
  db.__rows.set(`${USER}|${ORG}`, {
    state: 'ok', detail: RESULT, checked_at: new Date().toISOString(),
  });
  let runs = 0;
  const run = async () => { runs += 1; return { ...RESULT, state: 'attention' }; };

  // Pre-invalidation: the (now wrong) cached "ok" serves without re-running.
  const stale = await getDiagnostics({ db, run, userId: USER, orgId: ORG });
  assert.equal(runs, 0);
  assert.equal(stale.cached, true);

  const inv = await invalidateDiagnostics({ db, userId: USER, orgId: ORG });
  assert.equal(inv.ok, true);
  assert.equal(db.__rows.has(`${USER}|${ORG}`), false, 'stale row must be deleted');

  const fresh = await getDiagnostics({ db, run, userId: USER, orgId: ORG });
  assert.equal(runs, 1, 'invalidateAndRecheck: next read must re-run the pre-flight');
  assert.equal(fresh.state, 'attention');
});

test('invalidateDiagnostics clears the in-flight dedup slot (no joining a stale-token run)', async () => {
  const db = makeFakeDb();
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const run = async () => { runs += 1; await gate; return RESULT; };

  // A run starts under the old (broken) token and is still in flight.
  const pending = getDiagnostics({ db, run, userId: USER, orgId: ORG });
  await invalidateDiagnostics({ db, userId: USER, orgId: ORG });

  // The next read must NOT join that run — it starts its own fresh one.
  const fresh = getDiagnostics({ db, run, userId: USER, orgId: ORG });
  release();
  await Promise.all([pending, fresh]);
  assert.equal(runs, 2, 'dedup slot cleared → the re-check run starts fresh');
});

test('invalidateDiagnostics: missing table (migration 008 pending) degrades, never throws', async () => {
  const db = makeFakeDb({ failTable: true });
  const res = await invalidateDiagnostics({ db, userId: USER, orgId: ORG });
  assert.equal(res.ok, true);
  assert.equal(res.degraded, true);
});

test('invalidateDiagnostics: real delete error fails loudly (not swallowed like a missing table)', async () => {
  const db = makeFakeDb({ failDelete: 'connection refused' });
  await assert.rejects(
    () => invalidateDiagnostics({ db, userId: USER, orgId: ORG }),
    /connection refused/
  );
});

test('fail-loud does not leak the in-flight dedup slot (subsequent call re-runs)', async () => {
  // failWrite: call 1 runs the pre-flight (runs=1) then fails at the persist
  // step — exercising the write-fail path AND the slot cleanup in one test.
  const db = makeFakeDb({ failWrite: 'connection refused' });
  let runs = 0;
  const run = async () => { runs += 1; return RESULT; };

  await assert.rejects(() => getDiagnostics({ db, run, userId: USER, orgId: ORG }));
  // The rejected run must not leave a stale in-flight promise: a subsequent
  // call with a healthy db starts a fresh run instead of re-rejecting.
  const healthy = makeFakeDb();
  const res = await getDiagnostics({ db: healthy, run, userId: USER, orgId: ORG });
  assert.equal(res.state, 'ok');
  assert.equal(runs, 2, 'second call must re-run (no stale dedup slot)');
});
