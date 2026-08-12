import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { linkLegacyAgentforgeOrgs } from '@forge/org-connections';
import { createLinkLegacyRouter } from './routes/linkLegacy.js';
import express from 'express';

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-session-secret';
});

test('app boots with flags off: health 200 and JSON 404', async () => {
  const app = await createApp({ enableOrgForge: false, enableAgentforge: false });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.status, 'ok');

    const missing = await fetch(`http://127.0.0.1:${port}/api/v1/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Route not found' });
  } finally {
    server.close();
  }
});

test('link-legacy returns 401 without a Supabase JWT', async () => {
  const app = express();
  app.use(express.json());
  const router = createLinkLegacyRouter({
    linkFn: async () => { throw new Error('must not be called without auth'); },
  });
  app.use('/api/v1/auth/link-legacy', router);

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/link-legacy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legacyToken: 'x' }),
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('link-legacy validates body: missing legacyToken is a 400', async () => {
  const app = express();
  app.use(express.json());
  // Stub auth so the test reaches body validation (auth runs first by design).
  const stubAuth = (req, res, next) => { req.user = { id: 'auth-users-123' }; next(); };
  const router = createLinkLegacyRouter({
    linkFn: linkLegacyAgentforgeOrgs,
    authMiddleware: stubAuth,
  });
  app.use('/api/v1/auth/link-legacy', router);

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/link-legacy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('link-legacy happy path with auth: returns linked count', async () => {
  const app = express();
  app.use(express.json());
  const stubAuth = (req, res, next) => { req.user = { id: 'auth-users-123' }; next(); };
  let receivedLegacyToken = null;
  const router = createLinkLegacyRouter({
    // tenantIsolation (real middleware) builds req.supabaseClient — assert the
    // linkFn receives a client with .from and the verified userId/token.
    linkFn: async ({ supabase, legacyJwt, userId }) => {
      receivedLegacyToken = legacyJwt;
      assert.equal(userId, 'auth-users-123');
      assert.equal(typeof supabase.from, 'function');
      return { linked: 2, agentforgeUserId: 'legacy-1' };
    },
    authMiddleware: stubAuth,
  });
  app.use('/api/v1/auth/link-legacy', router);

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/link-legacy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legacyToken: 'legacy.jwt.here' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.linked, 2);
    assert.equal(receivedLegacyToken, 'legacy.jwt.here');
  } finally {
    server.close();
  }
});
