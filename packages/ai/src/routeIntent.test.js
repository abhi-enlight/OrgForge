import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeIntent, applyDeterministicOverrides } from './routeIntent.js';
import { GOLDEN_SET } from './goldenSet.js';

/** Stub classifier returning the golden-set entry's model answer. */
function stubClassifierFor(entry) {
  return async (message) => ({
    capability: entry.model,
    confidence: entry.confidence,
    reason: entry.reason || `stub: ${entry.model}`,
  });
}

test(`golden set: ${GOLDEN_SET.length} prompts route to expected capabilities`, async () => {
  assert.ok(GOLDEN_SET.length >= 40, 'golden set must have ≥40 prompts');

  const failures = [];
  for (const entry of GOLDEN_SET) {
    const result = await routeIntent(entry.prompt, {
      classifier: stubClassifierFor(entry),
    });
    if (result.capability !== entry.expected) {
      failures.push({ prompt: entry.prompt, expected: entry.expected, got: result.capability, source: result.overrideSource });
    }
  }

  assert.deepEqual(failures, [], `routing mismatches: ${JSON.stringify(failures, null, 2)}`);
});

test('overrides beat the model (deterministic source is authoritative)', async () => {
  const result = await routeIntent('add a validation rule to my agents order topic', {
    classifier: async () => ({ capability: 'agent', confidence: 0.95, reason: 'mentions agent' }),
  });
  assert.equal(result.capability, 'org_change');
  assert.equal(result.overrideSource, 'deterministic');
  assert.ok(result.confidence >= 0.9, 'override bumps confidence so UI trusts it');
});

test('pinned capability bypasses the classifier entirely', async () => {
  let classifierCalled = false;
  const result = await routeIntent('list my agents', {
    pinned: 'org_change',
    classifier: async () => { classifierCalled = true; return { capability: 'agent', confidence: 1, reason: '' }; },
  });
  assert.equal(result.capability, 'org_change');
  assert.equal(result.overrideSource, 'user_chip');
  assert.equal(classifierCalled, false, 'no model call when pinned');
});

test('low confidence falls back to clarify (never guess, EC-24)', async () => {
  const result = await routeIntent('make it work', {
    classifier: async () => ({ capability: 'agent', confidence: 0.3, reason: 'vague' }),
  });
  assert.equal(result.capability, 'clarify');
  assert.equal(result.overrideSource, 'clarify');
});

test('short follow-up continues the established capability when model + rules are unsure (context)', async () => {
  // The classifier-forgets-context case: mid agent-build, the user answers the
  // agent's clarifying question with a terse reply. The model asks to clarify,
  // the rules can't parse "create new", but the session was already agent.
  const result = await routeIntent('create new', {
    context: { digest: '- [agent (agentforce)]: Asked about the Lead Qualification Agent', lastCapability: 'agent' },
    classifier: async () => ({ capability: 'clarify', confidence: 0, reason: 'Request is ambiguous or unsafe' }),
  });
  assert.equal(result.capability, 'agent');
  assert.equal(result.overrideSource, 'context');
  assert.match(result.reason, /continuing the established capability/);
});

test('context continuation never fires for a long standalone request', async () => {
  // Deliberately rule-neutral vocabulary (no agent/org metadata words) and
  // >120 chars — a real standalone request, not a terse follow-up.
  const longMessage =
    'I am still deciding between the options we talked about and I will get back to you once I have thought it through with the rest of the team';
  assert.ok(longMessage.length > 120, 'test message must exceed the follow-up threshold');
  const result = await routeIntent(longMessage, {
    context: { digest: '- [agent (agentforce)]: Lead Qualification Agent build', lastCapability: 'agent' },
    classifier: async () => ({ capability: 'clarify', confidence: 0, reason: 'Request is ambiguous or unsafe' }),
  });
  assert.equal(result.capability, 'clarify');
  assert.equal(result.overrideSource, 'clarify');
});

test('context continuation fires on the classifier-failure path too', async () => {
  const result = await routeIntent('no escalation', {
    context: { digest: '- [agent (agentforce)]: Escalation strategy question', lastCapability: 'agent' },
    classifier: async () => { throw new Error('GOOGLE_AI_API_KEY missing'); },
  });
  assert.equal(result.capability, 'agent');
  assert.equal(result.overrideSource, 'context');
});

test('context continuation never fires without an established capability', async () => {
  const result = await routeIntent('create new', {
    context: { digest: '', lastCapability: null },
    classifier: async () => ({ capability: 'clarify', confidence: 0, reason: 'ambiguous' }),
  });
  assert.equal(result.capability, 'clarify');
  assert.equal(result.overrideSource, 'clarify');
});

test('a confident model verdict is never overridden by context', async () => {
  const result = await routeIntent('create new', {
    context: { digest: '- [agent (agentforce)]: Agent build', lastCapability: 'agent' },
    classifier: async () => ({ capability: 'org_change', confidence: 0.9, reason: 'clearly an org request' }),
  });
  assert.equal(result.capability, 'org_change');
  assert.equal(result.overrideSource, 'model');
});

test('classifier failure: unambiguous request routes via deterministic rules', async () => {
  const result = await routeIntent('build an agent', {
    classifier: async () => { throw new Error('GOOGLE_AI_API_KEY missing'); },
  });
  assert.equal(result.capability, 'agent');
  assert.equal(result.overrideSource, 'deterministic');
  assert.ok(result.confidence >= 0.9, 'rule hit is trusted by the UI');
  assert.match(result.reason, /Classifier unavailable/, 'reason records why the model path was skipped');
});

test('classifier failure: ambiguous request still fails closed to clarify', async () => {
  const result = await routeIntent('hello', {
    classifier: async () => { throw new Error('GOOGLE_AI_API_KEY missing'); },
  });
  assert.equal(result.capability, 'clarify');
  assert.equal(result.overrideSource, 'clarify');
});

test('flaky model clarify is resolved by the deterministic rules (never stalls an obvious build)', async () => {
  // Gemini can flakily answer "clarify" for a crystal-clear agent build request.
  const result = await routeIntent('Build a Case Triage Agent that owns inbound support cases', {
    classifier: async () => ({ capability: 'clarify', confidence: 0, reason: 'Request is ambiguous or unsafe' }),
  });
  assert.equal(result.capability, 'agent');
  assert.equal(result.overrideSource, 'deterministic');
  assert.match(result.reason, /deterministic rules resolved it/);
});

test('deterministic override does not fire when model already agrees (keeps model reason)', async () => {
  const override = applyDeterministicOverrides('add a validation rule to Opportunity', 'org_change');
  assert.equal(override, null, 'no override needed when model already routed correctly');
});

test('override fires on ambiguous wording even mid-sentence', async () => {
  const override = applyDeterministicOverrides('please set up permission sets for our new sales reps', 'agent');
  assert.equal(override.capability, 'org_change');
});
