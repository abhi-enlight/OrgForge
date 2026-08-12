import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getOrgCredentials, _clearRefreshDedup } from './orgCredentials.js';
import { encrypt } from './cryptoUtils.js';

const KEY = 'a'.repeat(64);
const USER_ID = 'auth-users-123';
const ORG_ID = '00D000000000001';

/** Builds a fake supabase client returning a single org_connections row. */
function makeFakeDb({ expiresAt, onUpdate } = {}) {
  const row = {
    instance_url: 'https://acme.my.salesforce.com',
    org_type: 'production',
    encrypted_tokens: encrypt(
      JSON.stringify({
        accessToken: 'old-access-token',
        refreshToken: 'refresh-abc',
        expiresAt: expiresAt ?? 0, // 0 => always refresh
      }),
      KEY
    ),
  };

  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: row, error: null }),
          }),
        }),
      }),
      update: (fields) => ({
        eq: () => ({
          eq: () => {
            if (onUpdate) onUpdate(fields);
            return { data: null, error: null };
          },
        }),
      }),
    }),
  };
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY;
  process.env.SALESFORCE_CLIENT_ID = 'cid';
  process.env.SALESFORCE_CLIENT_SECRET = 'csec';
  process.env.SALESFORCE_REDIRECT_URI = 'http://localhost:3001/callback';
  _clearRefreshDedup();
});

test('returns stored credentials without refresh when token is fresh', async () => {
  const db = makeFakeDb({ expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
  let refreshes = 0;

  const creds = await getOrgCredentials(db, USER_ID, ORG_ID, {
    refresher: async () => { refreshes += 1; throw new Error('must not be called'); },
  });

  assert.equal(refreshes, 0, 'fresh token must not trigger refresh');
  assert.equal(creds.accessToken, 'old-access-token');
  assert.equal(creds.instanceUrl, 'https://acme.my.salesforce.com');
});

test('refreshes an expiring token and persists the new ciphertext', async () => {
  let updated = null;
  const db = makeFakeDb({ expiresAt: Date.now() + 60 * 1000, onUpdate: (f) => { updated = f; } });

  const creds = await getOrgCredentials(db, USER_ID, ORG_ID, {
    refresher: async () => ({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: Date.now() + 7200 * 1000,
    }),
  });

  assert.equal(creds.accessToken, 'new-access-token');
  assert.ok(updated, 'must persist re-encrypted tokens');
  assert.match(updated.encrypted_tokens, /:/, 'stored value must be encrypted');
});

test('BUG-3 port: concurrent refreshes for the same org share ONE refresh call', async () => {
  let refreshCalls = 0;
  const db = makeFakeDb({ expiresAt: 0 });

  const refresher = async () => {
    refreshCalls += 1;
    await new Promise((r) => setTimeout(r, 20)); // simulate slow network
    return { accessToken: 'token-' + refreshCalls, refreshToken: 'r', expiresAt: Date.now() + 7200 * 1000 };
  };

  // Two "requests" arrive at the same time for the same (user, org).
  const [a, b] = await Promise.all([
    getOrgCredentials(db, USER_ID, ORG_ID, { refresher }),
    getOrgCredentials(db, USER_ID, ORG_ID, { refresher }),
  ]);

  assert.equal(refreshCalls, 1, 'exactly one refresh must hit Salesforce');
  assert.equal(a.accessToken, b.accessToken, 'both callers must get the same refreshed token');
});

test('refresh failure surfaces 401 and calls onRefreshFailure', async () => {
  const db = makeFakeDb({ expiresAt: 0 });
  let hookCalled = false;

  await assert.rejects(
    getOrgCredentials(db, USER_ID, ORG_ID, {
      refresher: async () => { throw Object.assign(new Error('invalid_grant'), { status: 401 }); },
      onRefreshFailure: async () => { hookCalled = true; },
    }),
    (err) => err.status === 401 && /could not be refreshed/.test(err.message)
  );

  assert.equal(hookCalled, true, 'EC-10 hook must fire so the org can be marked disconnected');
});

test('missing orgId is a 400', async () => {
  const db = makeFakeDb({ expiresAt: 0 });
  await assert.rejects(getOrgCredentials(db, USER_ID, '', {}), (err) => err.status === 400);
});

test('missing connection row is a 404', async () => {
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'PGRST116' } }) }) }) }),
    }),
  };
  await assert.rejects(getOrgCredentials(db, USER_ID, '00D000000000999', {}), (err) => err.status === 404);
});
