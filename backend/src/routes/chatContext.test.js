import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createChatContextRouter } from './chatContext.js';

const ORG = '00D000000000001';

const stubAuth = (req, res, next) => { req.user = { id: 'auth-users-1' }; next(); };
const denyAuth = (req, res) => res.status(401).json({ error: 'Unauthorized' });

/**
 * In-memory chat_sessions client: records deletes and serves the select chains
 * used by the History routes (.eq().eq().order().limit() for the list,
 * .eq().eq().eq().maybeSingle() for restore) plus the delete chain.
 */
function fakeDb({ sessions = [] } = {}) {
  const deletes = [];
  const rows = [...sessions];
  return {
    deletes,
    rows,
    from: () => ({
      delete: () => ({ eq: () => ({ eq: () => ({ eq: async () => { deletes.push('chat_sessions'); return { error: null }; } }) }) }),
      select: () => {
        const eqs = {};
        const builder = {
          eq: (col, val) => { eqs[col] = val; return builder; },
          order: (col, { ascending } = {}) => ({
            limit: async (n) => {
              const matches = rows.filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v));
              matches.sort((a, b) =>
                ascending ? new Date(a[col]) - new Date(b[col]) : new Date(b[col]) - new Date(a[col])
              );
              return { data: matches.slice(0, n), error: null };
            },
          }),
          maybeSingle: async () => {
            const found = rows.find((r) => Object.entries(eqs).every(([k, v]) => r[k] === v));
            return found ? { data: found, error: null } : { data: null, error: null };
          },
        };
        return builder;
      },
    }),
  };
}

function makeApp({ agent, authMiddleware = stubAuth, db = fakeDb() } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/chat', createChatContextRouter({ authMiddleware, agent, db }));
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

/** Same ephemeral-listener pattern for the History GET routes. */
async function get(app, path) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
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

// ── durable-memory wipe (context-memory pass) ───────────────────────────────

test('DELETE also wipes the durable chat_sessions spine row (transcript + summary)', async () => {
  const db = fakeDb();
  const app = makeApp({ agent: { resetConversation: async () => {} }, db });
  const { status, body } = await del(app, `/api/v1/chat/sess-123?orgId=${ORG}`);
  assert.equal(status, 200);
  assert.deepEqual(body, { success: true });
  assert.deepEqual(db.deletes, ['chat_sessions'], 'spine row deleted');
});

test('DELETE spine failure is best-effort — the reset still succeeds', async () => {
  const db = {
    from: () => ({
      delete: () => ({ eq: () => ({ eq: () => ({ eq: async () => { throw new Error('db boom'); } }) }) }),
    }),
  };
  const app = makeApp({ agent: { resetConversation: async () => {} }, db });
  const { status, body } = await del(app, `/api/v1/chat/sess-123?orgId=${ORG}`);
  assert.equal(status, 200);
  assert.deepEqual(body, { success: true });
});

test('engine failure → 500 sanitized (never leaks internals)', async () => {
  const app = makeApp({ agent: { resetConversation: async () => { throw new Error('redis exploded'); } } });
  const { status, body } = await del(app, `/api/v1/chat/sess-123?orgId=${ORG}`);
  assert.equal(status, 500);
  assert.equal(body.error, 'Internal server error');
  assert.ok(!JSON.stringify(body).includes('redis exploded'), 'no internal detail leaked');
});

// ── History picker (resume from closed tabs) ────────────────────────────────

test('GET /sessions?orgId= lists this user+org sessions, newest first, with labels', async () => {
  const db = fakeDb({
    sessions: [
      {
        session_id: 's1', user_id: 'auth-users-1', org_id: ORG,
        updated_at: '2026-08-13T10:00:00Z',
        capability_segments: [{ capability: 'org_change', summary: 'Added validation rule Inv_Amount.' }],
        context_summary: null,
      },
      {
        session_id: 's2', user_id: 'auth-users-1', org_id: ORG,
        updated_at: '2026-08-13T09:00:00Z',
        capability_segments: [],
        context_summary: 'Built agent X',
      },
      { session_id: 'other-user', user_id: 'someone-else', org_id: ORG, updated_at: '2026-08-14T00:00:00Z', capability_segments: [], context_summary: null },
      { session_id: 'other-org', user_id: 'auth-users-1', org_id: '00D000000000099', updated_at: '2026-08-14T00:00:00Z', capability_segments: [], context_summary: null },
    ],
  });
  const app = makeApp({ agent: { resetConversation: async () => {} }, db });
  const res = await get(app, `/api/v1/chat/sessions?orgId=${ORG}`);
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.sessions.map((s) => s.sessionId),
    ['s1', 's2'],
    'scoped to user+org, newest first'
  );
  assert.equal(res.body.sessions[0].lastSummary, 'Added validation rule Inv_Amount.');
  assert.equal(res.body.sessions[1].hasSummary, true);
});

test('GET /sessions — 401 without a session (no list leaks); missing table → empty list', async () => {
  const denied = await get(makeApp({ authMiddleware: denyAuth, db: fakeDb() }), `/api/v1/chat/sessions?orgId=${ORG}`);
  assert.equal(denied.status, 401);

  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "Could not find the table 'forge.chat_sessions' in schema cache" } }) }) }) }) }),
    }),
  };
  const missing = await get(makeApp({ agent: { resetConversation: async () => {} }, db }), `/api/v1/chat/sessions?orgId=${ORG}`);
  assert.equal(missing.status, 200, 'missing table degrades to an empty list');
  assert.deepEqual(missing.body.sessions, []);
});

test('GET /sessions/:sessionId?orgId= returns the spine for resume (triple-scoped)', async () => {
  const db = fakeDb({
    sessions: [
      {
        session_id: 's1', user_id: 'auth-users-1', org_id: ORG,
        updated_at: '2026-08-13T10:00:00Z',
        capability_segments: [{ capability: 'agent', engineRef: 'agentforce', summary: 'Built agent X' }],
        // Legacy string-encoded transcript — the route must parse it.
        transcript: JSON.stringify([
          { role: 'user', text: 'build an agent' },
          { role: 'model', text: 'done' },
        ]),
        context_summary: 'Flash summary',
      },
    ],
  });
  const app = makeApp({ agent: { resetConversation: async () => {} }, db });
  const res = await get(app, `/api/v1/chat/sessions/s1?orgId=${ORG}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.session.sessionId, 's1');
  assert.deepEqual(
    res.body.session.transcript,
    [{ role: 'user', text: 'build an agent' }, { role: 'model', text: 'done' }],
    'legacy transcript parsed'
  );
  assert.equal(res.body.session.contextSummary, 'Flash summary');
  assert.equal(res.body.session.segments.length, 1);
});

test('GET /sessions/:sessionId — unknown or another user\'s session → 404 (tenant scope)', async () => {
  const db = fakeDb({
    sessions: [{ session_id: 's1', user_id: 'someone-else', org_id: ORG }],
  });
  const app = makeApp({ agent: { resetConversation: async () => {} }, db });
  const res = await get(app, `/api/v1/chat/sessions/s1?orgId=${ORG}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Session not found');
});

test('GET /sessions/:sessionId — bad params → 400 (zod)', async () => {
  const app = makeApp({ agent: { resetConversation: async () => {} }, db: fakeDb() });
  const noOrg = await get(app, '/api/v1/chat/sessions/s1');
  assert.equal(noOrg.status, 400, 'orgId required');
  const tooLong = await get(app, `/api/v1/chat/sessions/${'x'.repeat(201)}?orgId=${ORG}`);
  assert.equal(tooLong.status, 400, 'sessionId over 200 chars rejected');
});
