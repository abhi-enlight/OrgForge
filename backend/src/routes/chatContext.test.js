import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createChatContextRouter } from './chatContext.js';

const ORG = '00D000000000001';

const stubAuth = (req, res, next) => { req.user = { id: 'auth-users-1' }; next(); };
const denyAuth = (req, res) => res.status(401).json({ error: 'Unauthorized' });

function makeApp({ agent, authMiddleware = stubAuth } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/chat', createChatContextRouter({ authMiddleware, agent }));
  app.use((err, req, res, next) => {
    console.error('test error handler:', err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

/**
 * Runs one DELETE against an ephemeral listener and FULLY reads the response
 * body before closing it (diagnostics.test.js pattern) — closing the server
 * before the body is consumed is a latent flake.
 */
async function del(app, path) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test' },
    });
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

test('DELETE /:contextId?orgId= resets the composed session key and returns { success: true }', async () => {
  const resetCalls = [];
  const agent = { resetConversation: async (key) => resetCalls.push(key) };
  const app = makeApp({ agent });
  const { status, body } = await del(app, `/api/v1/chat/sess-123?orgId=${ORG}`);
  assert.equal(status, 200);
  assert.deepEqual(body, { success: true });
  assert.deepEqual(resetCalls, ['auth-users-1|00D000000000001|sess-123'], 'sessionKey = {userId}|{orgId}|{contextId}');
});

test('DELETE is idempotent — resetting an unknown conversation still succeeds', async () => {
  const app = makeApp({ agent: { resetConversation: async () => {} } });
  const { status, body } = await del(app, `/api/v1/chat/never-used-session?orgId=${ORG}`);
  assert.equal(status, 200);
  assert.deepEqual(body, { success: true });
});

test('DELETE without a valid Supabase session → 401 before any reset', async () => {
  let resetCalled = false;
  const app = makeApp({ authMiddleware: denyAuth, agent: { resetConversation: async () => { resetCalled = true; } } });
  const { status } = await del(app, `/api/v1/chat/sess-123?orgId=${ORG}`);
  assert.equal(status, 401);
  assert.equal(resetCalled, false, 'no reset without auth');
});

test('missing / malformed params → 400 (zod), nothing reset', async () => {
  let resetCalled = false;
  const agent = { resetConversation: async () => { resetCalled = true; } };
  const app = makeApp({ agent });

  const noOrg = await del(app, '/api/v1/chat/sess-123');
  assert.equal(noOrg.status, 400, 'orgId is required');
  assert.equal(resetCalled, false);

  const badOrg = await del(app, `/api/v1/chat/sess-123?orgId=${'x'.repeat(19)}`);
  assert.equal(badOrg.status, 400, 'orgId over 18 chars rejected');

  const tooLong = await del(app, `/api/v1/chat/${'x'.repeat(201)}?orgId=${ORG}`);
  assert.equal(tooLong.status, 400, 'contextId over 200 chars rejected');
});

test('reserved context ids (stream/route) → 400, never a reset', async () => {
  let resetCalled = false;
  const agent = { resetConversation: async () => { resetCalled = true; } };
  const app = makeApp({ agent });
  const { status } = await del(app, `/api/v1/chat/stream?orgId=${ORG}`);
  assert.equal(status, 400);
  assert.equal(resetCalled, false);
});

test('engine failure → 500 sanitized (never leaks internals)', async () => {
  const app = makeApp({ agent: { resetConversation: async () => { throw new Error('redis exploded'); } } });
  const { status, body } = await del(app, `/api/v1/chat/sess-123?orgId=${ORG}`);
  assert.equal(status, 500);
  assert.equal(body.error, 'Internal server error');
  assert.ok(!JSON.stringify(body).includes('redis exploded'), 'no internal detail leaked');
});
