import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import express from 'express';
import { createChatStreamRouter } from './chatStream.js';

const ORG = '00D000000000001';

// ── fakes ────────────────────────────────────────────────────────────────────

function fakeEngines() {
  const calls = { agent: [], org: [] };
  const agent = {
    isBusy: () => false,
    async runAgent({ message, accessToken, instanceUrl, sessionKey, onEvent }) {
      calls.agent.push({ message, accessToken, instanceUrl, sessionKey });
      onEvent({ type: 'status', content: 'agent working' });
      return { role: 'assistant', content: 'Agent done.' };
    },
    abort: () => { calls.aborted = true; },
  };
  const org = {
    async runOrgChange({ message, onEvent }) {
      calls.org.push({ message });
      onEvent({ type: 'status', content: 'org working' });
      onEvent({ type: 'message', content: 'Org change queued.' });
      return { role: 'assistant', content: 'Org done.' };
    },
  };
  return { agent, org, calls };
}

const stubAuth = (req, res, next) => { req.user = { id: 'auth-users-1' }; next(); };

const denyAuth = (req, res) => res.status(401).json({ error: 'Unauthorized' });

const stubCredentials = async () => ({
  accessToken: '00D-token',
  refreshToken: 'rt',
  instanceUrl: 'https://acme.my.salesforce.com',
  orgType: 'production',
  expiresAt: Date.now() + 7200_000,
});

// Default chat_sessions chain: no row → the insert path succeeds silently.
function chatSessionsOk() {
  return {
    select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
    insert: async () => ({ error: null }),
    update: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }),
  };
}

// Default db: routing_log insert succeeds; chat_sessions succeeds.
const loggingDb = {
  from: (table) => (table === 'routing_log' ? { insert: async () => ({ error: null }) } : chatSessionsOk()),
};

// Default diagnostics gate verdict: a healthy org, so agent/both requests pass
// the agents-unavailable gate (gate tests override this with an attention
// verdict). Prevents every existing test from hitting the real cache/network.
const healthyDiagnostics = async () => ({
  state: 'ok',
  capability: { agents: 'ok', org_change: 'ok' },
});

// Attention verdict — agents blocked, org changes fine (the shape the
// preflight returns for settings/license/provisioning failures).
const attentionDiagnostics = async () => ({
  state: 'attention',
  capability: { agents: 'attention', org_change: 'ok' },
});

// Wraps a custom routing_log handler with the default chat_sessions chain.
function withRoutingLog(routingLogHandler) {
  return { from: (table) => (table === 'routing_log' ? routingLogHandler : chatSessionsOk()) };
}

// Stateful chat_sessions recorder: select returns the real stored row so
// multi-segment turns exercise the update path (read-modify-write). ai_logs
// inserts are recorded separately (fire-and-forget unified writer, plan §3).
function sessionRecorderDb() {
  const sessions = [];
  const updates = [];
  const aiLogs = [];
  let row = null;
  return {
    sessions,
    updates,
    aiLogs,
    from: (table) => {
      if (table === 'routing_log') return { insert: async () => ({ error: null }) };
      if (table === 'ai_logs') return { insert: async (r) => { aiLogs.push(r); return { error: null }; } };
      return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => {
          if (!row) return { data: null, error: null };
          return { data: { capability_segments: row.capability_segments, compressed_history: row.compressed_history }, error: null };
        } }) }) }) }),
        insert: async (r) => {
          row = { ...r, capability_segments: JSON.parse(r.capability_segments) };
          sessions.push(r);
          return { error: null };
        },
        update: (r) => ({ eq: () => ({ eq: () => ({ eq: async () => {
          updates.push(r);
          row = { ...row, ...r, capability_segments: JSON.parse(r.capability_segments) };
          return { error: null };
        } }) }) }),
      };
    },
  };
}

