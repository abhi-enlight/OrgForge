/**
 * Unit tests for changeRecordService.js
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeRecordService } from './changeRecordService.js';

const svc = new ChangeRecordService();
const HMAC_SECRET = 'test-secret-at-least-32-characters-long-abc';

describe('assembleChangeRecord', () => {
  it('produces an object with expected fields', () => {
    const rec = svc.assembleChangeRecord(
      'changeset-123', 'approver@org.com', 'deploy-456', null,
      'Add validation rule', 'Business rationale here',
      'user-uuid', 'org-id-123'
    );
    assert.ok(rec.id.startsWith('CR-'));
    assert.equal(rec.changeSetId, 'changeset-123');
    assert.equal(rec.approverIdentity, 'approver@org.com');
    assert.equal(rec.deploymentId, 'deploy-456');
    assert.equal(rec.intent, 'Add validation rule');
    assert.equal(rec.businessRationale, 'Business rationale here');
    assert.equal(rec.userId, 'user-uuid');
    assert.equal(rec.orgId, 'org-id-123');
    assert.ok(rec.timestamp); // ISO string
  });

  it('uses fallback strings for missing intent/rationale', () => {
    const rec = svc.assembleChangeRecord(
      'cs', 'a@b.com', 'dep', null, null, null, 'uid', 'oid'
    );
    assert.equal(rec.intent, 'Unknown Intent');
    assert.equal(rec.businessRationale, 'No rationale provided');
  });

  it('includes governance evidence (dryRunId, impactBrief, gateResults, skillsUsed)', () => {
    const rec = svc.assembleChangeRecord(
      'cs', 'a@b.com', 'dep', null, 'intent', 'rationale', 'uid', 'oid', null,
      {
        dryRunId: '0Af000000000001',
        impactBrief: { blastRadiusClassification: 'High', dataImpact: { violatingRecordsCount: 3 } },
        gateResults: [{ gateCode: 'REF-05', outcome: 'REFUSED' }, { gateCode: 'REF-07', outcome: 'PASS' }],
        skillsUsed: ['platform-validation-rule-generate'],
        artifacts: [{ filePath: 'a.validationRule-meta.xml', metadataType: 'ValidationRule', skillUsed: 'platform-validation-rule-generate' }]
      }
    );
    assert.equal(rec.dryRunId, '0Af000000000001');
    assert.equal(rec.impactBrief.blastRadiusClassification, 'High');
    assert.equal(rec.gateResults.length, 2);
    assert.deepEqual(rec.skillsUsed, ['platform-validation-rule-generate']);
    assert.equal(rec.artifacts.length, 1);
    assert.equal(rec.artifacts[0].filePath, 'a.validationRule-meta.xml');
    assert.equal(rec.artifacts[0].content, undefined, 'artifact content must not be persisted');
  });

  it('defaults evidence to safe empty values when absent', () => {
    const rec = svc.assembleChangeRecord('cs', 'a@b.com', 'dep', null, 'i', 'r', 'uid', 'oid');
    assert.equal(rec.dryRunId, null);
    assert.equal(rec.impactBrief, null);
    assert.equal(rec.gateResults, null);
    assert.deepEqual(rec.skillsUsed, []);
    assert.deepEqual(rec.artifacts, []);
  });

  it('defaults to kind org_change with no agent fields (EC-37)', () => {
    const rec = svc.assembleChangeRecord('cs', 'a@b.com', 'dep', null, 'i', 'r', 'uid', 'oid');
    assert.equal(rec.kind, 'org_change');
    assert.equal(rec.agentName, null);
    assert.equal(rec.agentSnapshot, null);
  });

  it('carries agent_deploy kind + snapshot from extras (EC-37)', () => {
    const rec = svc.assembleChangeRecord(
      'cs', null, '0Af000000000002', null, 'Build a support agent', 'Agent deployment via Copilot',
      'uid', 'oid', null,
      {
        kind: 'agent_deploy',
        agentName: 'Support_Agent_1',
        agentSnapshot: { yaml: 'name: Support_Agent_1\n', deployedAt: '2026-08-14T00:00:00.000Z' },
      }
    );
    assert.equal(rec.kind, 'agent_deploy');
    assert.equal(rec.agentName, 'Support_Agent_1');
    assert.equal(rec.agentSnapshot.yaml, 'name: Support_Agent_1\n');
    assert.equal(rec.artifacts.length, 0);
  });
});

describe('sign', () => {
  it('appends a 64-hex-char signatureHash to the record', () => {
    const rec = svc.assembleChangeRecord('cs', 'a@b.com', 'dep', null, 'intent', 'rationale', 'uid', 'oid');
    const signed = svc.sign(rec, HMAC_SECRET);
    assert.equal(typeof signed.signatureHash, 'string');
    assert.equal(signed.signatureHash.length, 64);
    // Should be hex only
    assert.match(signed.signatureHash, /^[0-9a-f]{64}$/);
  });

  it('produces deterministic signatures for the same input + secret', () => {
    const rec = svc.assembleChangeRecord('cs', 'a@b.com', 'dep', null, 'intent', 'rationale', 'uid', 'oid');
    const sig1 = svc.sign(rec, HMAC_SECRET).signatureHash;
    const sig2 = svc.sign(rec, HMAC_SECRET).signatureHash;
    assert.equal(sig1, sig2);
  });

  it('produces different signatures for different secrets', () => {
    const rec = svc.assembleChangeRecord('cs', 'a@b.com', 'dep', null, 'intent', 'rationale', 'uid', 'oid');
    const sig1 = svc.sign(rec, HMAC_SECRET).signatureHash;
    const sig2 = svc.sign(rec, 'other-secret-at-least-32-chars-long-xyz').signatureHash;
    assert.notEqual(sig1, sig2);
  });

  it('throws when secret is missing', () => {
    const rec = svc.assembleChangeRecord('cs', 'a@b.com', 'dep', null, 'intent', 'rationale', 'uid', 'oid');
    assert.throws(() => svc.sign(rec, null), /HMAC_SECRET/i);
    assert.throws(() => svc.sign(rec, undefined), /HMAC_SECRET/i);
    assert.throws(() => svc.sign(rec, ''), /HMAC_SECRET/i);
  });

  it('does not mutate the original record', () => {
    const rec = svc.assembleChangeRecord('cs', 'a@b.com', 'dep', null, 'intent', 'rationale', 'uid', 'oid');
    const original = JSON.stringify(rec);
    svc.sign(rec, HMAC_SECRET);
    assert.equal(JSON.stringify(rec), original, 'sign() must not mutate the input object');
  });
});
