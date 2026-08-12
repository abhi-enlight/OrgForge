import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDiagnosticsRouter } from './diagnostics.js';

const RESULT = { state: 'ok', capability: { agents: 'ok', org_change: 'ok' } };

function makeApp({ getCredentials, preFlight, forgeDbFactory }) {
  const app = express();
  const stubAuth = (req, res, next) => {
    req.user = { id: 'auth-users-1' };
    next();
  };
  const router = createDiagnosticsRouter({
    authMiddleware: stubAuth,
    getCredentials,
    preFlight,
    forgeDbFactory: forgeDbFactory || (() => null),
  });
  app.use('/api/v1/diagnostics', router);
  return app;
}

function listen(app) {
  const server = app.listen(0);
  return { server, port: server.address().port };
}

test('GET /diagnostics returns a cached pre-flight result', async () => {
  let preFlights = 0;
  const app = makeApp({
    getCredentials: async () => ({ accessToken: 'tok', instanceUrl: 'https://a.my.salesforce.com' }),
    preFlight: async () => { preFlights += 1; return RESULT; },
    forgeDbFactory: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
        upsert: async () => ({ error: null }),
      }),
    }),
  });
  const { server, port } = listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics?orgId=00D000000000001`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.state, 'ok');
    assert.equal(preFlights, 1);
  } finally {
    server.close();
  }
});

test('POST /recheck forces a fresh run (bypasses cache)', async () => {
  let preFlights = 0;
  const app = makeApp({
    getCredentials: async () => ({ accessToken: 'tok', instanceUrl: 'https://a.my.salesforce.com' }),
    preFlight: async () => { preFlights += 1; return { ...RESULT, checkedAt: preFlights }; },
    forgeDbFactory: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
        upsert: async () => ({ error: null }),
      }),
    }),
  });
  const { server, port } = listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics/recheck?orgId=00D000000000001`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).checkedAt, 1);
  } finally {
    server.close();
  }
});

test('missing orgId is a 400', async () => {
  const app = makeApp({ getCredentials: async () => { throw new Error('must not be called'); } });
  const { server, port } = listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics`);
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('unknown org is a 404', async () => {
  const app = makeApp({
    getCredentials: async () => { throw Object.assign(new Error('not found'), { status: 404 }); },
  });
  const { server, port } = listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics?orgId=00D000000000001`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('refresh failure surfaces 401 "Reconnect this org" (EC-10)', async () => {
  const app = makeApp({
    getCredentials: async () => { throw Object.assign(new Error('could not be refreshed'), { status: 401 }); },
  });
  const { server, port } = listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics?orgId=00D000000000001`);
    assert.equal(res.status, 401);
    assert.match((await res.json()).error, /Reconnect this org/);
  } finally {
    server.close();
  }
});

test('auth-break refresh failure invalidates the cache — next read re-checks fresh (EC-14)', async () => {
  // Stateful forge-schema fake: cached rows survive across requests so the
  // invalidation is observable end to end.
  const rows = new Map();
  const KEY = 'auth-users-1|00D000000000001';
  const forgeDbFactory = () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows.get(KEY) || null, error: null }) }) }) }),
      upsert: async (row) => { rows.set(KEY, row); return { error: null }; },
      delete: () => ({ eq: () => ({ eq: async () => { rows.delete(KEY); return { data: null, error: null }; } }) }),
    }),
  });

  let preFlights = 0;
  let credsMode = 'ok';
  const app = makeApp({
    getCredentials: async (db, uid, orgId, opts) => {
      if (credsMode === 'fail') {
        // Mimic getOrgCredentials: the refresh-failure hook fires INSIDE the
        // refresh path with the underlying 401, then the 401 surfaces.
        await opts.onRefreshFailure(Object.assign(new Error('invalid_grant'), { status: 401 }));
        throw Object.assign(new Error('could not be refreshed'), { status: 401 });
      }
      return { accessToken: 'tok', instanceUrl: 'https://a.my.salesforce.com' };
    },
    preFlight: async () => { preFlights += 1; return { ...RESULT, state: preFlights === 1 ? 'ok' : 'attention' }; },
    forgeDbFactory,
  });
  const { server, port } = listen(app);
  try {
    // 1. First check runs and caches an "ok".
    const first = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics?orgId=00D000000000001`);
    assert.equal(first.status, 200);
    assert.equal(preFlights, 1);
    assert.equal(rows.has(KEY), true, 'result persisted to the cache');

    // 2. Second read serves the (soon-to-be-stale) cache.
    const cached = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics?orgId=00D000000000001`);
    assert.equal(preFlights, 1);
    assert.equal((await cached.json()).cached, true);

    // 3. The token refresh breaks (revoked token → 401): the request 401s AND
    //    the stale cache row is dropped by the onRefreshFailure hook.
    credsMode = 'fail';
    const failed = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics?orgId=00D000000000001`);
    assert.equal(failed.status, 401);
    assert.equal(rows.has(KEY), false, 'EC-14: stale cache invalidated on the auth break');

    // 4. After reconnect the next read RE-CHECKS instead of serving stale ok.
    credsMode = 'ok';
    const rechecked = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics?orgId=00D000000000001`);
    assert.equal(rechecked.status, 200);
    assert.equal(preFlights, 2, 'invalidateAndRecheck: fresh run after the invalidation');
    assert.equal((await rechecked.json()).state, 'attention');
  } finally {
    server.close();
  }
});

test('transient refresh failure (500) does NOT invalidate the cache (401/403 only)', async () => {
  const rows = new Map();
  const KEY = 'auth-users-1|00D000000000001';
  const forgeDbFactory = () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows.get(KEY) || null, error: null }) }) }) }),
      upsert: async (row) => { rows.set(KEY, row); return { error: null }; },
      delete: () => ({ eq: () => ({ eq: async () => { rows.delete(KEY); return { data: null, error: null }; } }) }),
    }),
  });

  let credsMode = 'ok';
  const app = makeApp({
    getCredentials: async (db, uid, orgId, opts) => {
      if (credsMode === 'fail500') {
        await opts.onRefreshFailure(Object.assign(new Error('Salesforce OAuth outage'), { status: 500 }));
        throw Object.assign(new Error('could not be refreshed'), { status: 401 });
      }
      return { accessToken: 'tok', instanceUrl: 'https://a.my.salesforce.com' };
    },
    preFlight: async () => RESULT,
    forgeDbFactory,
  });
  const { server, port } = listen(app);
  try {
    await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics?orgId=00D000000000001`);
    assert.equal(rows.has(KEY), true, 'cached after the first run');

    credsMode = 'fail500';
    const failed = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics?orgId=00D000000000001`);
    assert.equal(failed.status, 401, 'refresh failure still surfaces as 401');
    assert.equal(rows.has(KEY), true, 'a transient 500 must NOT drop the cache row — the stored token may still be fine');
  } finally {
    server.close();
  }
});
