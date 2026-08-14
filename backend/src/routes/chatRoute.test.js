import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createChatRouteRouter } from './chatRoute.js';

function makeApp({ route, db }) {
  const app = express();
  app.use(express.json());
  const stubAuth = (req, res, next) => { req.user = { id: 'auth-users-1' }; next(); };
  const router = createChatRouteRouter({
    authMiddleware: stubAuth,
    route: route || (async (m, o) => ({ capability: 'agent', confidence: 0.9, reason: 'stub', overrideSource: 'model' })),
    db: db || { from: () => ({ insert: async () => ({ error: null }) }) },
  });
  app.use('/api/v1/chat/route', router);
  return app;
}

function listen(app) {
  const server = app.listen(0);
  return { server, port: server.address().port };
}

test('POST /chat/route returns a routing decision', async () => {
  const app = makeApp({});
  const { server, port } = listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/chat/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'list my agents' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.capability, 'agent');
    assert.equal(body.overrideSource, 'model');
  } finally {
    server.close();
  }
});

test('honors pinned capability from the UI chip', async () => {
  // Use the REAL routeIntent so the pinned bypass path is exercised.
  const { routeIntent } = await import('@orgforge/ai');
  let classifierCalled = false;
  const app = makeApp({
    route: async (message, opts) => routeIntent(message, {
      ...opts,
      classifier: async () => { classifierCalled = true; return { capability: 'agent', confidence: 1, reason: '' }; },
    }),
  });
  const { server, port } = listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/chat/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'list my agents', pinned: 'org_change' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).overrideSource, 'user_chip');
    assert.equal(classifierCalled, false, 'pinned bypasses the classifier');
  } finally {
    server.close();
  }
});

test('rejects empty message with 400', async () => {
  const app = makeApp({});
  const { server, port } = listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/chat/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('routing_log write failure is swallowed (S-2 not applied yet)', async () => {
  const app = makeApp({
    db: { from: () => ({ insert: async () => { throw new Error('relation "routing_log" does not exist'); } }) },
  });
  const { server, port } = listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/chat/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'build an agent' }),
    });
    assert.equal(res.status, 200, 'route must answer even when logging fails');
  } finally {
    server.close();
  }
});
