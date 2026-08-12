import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRefusalLogsRouter } from './refusalLogs.js';

const USER = 'auth-users-1';
const ORG = '00D000000000001';

const REFUSALS = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    change_intent_id: '00000000-0000-0000-0000-0000000000aa',
    gate_code: 'REF-05',
    reason: '12 existing records violate this rule.',
    missing_evidence: 'Zero violating records.',
    unblock_path: 'Clean up data before deploying.',
    created_at: '2026-08-10T00:00:00Z',
    change_intents: { user_id: USER, org_id: ORG, prompt: 'Add a validation rule to Opportunity' },
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    change_intent_id: null,
    gate_code: 'REF-07',
    reason: 'Production deployment acknowledged by Jane',
    missing_evidence: null,
    unblock_path: 'operator-acknowledged',
    created_at: '2026-08-09T12:00:00Z',
    change_intents: null,
  },
];

// ── fakes ────────────────────────────────────────────────────────────────────

const stubAuth = (req, res, next) => { req.user = { id: USER }; next(); };

function makeFakeDb({ result }) {
  const calls = { table: null, selectCols: null, eqs: [], orders: 0 };
  const chain = {
    eq: (k, v) => {
      calls.eqs.push([k, v]);
      return chain;
    },
    order: () => {
      calls.orders += 1;
      return Promise.resolve(result);
    },
  };
  return {
    __calls: calls,
    from: (t) => {
      calls.table = t;
      return { select: (cols) => { calls.selectCols = cols; return chain; } };
    },
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

function invokeRouter(router, { query = '', user = { id: USER } } = {}) {
  const req = {};
  req.method = 'GET';
  req.url = `/${query ? `?${query}` : ''}`;
  req.headers = {};
  req.query = Object.fromEntries(new URLSearchParams(query));
  req.user = user;
  const res = mockRes();
  const result = { req, res, nextErr: null };
  router.handle(req, res, (err) => { result.nextErr = err; });
  return result;
}

function makeRouter(overrides = {}) {
  return createRefusalLogsRouter({
    authMiddleware: overrides.auth || stubAuth,
    dbFactory: () => overrides.db || makeFakeDb({ result: { data: REFUSALS, error: null } }),
  });
}

const settle = () => new Promise((r) => setTimeout(r, 10));

async function waitFor(check, { timeoutMs = 1000, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return true;
}

// ── tests ────────────────────────────────────────────────────────────────────

test('401 without a valid session', async () => {
  const { res } = invokeRouter(makeRouter({ auth: (req, res) => res.status(401).json({ error: 'Unauthorized' }) }));
  await settle();
  assert.equal(res.statusCode, 401);
});

test('401 when auth passes but no user id is present', async () => {
  const router = makeRouter({ auth: (req, res, next) => next() }); // never sets req.user
  const { res } = invokeRouter(router, { user: null });
  await settle();
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('400 on invalid orgId', async () => {
  const { res } = invokeRouter(makeRouter(), { query: 'orgId=x' });
  await settle();
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Validation failed');
  assert.ok(Array.isArray(res.body.issues));
});

test('200 — returns refusals mapped to camelCase with the intent embed', async () => {
  const { res } = invokeRouter(makeRouter());
  assert.equal(await waitFor(() => res.body !== undefined), true);
  assert.equal(res.body.refusals.length, 2);
  const [first, second] = res.body.refusals;
  assert.equal(first.gateCode, 'REF-05');
  assert.equal(first.reason, '12 existing records violate this rule.');
  assert.equal(first.missingEvidence, 'Zero violating records.');
  assert.equal(first.unblockPath, 'Clean up data before deploying.');
  assert.equal(first.orgId, ORG);
  assert.equal(first.intent, 'Add a validation rule to Opportunity');
  assert.equal(first.userId, undefined, 'user_id is stripped — never leaked');
  // REF-07 waiver row (no intent link) renders with nulls, not a crash
  assert.equal(second.gateCode, 'REF-07');
  assert.equal(second.orgId, null);
});

test('200 — tenant scoping queries change_intents.user_id and optional orgId', async () => {
  const db = makeFakeDb({ result: { data: REFUSALS, error: null } });
  const { res } = invokeRouter(makeRouter({ db }), { query: `orgId=${ORG}` });
  assert.equal(await waitFor(() => res.body !== undefined), true);
  assert.equal(db.__calls.table, 'refusal_logs');
  assert.equal(db.__calls.selectCols.includes('change_intents!inner'), true);
  assert.deepEqual(db.__calls.eqs, [
    ['change_intents.user_id', USER],
    ['change_intents.org_id', ORG],
  ]);
  assert.equal(db.__calls.orders, 1);
});

test('200 — empty result returns an empty list', async () => {
  const db = makeFakeDb({ result: { data: [], error: null } });
  const { res } = invokeRouter(makeRouter({ db }));
  assert.equal(await waitFor(() => res.body !== undefined), true);
  assert.deepEqual(res.body, { refusals: [] });
});

test('200 — missing refusal_logs table degrades to empty + note (S-3)', async () => {
  const db = makeFakeDb({
    result: { data: null, error: { message: "Could not find the table 'public.refusal_logs' in the schema cache" } },
  });
  const { res } = invokeRouter(makeRouter({ db }));
  assert.equal(await waitFor(() => res.body !== undefined), true);
  assert.deepEqual(res.body.refusals, []);
  assert.match(res.body.note, /003–005/i);
});

test('500 — any other DB error fails loudly with a sanitized message', async () => {
  const db = makeFakeDb({ result: { data: null, error: { message: 'connection refused' } } });
  const { res } = invokeRouter(makeRouter({ db }));
  assert.equal(await waitFor(() => res.body !== undefined), true);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'Failed to load refusal log');
  assert.equal(res.body.message, undefined, 'no internals leak');
});