// Mock res that records SSE frames; headersSent flips once "flushed".
function mockRes() {
  const chunks = [];
  const res = {
    chunks,
    headersSent: false,
    writableEnded: false,
    setHeader() {},
    flushHeaders() { res.headersSent = true; },
    write(c) { chunks.push(c); return true; },
    end() { res.writableEnded = true; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  return res;
}

function frames(chunks) {
  return chunks.join('').split('\n\n').filter(Boolean).map((f) => {
    const m = f.match(/^data: (.*)$/s);
    if (!m) return f;
    return m[1] === '[DONE]' ? '[DONE]' : JSON.parse(m[1]);
  });
}

// Invokes the router directly with mock req/res (race-free, no HTTP).
function invokeRouter(router, { body, user = { id: 'auth-users-1' }, file } = {}) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/';
  req.headers = {};
  req.body = body;
  req.user = user;
  if (file) req.file = file;
  const res = mockRes();
  router.handle(req, res, () => {});
  return { req, res };
}

// Fake multer middleware: sets req.file from the invoke args, or forwards a
// simulated upload error (MulterError / allowlist rejection).
function uploadFrom(file) {
  return (req, res, next) => {
    if (file?.error) return next(file.error);
    if (file) req.file = file;
    next();
  };
}

// Fake attachment extractor: returns the literal file text (no real parsers).
function extractFrom(file) {
  return async (f) => ({ kind: file?.kind || 'text', text: file?.text ?? 'extracted document text' });
}

function makeRouter(overrides = {}) {
  const { agent, org, calls } = overrides.engines || fakeEngines();
  const router = createChatStreamRouter({
    authMiddleware: overrides.auth || stubAuth,
    route: overrides.route,
    agent: overrides.agent || agent,
    org: overrides.org || org,
    getCredentials: overrides.getCredentials || stubCredentials,
    db: overrides.db || loggingDb,
    emit: overrides.emit,
    uploadMiddleware: overrides.upload || ((req, res, next) => next()),
    extractFile: overrides.extractFile || (async () => ({ kind: 'text', text: '' })),
    buildPrompt: overrides.buildPrompt || ((userPrompt, f, text) => `${userPrompt} + [${f.originalname}: ${text}]`),
    // buildImageParts falls back to the real pure helper (inlineData shape);
    // describeImage is stubbed — the real one needs GOOGLE_AI_API_KEY.
    buildImageParts: overrides.buildImageParts,
    describeImage: overrides.describeImage || (async () => 'a vision description of the image'),
    // Healthy-by-default so existing tests never hit the real diagnostics
    // cache/network; gate tests override it.
    getDiagnostics: overrides.getDiagnostics || healthyDiagnostics,
    preFlight: overrides.preFlight,
  });
  return { router, calls };
}

// Real HTTP app for the wire-level test.
function makeApp(opts = {}) {
  const app = express();
  app.use(express.json());
  const router = createChatStreamRouter({
    authMiddleware: stubAuth,
    route: async (m, o) => ({ capability: 'agent', confidence: 0.9, reason: 'stub', overrideSource: 'model' }),
    agent: {
      isBusy: () => false,
      async runAgent({ onEvent }) { onEvent({ type: 'status', content: 'wire test' }); return { role: 'assistant', content: 'Wire done.' }; },
      abort() {},
    },
    org: { async runOrgChange({ onEvent }) { onEvent({ type: 'status', content: 'org' }); return {}; } },
    getCredentials: stubCredentials,
    db: loggingDb,
    getDiagnostics: healthyDiagnostics,
  });
  app.use('/api/v1/chat/stream', router);
  return app;
}

// ── tests ────────────────────────────────────────────────────────────────────

test('401 without a valid session', () => {
  const { router } = makeRouter({ auth: denyAuth });
  const { res } = invokeRouter(router, {
    body: { message: 'list my agents', orgId: ORG },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('400 on invalid body (missing orgId)', () => {
  const { router } = makeRouter({});
  const { res } = invokeRouter(router, { body: { message: 'hi' } });
  assert.equal(res.statusCode, 400);
});

test('400 on empty message', () => {
  const { router } = makeRouter({});
  const { res } = invokeRouter(router, { body: { message: '', orgId: ORG } });
  assert.equal(res.statusCode, 400);
});

test('client-supplied capability is authoritative (bypasses classifier)', async () => {
  let routeCalled = false;
  const { router } = makeRouter({
    route: async () => { routeCalled = true; return { capability: 'org_change', confidence: 1 }; },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'add a validation rule', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(routeCalled, false, 'routed capability must skip the classifier');
  assert.ok(frames(res.chunks).some((f) => f.type === 'message'), 'agent engine ran');
});

test('no capability → classifies and logs the decision to routing_log', async () => {
  let routeCalled = false;
  let logged = null;
  const { router } = makeRouter({
    route: async () => { routeCalled = true; return { capability: 'agent', confidence: 0.95, reason: 'r', overrideSource: 'model' }; },
    db: withRoutingLog({ insert: async (row) => { logged = row; return { error: null }; } }),
  });
  const { res } = invokeRouter(router, { body: { message: 'build an agent', orgId: ORG } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(routeCalled, true);
  assert.equal(logged.capability, 'agent');
  assert.equal(logged.override_source, 'model');
  assert.ok(logged.prompt_hash);
  assert.equal(res.statusCode, undefined, 'stream completes without error');
});

test('routing_log table missing (migration 008 pending) → stream proceeds, no 500', async () => {
  const { router } = makeRouter({
    route: async () => ({ capability: 'agent', confidence: 0.9, reason: 'r', overrideSource: 'model' }),
    db: withRoutingLog({ insert: async () => ({ error: { message: "Could not find the table 'forge.routing_log' in schema cache" } }) }),
  });
  const { res } = invokeRouter(router, { body: { message: 'build an agent', orgId: ORG } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, undefined, 'missing table must not fail the stream');
  const f = frames(res.chunks);
  assert.equal(f.at(-1), '[DONE]', 'stream completes normally');
  assert.ok(f.some((x) => x.type === 'message'), 'agent engine still ran');
});

test('routing_log write fails with a REAL db error → fail-loud (no silent swallow)', async () => {
  const { router } = makeRouter({
    route: async () => ({ capability: 'agent', confidence: 0.9, reason: 'r', overrideSource: 'model' }),
    db: withRoutingLog({ insert: async () => ({ error: { message: 'connection refused' } }) }),
  });
  const { res } = invokeRouter(router, { body: { message: 'build an agent', orgId: ORG } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 500, 'a real routing_log error must surface as 500');
  assert.ok(res.body.error, 'plain JSON error, not a stream');
});

test('routing_log write THROWS a real db error (non-supabase client) → fail-loud 500', async () => {
  const { router } = makeRouter({
    route: async () => ({ capability: 'agent', confidence: 0.9, reason: 'r', overrideSource: 'model' }),
    db: withRoutingLog({ insert: async () => { throw new Error('pool exhausted'); } }),
  });
  const { res } = invokeRouter(router, { body: { message: 'build an agent', orgId: ORG } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 500);
});

test('agent handoff: creds passed, events tagged with capability, [DONE]', async () => {
  const engines = fakeEngines();
  const { router } = makeRouter({ engines });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));

  const call = engines.calls.agent[0];
  assert.ok(call, 'agent engine invoked');
  assert.equal(call.accessToken, '00D-token');
  assert.equal(call.instanceUrl, 'https://acme.my.salesforce.com');
  assert.equal(call.sessionKey, `auth-users-1|${ORG}|default`, 'sessionKey is always tenant-scoped');

  const f = frames(res.chunks);
  assert.equal(f.at(-1), '[DONE]');
  const statusFrames = f.filter((x) => x.type === 'status');
  assert.ok(statusFrames.length >= 1);
  assert.equal(statusFrames[0].capability, 'agent');
  const msg = f.find((x) => x.type === 'message');
  assert.equal(msg.content, 'Agent done.');
  assert.equal(msg.capability, 'agent');
});

test('org_change handoff runs the org engine with org_change tagging', async () => {
  const engines = fakeEngines();
  const { router } = makeRouter({ engines });
  const { res } = invokeRouter(router, {
    body: { message: 'add a validation rule', orgId: ORG, capability: 'org_change' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(engines.calls.org.length, 1);
  assert.equal(engines.calls.agent.length, 0);
  const f = frames(res.chunks);
  assert.ok(f.find((x) => x.type === 'status')?.capability === 'org_change');
  assert.ok(f.find((x) => x.type === 'message'));
});

test('both: sequential — agent step then org step (EC-23)', async () => {
  const engines = fakeEngines();
  const { router } = makeRouter({ engines });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent and add a field', orgId: ORG, capability: 'both' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(engines.calls.agent.length, 1);
  assert.equal(engines.calls.org.length, 1);
  const f = frames(res.chunks);
  const seq = f.filter((x) => x.type === 'status').map((x) => x.content);
  assert.ok(seq.some((s) => s.includes('Agent step done')), 'interleaved status present');
  const agentStatus = f.findIndex((x) => x.type === 'status' && x.capability === 'agent');
  const orgStatus = f.findIndex((x) => x.type === 'status' && x.capability === 'org_change');
  assert.ok(agentStatus < orgStatus, 'agent step completes before org step');
});

test('both: the handoff status belongs to the org segment (per-segment cards, EC-23)', async () => {
  const engines = fakeEngines();
  const { router } = makeRouter({ engines });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent and add a field', orgId: ORG, capability: 'both' },
  });
  await new Promise((r) => setTimeout(r, 10));
  const f = frames(res.chunks);
  const handoff = f.find((x) => x.type === 'status' && x.content.includes('Agent step done'));
  assert.ok(handoff, 'handoff status present');
  assert.equal(handoff.capability, 'org_change', 'tagged so it opens the org segment card');

  // The frontend splits cards on the capability tag: all agent-tagged statuses
  // must precede every org_change-tagged one (no interleaving after the handoff).
  const tags = f.filter((x) => x.type === 'status').map((x) => x.capability);
  assert.ok(tags.includes('agent') && tags.includes('org_change'));
  assert.ok(tags.lastIndexOf('agent') < tags.indexOf('org_change'), 'agent segment fully precedes the org segment');
});

test('clarify: no engine invoked, clarification message, [DONE]', async () => {
  const engines = fakeEngines();
  const { router } = makeRouter({ engines });
  const { res } = invokeRouter(router, {
    body: { message: 'hmm what can you do', orgId: ORG, capability: 'clarify' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(engines.calls.agent.length, 0);
  assert.equal(engines.calls.org.length, 0);
  const f = frames(res.chunks);
  assert.ok(f.find((x) => x.type === 'message' && x.summary === 'Clarification needed'));
  assert.equal(f.at(-1), '[DONE]');
});

// ── agents-unavailable gate (send-time defense in depth) ────────────────────

test('agents gate: pure agent request on an attention org → 403 plain JSON, no engine runs', async () => {
  const engines = fakeEngines();
  const { router } = makeRouter({
    engines,
    getDiagnostics: attentionDiagnostics,
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 403, 'refused before any engine work');
  assert.ok(res.body.error.includes('Agent building is unavailable in this org'), res.body.error);
  assert.ok(res.body.error.includes('Org changes still work'), 'names the still-working path');
  assert.equal(engines.calls.agent.length, 0, 'agent engine never invoked');
  assert.equal(engines.calls.org.length, 0, 'org engine never invoked');
  assert.equal(res.headersSent, false, '403 is plain JSON, not SSE');
});

test('agents gate: 403 carries the cause-aware fix for the actual blocker', async () => {
  const { router } = makeRouter({
    getDiagnostics: async () => ({
      state: 'attention',
      capability: { agents: 'attention', org_change: 'ok' },
      checks: { settings: { agentforceEnabled: false, reason: 'x' } },
    }),
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 403);
  assert.ok(res.body.error.includes('Enable Agentforce Agent and Einstein in Setup → Agentforce'), res.body.error);
});

test('agents gate: both on an attention org → org-change half routed away, agent half skipped with a warning', async () => {
  const engines = fakeEngines();
  const { router } = makeRouter({
    engines,
    getDiagnostics: attentionDiagnostics,
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent and add a field', orgId: ORG, capability: 'both' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(engines.calls.agent.length, 0, 'agent engine never invoked');
  assert.equal(engines.calls.org.length, 1, 'org-change half still runs (routed away)');
  const f = frames(res.chunks);
  const warn = f.find((x) => x.type === 'deploy_warning' && x.summary === 'Agent half skipped');
  assert.ok(warn, 'warning frame names the skipped agent half');
  assert.ok(/Skipping the agent half/.test(warn.content), warn.content);
  assert.equal(warn.capability, 'org_change', 'warning belongs to the org segment');
  assert.equal(f.at(-1), '[DONE]');
});

test('agents gate: healthy org → agent request runs normally', async () => {
  const engines = fakeEngines();
  const { router } = makeRouter({ engines });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(engines.calls.agent.length, 1, 'agent engine invoked');
  assert.equal(engines.calls.org.length, 0);
  assert.equal(frames(res.chunks).at(-1), '[DONE]');
});

test('agents gate: diagnostics outage fails open — chat proceeds, never blocked', async () => {
  const engines = fakeEngines();
  const { router } = makeRouter({
    engines,
    getDiagnostics: async () => { throw new Error('cache boom'); },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(engines.calls.agent.length, 1, 'gate cannot verify → request proceeds');
  assert.equal(frames(res.chunks).at(-1), '[DONE]');
});

test('single-flight: 409 plain JSON before SSE headers', async () => {
  const { router } = makeRouter({
    agent: {
      isBusy: async () => true, // Redis-backed isBusy is async (plan §7.3)
      async runAgent() { throw new Error('must not run'); },
      abort() {},
    },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 409);
  assert.ok(res.body.error.includes('already running'));
  assert.equal(res.headersSent, false, '409 must be plain JSON, not SSE');
});

test('client disconnect aborts the in-flight agent generation', async () => {
  const engines = fakeEngines();
  let release;
  const { router } = makeRouter({
    engines,
    agent: {
      isBusy: () => false,
      runAgent: () => new Promise((r) => { release = r; }),
      abort: () => { engines.calls.aborted = true; },
    },
  });
  const { req, res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10)); // handler reaches the engine await
  req.emit('close'); // client went away
  assert.equal(engines.calls.aborted, true, 'abort must be invoked on close');
  release({ role: 'assistant', content: 'late' }); // let the handler finish
  await new Promise((r) => setTimeout(r, 10));
});

test('credential refresh failure → 401 reconnect message (EC-10)', async () => {
  const { router } = makeRouter({
    getCredentials: async () => {
      const err = new Error('refresh failed');
      err.status = 401;
      throw err;
    },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 401);
  assert.ok(res.body.error.includes('Reconnect this org'));
});

test('org connection missing → 404', async () => {
  const { router } = makeRouter({
    getCredentials: async () => {
      const err = new Error('not found');
      err.status = 404;
      throw err;
    },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Org connection not found');
});

test('engine throws after SSE starts → error frame + [DONE], stream ends', async () => {
  const { router } = makeRouter({
    agent: {
      isBusy: () => false,
      async runAgent() { throw new Error('boom'); },
      abort() {},
    },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  const f = frames(res.chunks);
  assert.ok(f.some((x) => x.type === 'error' && x.content === 'Critical backend failure.'));
  assert.equal(f.at(-1), '[DONE]');
});

test('unknown legacy event type degrades to a status frame, stream survives', async () => {
  const { router } = makeRouter({
    agent: {
      isBusy: () => false,
      async runAgent({ onEvent }) {
        onEvent({ type: 'new_token', token: 'should-not-crash-stream' }); // not in SSE_TYPES
        return { role: 'assistant', content: 'ok' };
      },
      abort() {},
    },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  const f = frames(res.chunks);
  assert.equal(f.at(-1), '[DONE]', 'stream must complete despite unknown type');
  assert.ok(f.some((x) => x.type === 'status'));
});

// ── file attachments (legacy multer parity) ─────────────────────────────────

test('attachment: engine prompt includes the injected document text; routing/logging keep the raw message', async () => {
  const engines = fakeEngines();
  const db = sessionRecorderDb();
  const { router } = makeRouter({
    engines,
    db,
    upload: uploadFrom({ buffer: Buffer.from('doc'), mimetype: 'text/plain', originalname: 'prd.md' }),
    extractFile: extractFrom({ text: 'file body here' }),
  });
  const { res } = invokeRouter(router, {
    body: { message: 'summarize this PRD', orgId: ORG, capability: 'agent', sessionId: 'sess-file1' },
    file: { buffer: Buffer.from('doc'), mimetype: 'text/plain', originalname: 'prd.md' },
  });
  await new Promise((r) => setTimeout(r, 10));

  // The engine receives the combined prompt (raw message + injection block).
  const call = engines.calls.agent[0];
  assert.ok(call.message.includes('summarize this PRD'), 'user words stay first');
  assert.ok(call.message.includes('[prd.md: file body here]'), 'injected text present in the engine prompt');

  // ai_logs records the RAW message (the log is about the user turn, not the
  // 50k injection).
  assert.equal(db.aiLogs[0].prompt, 'summarize this PRD');
  assert.equal(db.aiLogs[0].ai_response, 'Agent done.');
  assert.equal(frames(res.chunks).at(-1), '[DONE]');
});

test('attachment: image + agent capability → the engine receives Gemini inlineData parts (legacy parity)', async () => {
  const engines = fakeEngines();
  const { router, calls } = makeRouter({
    engines,
    extractFile: async () => ({ kind: 'image', mimeType: 'image/png', base64: 'QUJD', originalname: 'shot.png' }),
  });
  const { res } = invokeRouter(router, {
    body: { message: 'look at this', orgId: ORG, capability: 'agent' },
    file: { buffer: Buffer.from('x'), mimetype: 'image/png', originalname: 'shot.png' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.agent.length, 1, 'agent ran');
  assert.deepEqual(
    calls.agent[0].message,
    [
      { text: 'look at this' },
      { inlineData: { data: 'QUJD', mimeType: 'image/png' } },
    ],
    'legacy [{ text }, { inlineData }] parts shape'
  );
  assert.equal(calls.org.length, 0, 'no org run');
  assert.equal(frames(res.chunks).at(-1), '[DONE]');
});

test('attachment: image + org_change → vision-described and injected into the org engine message', async () => {
  const engines = fakeEngines();
  const describeCalls = [];
  const { router, calls } = makeRouter({
    engines,
    extractFile: async () => ({ kind: 'image', mimeType: 'image/png', base64: 'QUJD', originalname: 'shot.png' }),
    describeImage: async ({ base64, mimeType, hint }) => {
      describeCalls.push({ base64, mimeType, hint });
      return 'shows a validation rule config for Opportunity';
    },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'mirror this config', orgId: ORG, capability: 'org_change' },
    file: { buffer: Buffer.from('x'), mimetype: 'image/png', originalname: 'shot.png' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(describeCalls, [{ base64: 'QUJD', mimeType: 'image/png', hint: 'mirror this config' }]);
  assert.equal(
    calls.org[0].message,
    'mirror this config + [shot.png: shows a validation rule config for Opportunity]',
    'description injected through the attachment block'
  );
  assert.equal(calls.agent.length, 0, 'no agent run');
  assert.equal(frames(res.chunks).at(-1), '[DONE]');
});

test('attachment: image + both → agent gets inlineData parts AND org gets the description', async () => {
  const engines = fakeEngines();
  const { router, calls } = makeRouter({
    engines,
    extractFile: async () => ({ kind: 'image', mimeType: 'image/jpeg', base64: 'QkFC', originalname: 'ui.png' }),
    describeImage: async () => 'a permission-set screenshot',
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent and grant perms like this', orgId: ORG, capability: 'both' },
    file: { buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'ui.png' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls.agent[0].message, [
    { text: 'build an agent and grant perms like this' },
    { inlineData: { data: 'QkFC', mimeType: 'image/jpeg' } },
  ]);
  assert.equal(calls.org[0].message, 'build an agent and grant perms like this + [ui.png: a permission-set screenshot]');
  assert.equal(frames(res.chunks).at(-1), '[DONE]');
});

test('attachment: image describe failure → warning frame, org still runs on the raw message', async () => {
  const engines = fakeEngines();
  const { router, calls } = makeRouter({
    engines,
    extractFile: async () => ({ kind: 'image', mimeType: 'image/png', base64: 'QUJD', originalname: 'shot.png' }),
    describeImage: async () => { throw new Error('GOOGLE_AI_API_KEY is not set'); },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'mirror this', orgId: ORG, capability: 'org_change' },
    file: { buffer: Buffer.from('x'), mimetype: 'image/png', originalname: 'shot.png' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.org[0].message, 'mirror this', 'degraded to the raw message');
  const f = frames(res.chunks);
  assert.ok(
    f.some((x) => x.type === 'deploy_warning' && /Could not analyze the attached image/.test(x.content)),
    'honest warning frame emitted'
  );
  assert.equal(f.at(-1), '[DONE]');
});

test('attachment: image describe returns EMPTY → same warning + raw message (no silent drop)', async () => {
  const engines = fakeEngines();
  const { router, calls } = makeRouter({
    engines,
    extractFile: async () => ({ kind: 'image', mimeType: 'image/png', base64: 'QUJD', originalname: 'shot.png' }),
    describeImage: async () => '',
  });
  const { res } = invokeRouter(router, {
    body: { message: 'mirror this', orgId: ORG, capability: 'org_change' },
    file: { buffer: Buffer.from('x'), mimetype: 'image/png', originalname: 'shot.png' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.org[0].message, 'mirror this', 'degraded to the raw message');
  const f = frames(res.chunks);
  assert.ok(
    f.some((x) => x.type === 'deploy_warning' && /Could not analyze the attached image/.test(x.content)),
    'empty result is not silently dropped — warning frame emitted'
  );
  assert.equal(f.at(-1), '[DONE]');
});

test('attachment: empty extraction → 400 with the file name', async () => {
  const { router } = makeRouter({
    extractFile: async () => ({ kind: 'text', text: '' }),
  });
  const { res } = invokeRouter(router, {
    body: { message: 'read this', orgId: ORG, capability: 'agent' },
    file: { buffer: Buffer.from(''), mimetype: 'application/pdf', originalname: 'empty.pdf' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Could not extract any text from "empty.pdf"/);
});

test('attachment: MulterError (file too large) → 400 file-upload error', async () => {
  const engines = fakeEngines();
  const multer = await import('multer');
  const { router } = makeRouter({
    engines,
    upload: uploadFrom({ error: new multer.default.MulterError('LIMIT_FILE_SIZE') }),
  });
  const { res } = invokeRouter(router, { body: { message: 'hi', orgId: ORG, capability: 'agent' } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /File upload error/);
  assert.equal(engines.calls.agent.length, 0);
});

test('attachment: allowlist rejection → 400 with the legacy message', async () => {
  const { router } = makeRouter({
    upload: uploadFrom({ error: new Error('Invalid file type. Only PDF, DOCX, TXT, and MD files are permitted.') }),
  });
  const { res } = invokeRouter(router, { body: { message: 'hi', orgId: ORG, capability: 'agent' } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Only PDF, DOCX, TXT, and MD/);
});

test('attachment: document parse failure → 400 with a try-a-different-format message', async () => {
  const { router } = makeRouter({
    extractFile: async () => { throw new Error('corrupt pdf'); },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'read this', orgId: ORG, capability: 'agent' },
    file: { buffer: Buffer.from('x'), mimetype: 'application/pdf', originalname: 'bad.pdf' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, 400, 'a parse failure is a request error, pre-SSE');
});

test('real HTTP: multipart FormData with a .txt file reaches the engines end to end', async () => {
  const app = express();
  app.use(express.json());
  let receivedPrompt = null;
  const router = createChatStreamRouter({
    authMiddleware: stubAuth,
    route: async () => ({ capability: 'agent', confidence: 0.9, reason: 'stub', overrideSource: 'model' }),
    agent: {
      isBusy: () => false,
      async runAgent({ message, onEvent }) {
        receivedPrompt = message;
        onEvent({ type: 'status', content: 'wire' });
        return { role: 'assistant', content: 'File read.' };
      },
      abort() {},
    },
    org: { async runOrgChange() { return {}; } },
    getCredentials: stubCredentials,
    db: loggingDb,
    extractFile: async (f) => ({ kind: 'text', text: f.buffer.toString('utf-8') }),
    getDiagnostics: healthyDiagnostics,
  });
  app.use('/api/v1/chat/stream', router);
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const form = new FormData();
    form.append('message', 'summarize');
    form.append('orgId', ORG);
    form.append('file', new File(['Build a validation rule for the Invoice object.'], 'prd.txt', { type: 'text/plain' }));
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/chat/stream`, { method: 'POST', body: form });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /data: \{"type":"message"/);
    assert.ok(body.endsWith('data: [DONE]\n\n'), 'stream completes');
    assert.ok(receivedPrompt.includes('Build a validation rule for the Invoice object.'), 'real multipart file text injected');
    assert.ok(receivedPrompt.includes('=== SYSTEM INJECTION: ATTACHED DOCUMENT TEXT ==='), 'legacy injection block present');
  } finally {
    server.close();
  }
});

// ── unified ai_logs writer (plan §3) ────────────────────────────────────────

test('agent turn writes an ai_log row (capability, prompt, response, latency)', async () => {
  const db = sessionRecorderDb();
  const { router } = makeRouter({ db });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent', sessionId: 'sess-a1' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(db.aiLogs.length, 1, 'one ai_log row for the agent turn');
  const row = db.aiLogs[0];
  assert.equal(row.capability, 'agent');
  assert.equal(row.user_id, 'auth-users-1');
  assert.equal(row.org_id, ORG);
  assert.equal(row.session_id, 'sess-a1');
  assert.equal(row.prompt, 'build an agent');
  assert.equal(row.ai_response, 'Agent done.');
  assert.equal(row.status, 'SUCCESS');
  assert.equal(typeof row.latency_ms, 'number');
  assert.equal(frames(res.chunks).at(-1), '[DONE]');
});

test('org_change turn writes an ai_log row tagged org_change', async () => {
  const db = sessionRecorderDb();
  const { router } = makeRouter({ db });
  invokeRouter(router, {
    body: { message: 'add a validation rule', orgId: ORG, capability: 'org_change', sessionId: 'sess-o1' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(db.aiLogs.length, 1);
  assert.equal(db.aiLogs[0].capability, 'org_change');
  assert.equal(db.aiLogs[0].ai_response, 'Org change queued.');
  assert.equal(db.aiLogs[0].status, 'SUCCESS');
});

test('both: two ai_log rows, one per capability in execution order', async () => {
  const db = sessionRecorderDb();
  const { router } = makeRouter({ db });
  invokeRouter(router, {
    body: { message: 'build an agent and add a field', orgId: ORG, capability: 'both', sessionId: 'sess-b1' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(db.aiLogs.map((x) => x.capability), ['agent', 'org_change']);
});

test('agent step failure logs a FAILED ai_log row, stream still errors cleanly', async () => {
  const db = sessionRecorderDb();
  const { router } = makeRouter({
    db,
    agent: {
      isBusy: async () => false,
      async runAgent() { throw new Error('deploy exploded'); },
      abort() {},
    },
  });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent', sessionId: 'sess-f1' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(db.aiLogs.length, 1);
  assert.equal(db.aiLogs[0].status, 'FAILED');
  assert.equal(db.aiLogs[0].error_code, 'deploy exploded');
  const f = frames(res.chunks);
  assert.ok(f.some((x) => x.type === 'error'), 'engine failure still surfaces to the user');
});

test('ai_logs table missing (migration 008 pending) → stream proceeds', async () => {
  const db = {
    from: (table) => {
      if (table === 'routing_log') return { insert: async () => ({ error: null }) };
      if (table === 'ai_logs') return { insert: async () => ({ error: { message: "Could not find the table 'forge.ai_logs' in schema cache" } }) };
      return chatSessionsOk();
    },
  };
  const { router } = makeRouter({ db });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  const f = frames(res.chunks);
  assert.equal(f.at(-1), '[DONE]', 'missing ai_logs table must not fail the stream');
  assert.ok(f.some((x) => x.type === 'message'), 'agent engine still ran');
});

test('ai_logs write fails with a REAL db error → stream still completes (fire-and-forget)', async () => {
  const db = {
    from: (table) => {
      if (table === 'routing_log') return { insert: async () => ({ error: null }) };
      if (table === 'ai_logs') return { insert: async () => ({ error: { message: 'connection refused' } }) };
      return chatSessionsOk();
    },
  };
  const { router } = makeRouter({ db });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.statusCode, undefined, 'no 500 — ai_logs is fire-and-forget');
  const f = frames(res.chunks);
  assert.equal(f.at(-1), '[DONE]');
});

// ── chat_sessions spine (§7.3 / S-2) ────────────────────────────────────────

test('agent turn appends a capability segment to chat_sessions', async () => {
  const db = sessionRecorderDb();
  const { router } = makeRouter({ db });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent', sessionId: 'sess-123' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(db.sessions.length, 1);
  const row = db.sessions[0];
  assert.equal(row.session_id, 'sess-123');
  assert.equal(row.user_id, 'auth-users-1');
  assert.equal(row.org_id, ORG);
  const segs = JSON.parse(row.capability_segments);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].capability, 'agent');
  assert.equal(segs[0].engineRef, 'agentforce');
  assert.equal(segs[0].summary, 'Agent done.');
  assert.ok(row.compressed_history.includes('Agent done.'));
  const f = frames(res.chunks);
  assert.equal(f.at(-1), '[DONE]');
});

test('org_change turn appends an org_change segment (summary from the last message)', async () => {
  const db = sessionRecorderDb();
  const { router } = makeRouter({ db });
  const { res } = invokeRouter(router, {
    body: { message: 'add a validation rule', orgId: ORG, capability: 'org_change', sessionId: 's2' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(db.sessions.length, 1);
  const segs = JSON.parse(db.sessions[0].capability_segments);
  assert.equal(segs[0].capability, 'org_change');
  assert.equal(segs[0].engineRef, 'orgforge');
  assert.equal(segs[0].summary, 'Org change queued.');
  assert.equal(frames(res.chunks).at(-1), '[DONE]');
});

test('both: one row, two segments in execution order (agent → org_change)', async () => {
  const db = sessionRecorderDb();
  const { router } = makeRouter({ db });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent and add a field', orgId: ORG, capability: 'both', sessionId: 's3' },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(db.sessions.length, 1, 'first segment inserts the row');
  assert.equal(db.updates.length, 1, 'second segment updates the same row');
  const segs = JSON.parse(db.updates[0].capability_segments);
  assert.deepEqual(segs.map((s) => s.capability), ['agent', 'org_change']);
  assert.equal(frames(res.chunks).at(-1), '[DONE]');
});

test('clarify turn appends a clarify segment', async () => {
  const db = sessionRecorderDb();
  const { router } = makeRouter({ db });
  const { res } = invokeRouter(router, {
    body: { message: 'hmm what can you do', orgId: ORG, capability: 'clarify', sessionId: 's6' },
  });
  await new Promise((r) => setTimeout(r, 10));
  const segs = JSON.parse(db.sessions[0].capability_segments);
  assert.equal(segs[0].capability, 'clarify');
  assert.equal(segs[0].engineRef, 'router');
  assert.equal(frames(res.chunks).at(-1), '[DONE]');
});

test('no sessionId → segments key to the default session', async () => {
  const db = sessionRecorderDb();
  const { router } = makeRouter({ db });
  invokeRouter(router, { body: { message: 'build an agent', orgId: ORG, capability: 'agent' } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(db.sessions[0].session_id, 'default');
});

test('chat_sessions table missing (migration 008 pending) → stream proceeds', async () => {
  const db = {
    from: (table) => {
      if (table === 'routing_log') return { insert: async () => ({ error: null }) };
      return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "Could not find the table 'forge.chat_sessions' in schema cache" } }) }) }) }) }),
        insert: async () => ({ error: { message: "Could not find the table 'forge.chat_sessions' in schema cache" } }),
        update: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }),
      };
    },
  };
  const { router } = makeRouter({ db });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent', sessionId: 's4' },
  });
  await new Promise((r) => setTimeout(r, 10));
  const f = frames(res.chunks);
  assert.equal(f.at(-1), '[DONE]', 'missing table must not fail the stream');
  assert.ok(f.some((x) => x.type === 'message'), 'agent engine still ran');
});

test('chat_sessions write fails with a REAL db error → error frame (fail-loud)', async () => {
  const db = {
    from: (table) => {
      if (table === 'routing_log') return { insert: async () => ({ error: null }) };
      return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
        insert: async () => ({ error: { message: 'connection refused' } }),
        update: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }),
      };
    },
  };
  const { router } = makeRouter({ db });
  const { res } = invokeRouter(router, {
    body: { message: 'build an agent', orgId: ORG, capability: 'agent', sessionId: 's5' },
  });
  await new Promise((r) => setTimeout(r, 10));
  const f = frames(res.chunks);
  assert.ok(
    f.some((x) => x.type === 'error' && x.content === 'Critical backend failure.'),
    'a real chat_sessions error must surface after the engine work'
  );
  assert.equal(f.at(-1), '[DONE]');
});

test('real HTTP: wire framing is data:{...} frames + [DONE] terminator', async () => {
  const app = makeApp();
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'build an agent', orgId: ORG }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const body = await res.text();
    assert.match(body, /data: \{"type":"status"/);
    assert.match(body, /data: \{"type":"message"/);
    assert.match(body, /"content":"Wire done\."/);
    assert.ok(body.endsWith('data: [DONE]\n\n'), `body must end with [DONE], got: ${body.slice(-40)}`);
  } finally {
    server.close();
  }
});
