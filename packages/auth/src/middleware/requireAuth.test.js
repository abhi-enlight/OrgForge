import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createAuthMiddleware } from './requireAuth.js';

/** Minimal express-like mock that captures the response. */
function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

/** Creates a legacy Agentforge-style JWT (signed with JWT_SECRET, custom payload). */
function makeLegacyAgentforgeJwt() {
  const legacySecret = 'legacy-agentforge-jwt-secret';
  return jwt.sign(
    { agentforgeUserId: '00000000-0000-4000-8000-000000000001', orgId: '00D000000000001' },
    legacySecret,
    { expiresIn: '7d' }
  );
}

test('accepts a valid Supabase JWT and attaches req.user', async () => {
  const requireAuth = createAuthMiddleware({
    verifyUser: async (token) => {
      assert.ok(token, 'verifier must receive the token');
      return { id: 'auth-users-123', email: 'admin@example.com' };
    },
  });

  const req = { method: 'POST', headers: { authorization: 'Bearer supabase.jwt.token' }, query: {} };
  const res = makeRes();
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, null, 'should not have responded');
  assert.equal(nextCalled, true, 'should call next()');
  assert.deepEqual(req.user, { id: 'auth-users-123', email: 'admin@example.com' });
  assert.equal(req.accessToken, 'supabase.jwt.token');
});

test('rejects a legacy Agentforge JWT (custom-signature token is not a Supabase JWT)', async () => {
  // Simulates GoTrue's getUser() behavior for a token signed with a foreign
  // secret (i.e. Agentforge's JWT_SECRET): verification fails.
  const requireAuth = createAuthMiddleware({
    verifyUser: async () => {
      throw Object.assign(new Error('Invalid JWT: signature verification failed'), { status: 401 });
    },
  });

  const req = { method: 'POST', headers: { authorization: `Bearer ${makeLegacyAgentforgeJwt()}` }, query: {} };
  const res = makeRes();
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false, 'must NOT call next() for legacy tokens');
});

test('rejects missing token with 401', async () => {
  const requireAuth = createAuthMiddleware({ verifyUser: async () => { throw new Error('should not be called'); } });
  const req = { method: 'POST', headers: {}, query: {} };
  const res = makeRes();

  await requireAuth(req, res, () => { assert.fail('next must not be called'); });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Missing authentication token' });
});

test('accepts query-string token on GET (EventSource/SSE path)', async () => {
  const requireAuth = createAuthMiddleware({
    verifyUser: async () => ({ id: 'sse-user', email: 'sse@example.com' }),
  });

  const req = { method: 'GET', headers: {}, query: { access_token: 'sse.token' } };
  const res = makeRes();
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.user.id, 'sse-user');
});

test('ignores query-string token on POST (token in URL only leaks via logs)', async () => {
  const requireAuth = createAuthMiddleware({ verifyUser: async () => { throw new Error('should not be called'); } });
  const req = { method: 'POST', headers: {}, query: { access_token: 'leaky.token' } };
  const res = makeRes();

  await requireAuth(req, res, () => { assert.fail('next must not be called'); });

  assert.equal(res.statusCode, 401);
});

test('rejects malformed/expired Supabase token surfaced by the verifier', async () => {
  const requireAuth = createAuthMiddleware({
    verifyUser: async () => { throw Object.assign(new Error('JWT expired'), { status: 401 }); },
  });

  const req = { method: 'POST', headers: { authorization: 'Bearer expired.token' }, query: {} };
  const res = makeRes();

  await requireAuth(req, res, () => { assert.fail('next must not be called'); });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Authentication failed' });
});
