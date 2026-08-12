import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentsRouter } from './agents.js';

const USER = 'auth-users-1';
const ORG = '00D000000000001';

const LIVE_AGENTS = [
  { id: '0hA1000000001AAA', developerName: 'Order_Agent', masterLabel: 'Order Agent' },
  { id: '0hA1000000002BBB', developerName: 'Support_Agent', masterLabel: 'Support Agent' },
];

const CACHE_ROWS = [
  { developer_name: 'Order_Agent', label: 'Order Agent', status: 'active', updated_at: '2026-08-10T00:00:00Z' },
];

// ── fakes ────────────────────────────────────────────────────────────────────

const stubAuth = (req, res, next) => { req.user = { id: USER }; next(); };

const stubCredentials = async () => ({
  accessToken: '00D-token',
  refreshToken: 'rt',
  instanceUrl: 'https://acme.my.salesforce.com',
  orgType: 'production',
  expiresAt: Date.now() + 7200_000,
});

/**
 * Fake forge-schema client.
 * @param {object} [opts]
 * @param {Array} [opts.rows] - pre-seeded agents cache rows
 * @param {string} [opts.readError] - message for the read (select) result; a
 *   missing-table message degrades, anything else must fail loudly
 * @param {string} [opts.writeError] - message for the write (upsert) result
 */
function makeFakeForgeDb({ rows = [], readError = null, writeError = null } = {}) {
  const written = [];
  return {
    __written: written,
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => (readError ? { data: null, error: { message: readError } } : { data: rows, error: null }),
        }),
      }),
      upsert: async (batch) => {
        if (writeError) return { error: { message: writeError } };
        written.push(...batch);
        return { error: null };
      },
    }),
  };
}

