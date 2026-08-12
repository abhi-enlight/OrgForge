import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tenantIsolation } from './tenantIsolation.js';

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('sets req.tenantId from the verified user and builds a supabase client', () => {
  const req = { user: { id: 'auth-users-123', email: 'a@b.com' } };
  const res = makeRes();
  let nextCalled = false;

  tenantIsolation(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.tenantId, 'auth-users-123');
  assert.ok(req.supabaseClient, 'should build an RLS-scoped client');
  assert.equal(typeof req.supabaseClient.from, 'function');
});

test('rejects when requireAuth did not run first (missing user context)', () => {
  const req = { headers: {} };
  const res = makeRes();

  tenantIsolation(req, res, () => { assert.fail('next must not be called'); });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Tenant isolation failed: missing user context' });
});
