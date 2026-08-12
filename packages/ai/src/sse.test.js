import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseEnvelope, serializeSseFrame, parseSseFrame, SSE_TYPES, SSE_CARDS } from './sse.js';

test('envelope keeps Agentforge type vocabulary + additive capability/card', () => {
  const env = createSseEnvelope({
    type: 'build_widget',
    capability: 'agent',
    content: 'building topic...',
    card: 'build_progress',
  });
  assert.equal(env.type, 'build_widget');
  assert.equal(env.capability, 'agent');
  assert.equal(env.card, 'build_progress');
});

test('rejects unknown event types (fail loudly in dev)', () => {
  assert.throws(() => createSseEnvelope({ type: 'mystery_event' }), /Invalid SSE type/);
});

test('drops invalid capability/card silently (additive-only contract)', () => {
  const env = createSseEnvelope({ type: 'message', capability: 'hack', card: 'not-a-card' });
  assert.equal(env.capability, undefined);
  assert.equal(env.card, undefined);
  assert.equal(env.type, 'message');
});

test('maps errors array to {component, problem} shape', () => {
  const env = createSseEnvelope({
    type: 'deploy_error',
    capability: 'org_change',
    errors: [{ component: 'ApexClass', problem: 'Compile error: missing semicolon' }, { problem: 'second problem' }],
  });
  assert.deepEqual(env.errors, [
    { component: 'ApexClass', problem: 'Compile error: missing semicolon' },
    { problem: 'second problem' },
  ]);
});

test('additive passthrough fields survive', () => {
  const env = createSseEnvelope({ type: 'status', content: 'ok', futureField: { a: 1 } });
  assert.deepEqual(env.futureField, { a: 1 });
});

test('serialize/parse round-trip', () => {
  const env = createSseEnvelope({ type: 'stream_chunk', capability: 'agent', content: 'hello' });
  const frame = serializeSseFrame(env);
  assert.match(frame, /^data: \{.*\}\n\n$/);
  const parsed = parseSseFrame(frame.slice(5).trim());
  assert.deepEqual(parsed, env);
});

test('empty optional fields are omitted, not sent as null', () => {
  const env = createSseEnvelope({ type: 'status' });
  assert.deepEqual(env, { type: 'status' });
});

test('all documented types and cards are valid', () => {
  for (const type of SSE_TYPES) {
    assert.doesNotThrow(() => createSseEnvelope({ type }));
  }
  for (const card of SSE_CARDS) {
    assert.doesNotThrow(() => createSseEnvelope({ type: 'status', card }));
  }
});