function mockRes() {
  const res = {
    headersSent: false,
    setHeader() {},
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}

/**
 * Invokes the agents router directly (race-free, no HTTP).
 *
 * Returns a result object whose `nextErr` property is MUTATED by the express
 * done callback (it fires on a deferred turn, after invokeRouter returns) —
 * tests must read result.nextErr after settling, not destructure it early.
 */
function invokeRouter(router, { query = '', path = '' } = {}) {
  const req = {}; // plain object (not an EventEmitter — express error path)
  req.method = 'GET';
  req.url = `/${path}${query ? `?${query}` : ''}`;
  req.headers = {};
  req.query = Object.fromEntries(new URLSearchParams(query));
  req.params = {};
  if (path) {
    // '/:developerName/yaml' — the yaml route reads req.params.developerName
    // from the matched segment (the express 5 router fills it during handle).
    req.params.developerName = decodeURIComponent(path.split('/')[0]);
  }
  req.user = { id: USER };
  const res = mockRes();
  const result = { req, res, nextErr: null };
  router.handle(req, res, (err) => { result.nextErr = err; });
  return result;
}

function makeRouter(overrides = {}) {
  const router = createAgentsRouter({
    authMiddleware: overrides.auth || stubAuth,
    getCredentials: overrides.getCredentials || stubCredentials,
    listAgents: overrides.listAgents,
    retrieveAgent: overrides.retrieveAgent,
    forgeDbFactory: () => overrides.forgeDb || makeFakeForgeDb(),
    credsDbFactory: () => overrides.credsDb || { __credsDb: true, from: () => { throw new Error('credsDb must not be used for the cache'); } },
  });
  return router;
}

const settle = () => new Promise((r) => setTimeout(r, 10));

// Polls until `check()` is truthy or the deadline passes. The express 5 router
// delivers next(err) on a deferred turn (not a plain microtask), so a fixed
// sleep is racy — poll deterministically instead.
async function waitFor(check, { timeoutMs = 1000, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return true;
}

// ── tests ────────────────────────────────────────────────────────────────────

test('401 without a valid session', () => {
  const { res } = invokeRouter(makeRouter({ auth: (req, res) => res.status(401).json({ error: 'Unauthorized' }) }), {
    query: `orgId=${ORG}`,
  });
  assert.equal(res.statusCode, 401);
});

test('400 on missing orgId', () => {
  const { res } = invokeRouter(makeRouter(), { query: '' });
  assert.equal(res.statusCode, 400);
});

test('credentials resolve via the DEFAULT-schema credsDb, cache via the forge-schema forgeDb (Pass 42 wiring)', async () => {
  // Pins the post-review fix: org_connections lives in the shared public store
  // (what the OAuth flow writes) — getCredentials must receive credsDb, and the
  // forge.agents cache must go through the forge-schema client.
  const credsDb = { __credsDb: true, from: () => { throw new Error('credsDb must not be used for the cache'); } };
  const forgeDb = makeFakeForgeDb({ rows: [] });
  let credsDbSeen = null;
  const router = createAgentsRouter({
    authMiddleware: stubAuth,
    getCredentials: async (db) => { credsDbSeen = db; return stubCredentials(); },
    listAgents: async () => LIVE_AGENTS,
    forgeDbFactory: () => forgeDb,
    credsDbFactory: () => credsDb,
  });
  const { res } = invokeRouter(router, { query: `orgId=${ORG}` });
  await settle();
  assert.equal(credsDbSeen, credsDb, 'credentials resolve via the default-schema credsDb');
  assert.equal(res.body.cached, false);
  assert.equal(forgeDb.__written.length, 2, 'the forge-schema client serves the agents cache');
});

test('cache hit: fresh cached rows short-circuit the live Salesforce call', async () => {
  let liveCalls = 0;
  const router = makeRouter({
    listAgents: async () => { liveCalls += 1; return LIVE_AGENTS; },
    forgeDb: makeFakeForgeDb({ rows: CACHE_ROWS }),
  });
  const { res } = invokeRouter(router, { query: `orgId=${ORG}` });
  await settle();
  assert.equal(liveCalls, 0, 'cache hit must not call Salesforce');
  assert.equal(res.body.cached, true);
  assert.equal(res.body.agents.length, 1);
  assert.equal(res.body.agents[0].developerName, 'Order_Agent');
  assert.equal(res.body.agents[0].name, 'Order Agent');
});

test('cache miss: live fetch + write-through, uncached response', async () => {
  let liveCalls = 0;
  const forgeDb = makeFakeForgeDb({ rows: [] });
  const router = makeRouter({
    listAgents: async (token, instanceUrl) => {
      liveCalls += 1;
      assert.equal(token, '00D-token');
      assert.equal(instanceUrl, 'https://acme.my.salesforce.com');
      return LIVE_AGENTS;
    },
    forgeDb,
  });
  const { res } = invokeRouter(router, { query: `orgId=${ORG}`, forgeDb });
  await settle();
  assert.equal(liveCalls, 1);
  assert.equal(res.body.cached, false);
  assert.equal(res.body.agents.length, 2);
  assert.equal(forgeDb.__written.length, 2, 'live results must be written through');
  assert.equal(forgeDb.__written[0].user_id, USER);
  assert.equal(forgeDb.__written[0].org_id, ORG);
  assert.equal(forgeDb.__written[0].developer_name, 'Order_Agent');
});

test('?refresh=1 bypasses a fresh cache', async () => {
  let liveCalls = 0;
  const router = makeRouter({
    listAgents: async () => { liveCalls += 1; return LIVE_AGENTS; },
    forgeDb: makeFakeForgeDb({ rows: CACHE_ROWS }),
  });
  const { res } = invokeRouter(router, { query: `orgId=${ORG}&refresh=1` });
  await settle();
  assert.equal(liveCalls, 1, 'refresh=1 must force a live call');
  assert.equal(res.body.cached, false);
  assert.equal(res.body.agents.length, 2);
});

test('missing table (migration 008 pending): degrades to a live call, no error', async () => {
  let liveCalls = 0;
  const forgeDb = makeFakeForgeDb({
    rows: [],
    readError: "Could not find the table 'forge.agents' in schema cache",
    writeError: "Could not find the table 'forge.agents' in schema cache",
  });
  const router = makeRouter({
    listAgents: async () => { liveCalls += 1; return LIVE_AGENTS; },
    forgeDb,
  });
  const result = invokeRouter(router, { query: `orgId=${ORG}` });
  await settle();
  assert.equal(result.nextErr, null, 'missing table must not throw');
  assert.equal(liveCalls, 1);
  assert.equal(result.res.body.cached, false);
});

test('real cache read error fails loudly (no silent swallow)', async () => {
  const router = makeRouter({
    forgeDb: makeFakeForgeDb({ rows: [], readError: 'connection refused' }),
  });
  const result = invokeRouter(router, { query: `orgId=${ORG}` });
  await waitFor(() => result.nextErr !== null);
  assert.ok(result.nextErr, 'a real read error must propagate to the error handler');
  assert.match(result.nextErr.message, /Agents cache read failed/);
});

test('real cache write error fails loudly after a live fetch', async () => {
  const router = makeRouter({
    listAgents: async () => LIVE_AGENTS,
    forgeDb: makeFakeForgeDb({ rows: [], writeError: 'connection refused' }),
  });
  const result = invokeRouter(router, { query: `orgId=${ORG}` });
  await waitFor(() => result.nextErr !== null);
  assert.ok(result.nextErr, 'a real write error must propagate to the error handler');
  assert.match(result.nextErr.message, /connection refused/);
});

test('org connection missing → 404', async () => {
  const router = makeRouter({
    getCredentials: async () => { const err = new Error('not found'); err.status = 404; throw err; },
  });
  const { res } = invokeRouter(router, { query: `orgId=${ORG}` });
  await settle();
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Org connection not found');
});

test('credential refresh failure → 401 reconnect message', async () => {
  const router = makeRouter({
    getCredentials: async () => { const err = new Error('refresh failed'); err.status = 401; throw err; },
  });
  const { res } = invokeRouter(router, { query: `orgId=${ORG}` });
  await settle();
  assert.equal(res.statusCode, 401);
  assert.ok(res.body.error.includes('Reconnect this org'));
});

test('unsafe instance URL → 400 (SSRF guard)', async () => {
  const router = makeRouter({
    getCredentials: async () => ({ accessToken: 't', instanceUrl: 'http://evil.example.com' }),
  });
  const { res } = invokeRouter(router, { query: `orgId=${ORG}` });
  await settle();
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.error.includes('unsafe instance URL'));
});

test('live path normalizes Agentforge field names (id/fullName fallbacks)', async () => {
  const router = makeRouter({
    listAgents: async () => [{ fullName: 'Legacy_Agent' }],
    forgeDb: makeFakeForgeDb({ rows: [] }),
  });
  const { res } = invokeRouter(router, { query: `orgId=${ORG}` });
  await settle();
  assert.equal(res.body.agents[0].developerName, 'Legacy_Agent');
  assert.equal(res.body.agents[0].masterLabel, 'Legacy_Agent');
});

// ── GET /:developerName/yaml (PRD FR-5 YAML drawer) ─────────────────────────

test('yaml: 401 without a valid session', () => {
  const { res } = invokeRouter(
    makeRouter({ auth: (req, res) => res.status(401).json({ error: 'Unauthorized' }) }),
    { path: 'Order_Agent/yaml', query: `orgId=${ORG}` }
  );
  assert.equal(res.statusCode, 401);
});

test('yaml: 400 on missing orgId', async () => {
  const { res } = invokeRouter(makeRouter(), { path: 'Order_Agent/yaml', query: '' });
  await settle();
  assert.equal(res.statusCode, 400);
});

test('yaml: 400 on an over-long developerName (zod max)', async () => {
  const { res } = invokeRouter(makeRouter(), { path: `${'x'.repeat(201)}/yaml`, query: `orgId=${ORG}` });
  await settle();
  assert.equal(res.statusCode, 400);
});

test('yaml: 200 returns the retrieved .agent YAML with creds resolution', async () => {
  const yaml = 'name: Order_Agent\nlabel: Order Agent\ntopics:\n  - name: Order_Flow\n';
  let captured = null;
  const router = makeRouter({
    retrieveAgent: async (devName, token, instanceUrl) => {
      captured = { devName, token, instanceUrl };
      return { yaml };
    },
  });
  const { res } = invokeRouter(router, { path: 'Order_Agent/yaml', query: `orgId=${ORG}` });
  await settle();
  // res.json sets body directly (mock convention — no explicit .status(200)).
  assert.equal(res.body.developerName, 'Order_Agent');
  assert.equal(res.body.yaml, yaml);
  // Tenant-scoped creds passed through to the engine (SSRF-validated url).
  assert.equal(captured.devName, 'Order_Agent');
  assert.equal(captured.token, '00D-token');
  assert.equal(captured.instanceUrl, 'https://acme.my.salesforce.com');
});

test('yaml: 404 when the bundle is not retrievable (null / empty)', async () => {
  const router = makeRouter({ retrieveAgent: async () => null });
  const { res } = invokeRouter(router, { path: 'Gone_Agent/yaml', query: `orgId=${ORG}` });
  await settle();
  assert.equal(res.statusCode, 404);
  assert.ok(res.body.error.includes('not found'));
});

test('yaml: 404 when the org connection is missing (getCredentials 404)', async () => {
  const notFound = Object.assign(new Error('no org'), { status: 404 });
  const router = makeRouter({ getCredentials: async () => { throw notFound; } });
  const { res } = invokeRouter(router, { path: 'Order_Agent/yaml', query: `orgId=${ORG}` });
  await settle();
  assert.equal(res.statusCode, 404);
  assert.ok(res.body.error.includes('Org connection not found'));
});
