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

test('classifier failure fails closed to clarify', async () => {
  const result = await routeIntent('build an agent', {
    classifier: async () => { throw new Error('GOOGLE_AI_API_KEY missing'); },
  });
  assert.equal(result.capability, 'clarify');
  assert.equal(result.overrideSource, 'clarify');
});

test('deterministic override does not fire when model already agrees (keeps model reason)', async () => {
  const override = applyDeterministicOverrides('add a validation rule to Opportunity', 'org_change');
  assert.equal(override, null, 'no override needed when model already routed correctly');
});

test('override fires on ambiguous wording even mid-sentence', async () => {
  const override = applyDeterministicOverrides('please set up permission sets for our new sales reps', 'agent');
  assert.equal(override.capability, 'org_change');
});
