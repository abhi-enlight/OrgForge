import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClassifierJson, parseClassifierOutput } from './classifier.js';

test('extracts JSON from a clean response', () => {
  const raw = extractClassifierJson('{"capability":"agent","confidence":0.95,"reason":"builds agents"}');
  assert.equal(raw.capability, 'agent');
});

test('extracts JSON wrapped in markdown fences and prose', () => {
  const raw = extractClassifierJson('Here you go:\n```json\n{"capability":"org_change","confidence":0.9,"reason":"metadata change"}\n```\nHope that helps!');
  assert.equal(raw.capability, 'org_change');
  assert.equal(raw.confidence, 0.9);
});

test('returns null on non-JSON or empty output', () => {
  assert.equal(extractClassifierJson(''), null);
  assert.equal(extractClassifierJson('no json here'), null);
  assert.equal(extractClassifierJson(null), null);
  assert.equal(extractClassifierJson('{broken json'), null);
});

test('parseClassifierOutput validates capability and clamps confidence', () => {
  const ok = parseClassifierOutput({ capability: 'agent', confidence: 2.5, reason: 'x' });
  assert.equal(ok.capability, 'agent');
  assert.equal(ok.confidence, 1, 'confidence clamped to 1');

  const bad = parseClassifierOutput({ capability: 'destroy_everything', confidence: -1 });
  assert.equal(bad.capability, 'clarify', 'unknown capability degrades to clarify');
  assert.equal(bad.confidence, 0, 'negative confidence clamped to 0');

  const empty = parseClassifierOutput(null);
  assert.equal(empty.capability, 'clarify');
  assert.equal(empty.confidence, 0);
});
