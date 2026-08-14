import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { linkLegacyAgentforgeOrgs } from './reLink.js';

const LEGACY_SECRET = 'legacy-agentforge-jwt-secret';
const KEY = 'a'.repeat(64);

beforeEach(() => {
  // Deterministic env: the last test depends on LEGACY_JWT_SECRET being unset.
  delete process.env.LEGACY_JWT_SECRET;
  process.env.ENCRYPTION_KEY = KEY;
});

function makeLegacyJwt(agentforgeUserId = '00000000-0000-4000-8000-000000000001', orgId = '00D000000000001') {
  return jwt.sign({ agentforgeUserId, orgId }, LEGACY_SECRET, { expiresIn: '7d' });
}

function makeFakeSupabase(legacyRows) {
  const rpcCalls = [];
  const upserts = [];

  return {
    // reLink reads the legacy tables via an explicit `.schema('public')`
    // (Pass 51 strict-orgforge-isolation) — mirror that here.
    schema: (name) => ({
      rpc: async (fn, params) => {
        rpcCalls.push({ schema: name, fn, params });
        if (fn === 'get_connections_by_agentforge_user') return { data: legacyRows, error: null };
        return { data: null, error: null };
      },
    }),
    from: () => ({
      upsert: async (row, opts) => {
        upserts.push({ row, opts });
        return { error: null };
      },
    }),
    __rpcCalls: rpcCalls,
    __upserts: upserts,
  };
}

test('re-parents legacy org metadata onto the Supabase user (happy path)', async () => {
  const supabase = makeFakeSupabase([
    { org_id: '00D000000000001', org_type: 'production', instance_url: 'https://a.my.salesforce.com', alias: 'Prod' },
    { org_id: '00D000000000002', org_type: 'sandbox', instance_url: 'https://b.my.salesforce.com' },
  ]);

  const result = await linkLegacyAgentforgeOrgs({
    supabase,
    legacyJwt: makeLegacyJwt(),
    userId: 'auth-users-999',
    secret: LEGACY_SECRET,
  });

  assert.equal(result.linked, 2);
  assert.equal(result.agentforgeUserId, '00000000-0000-4000-8000-000000000001');

  assert.equal(supabase.__upserts.length, 2);
  for (const { row } of supabase.__upserts) {
    assert.equal(row.user_id, 'auth-users-999', 'every row must be re-parented to the Supabase user');
    assert.equal(row.legacy_agentforge_user_id, '00000000-0000-4000-8000-000000000001', 'audit column records the legacy id');
    assert.deepEqual(row.capabilities, ['agents', 'org_change'], 'unified rows default to both capabilities');
    // D4: credentials are never migrated — org is marked for one-time reconnect.
    assert.match(row.encrypted_tokens, /:/, 'stored tokens must be a valid encrypted blob (empty creds)');
    assert.ok(row.disconnected_at, 'EC-10: org must be flagged disconnected so the UI shows Reconnect');
  }

  // Cleanup RPC per row, best-effort.
  const cleanupCalls = supabase.__rpcCalls.filter((c) => c.fn === 'delete_salesforce_connection_by_user');
  assert.equal(cleanupCalls.length, 2);
});

test('idempotent: legacy rows already moved are simply not re-created', async () => {
  const supabase = makeFakeSupabase([]); // second run: no legacy rows remain

  const result = await linkLegacyAgentforgeOrgs({
    supabase,
    legacyJwt: makeLegacyJwt(),
    userId: 'auth-users-999',
    secret: LEGACY_SECRET,
  });

  assert.equal(result.linked, 0);
  assert.equal(supabase.__upserts.length, 0);
});

test('db error on legacy lookup is not a hard failure (EC-38)', async () => {
  const supabase = {
    schema: () => ({
      rpc: async () => ({ data: null, error: { message: 'RPC not found' } }),
    }),
    from: () => ({ upsert: async () => ({ error: null }) }),
  };

  const result = await linkLegacyAgentforgeOrgs({
    supabase,
    legacyJwt: makeLegacyJwt(),
    userId: 'u',
    secret: LEGACY_SECRET,
  });

  assert.equal(result.linked, 0);
  assert.equal(result.reason, 'legacy lookup failed');
});

test('expired/foreign legacy token is silently discarded (EC-02: never a hard error)', async () => {
  const expired = jwt.sign({ agentforgeUserId: 'x' }, LEGACY_SECRET, { expiresIn: '-1h' });
  const supabase = makeFakeSupabase([{ org_id: '00D', encrypted_tokens: 'x' }]);

  const result = await linkLegacyAgentforgeOrgs({ supabase, legacyJwt: expired, userId: 'u', secret: LEGACY_SECRET });

  assert.equal(result.linked, 0);
  assert.equal(result.reason, 'legacy JWT invalid: TokenExpiredError');
  assert.equal(supabase.__upserts.length, 0, 'must not write rows from an unverified token');
});

test('no legacy secret configured => skip, no crash', async () => {
  const supabase = makeFakeSupabase([{ org_id: '00D', encrypted_tokens: 'x' }]);
  const result = await linkLegacyAgentforgeOrgs({ supabase, legacyJwt: makeLegacyJwt(), userId: 'u' });
  assert.equal(result.linked, 0);
  assert.ok(result.reason.includes('not configured'));
});
