import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  verifyRecordSignature,
  signRecordForTest,
  pickOrg,
  createReport,
  recordStage,
  writeReport,
} from './driveWorkspaceFlow.mjs';

const SECRET = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

/**
 * Mirrors ChangeRecordService.assembleChangeRecord's fixed key order — the
 * HMAC is over JSON.stringify of exactly this shape, so byte-exact verification
 * depends on the same insertion order.
 */
function assembleSampleRecord(overrides = {}) {
  return {
    id: 'CR-1786440000000',
    changeSetId: 'cs-1',
    approverIdentity: 'ops@example.com',
    deploymentId: '0Af000000000001',
    gitCommitHash: 'abc123',
    intent: 'Add a validation rule to Opportunity',
    businessRationale: 'A2 drive test',
    userId: 'auth-users-1',
    orgId: '00D000000000001',
    changeIntentId: 'ci-1',
    dryRunId: '0Af000000000002',
    impactBrief: { blastRadiusClassification: 'Low' },
    gateResults: [{ gateCode: 'REF-01', outcome: 'PASS', plainLanguageReason: 'ok' }],
    skillsUsed: ['sf-skills/v64.0'],
    artifacts: [{ filePath: 'objects/Opportunity.object', metadataType: 'CustomObject', fullName: 'Opportunity', skillUsed: 'sf-skills/v64.0' }],
    timestamp: '2026-08-11T12:00:00.000Z',
    ...overrides,
  };
}

test('verifyRecordSignature passes for a correctly-signed record (byte-exact)', () => {
  const signed = signRecordForTest(assembleSampleRecord(), SECRET);
  const { ok, expected, signatureHash } = verifyRecordSignature(signed, SECRET);
  assert.equal(ok, true);
  assert.equal(expected, signatureHash);
});

test('verifyRecordSignature fails on a tampered record (tamper-evident)', () => {
  const record = assembleSampleRecord();
  record.impactBrief.blastRadiusClassification = 'High'; // tamper after signing
  const signed = signRecordForTest(record, SECRET);
  signed.impactBrief.blastRadiusClassification = 'Low'; // attacker rewrites the payload
  const { ok } = verifyRecordSignature(signed, SECRET);
  assert.equal(ok, false);
});

test('verifyRecordSignature throws when the record is unsigned', () => {
  const record = assembleSampleRecord(); // no signatureHash
  assert.throws(() => verifyRecordSignature(record, SECRET), /no signatureHash/);
});

test('verifyRecordSignature throws when HMAC_SECRET is missing', () => {
  const signed = signRecordForTest(assembleSampleRecord(), SECRET);
  assert.throws(() => verifyRecordSignature(signed, ''), /HMAC_SECRET missing/);
});

test('signature survives JSON round-trip (SSE → JSON parse preserves key order)', () => {
  const signed = signRecordForTest(assembleSampleRecord(), SECRET);
  const roundTripped = JSON.parse(JSON.stringify(signed));
  const { ok } = verifyRecordSignature(roundTripped, SECRET);
  assert.equal(ok, true);
});

// ── org selection (--org / --org-alias) ──────────────────────────────────────
const ORGS = [
  { id: '00D000000000001', alias: 'my-sandbox-dev-ed', type: 'sandbox', instanceUrl: 'https://my-sandbox-dev-ed.my.salesforce.com' },
  { id: '00D000000000002', alias: 'Prod-Edge', type: 'production', instanceUrl: 'https://prod-edge.my.salesforce.com' },
];

test('pickOrg matches by org id', () => {
  const org = pickOrg(ORGS, { orgId: '00D000000000002' });
  assert.equal(org.alias, 'Prod-Edge');
});

test('pickOrg matches by alias (case-insensitive)', () => {
  const org = pickOrg(ORGS, { orgAlias: 'MY-SANDBOX-DEV-ED' });
  assert.equal(org.id, '00D000000000001');
});

test('pickOrg defaults to the first connected org', () => {
  const org = pickOrg(ORGS, {});
  assert.equal(org.id, '00D000000000001');
});

test('pickOrg refuses both --org and --org-alias at once', () => {
  assert.throws(() => pickOrg(ORGS, { orgId: '00D1', orgAlias: 'x' }), /only one of --org/);
});

test('pickOrg lists available orgs when the id or alias is not found', () => {
  assert.throws(() => pickOrg(ORGS, { orgId: '00D9' }), /Available: .*Prod-Edge/);
  assert.throws(() => pickOrg(ORGS, { orgAlias: 'nope' }), /Available aliases: .*my-sandbox-dev-ed/);
});

// ── audit report (--report) ──────────────────────────────────────────────────
test('createReport captures run metadata', () => {
  const report = createReport({ base: 'http://x', orgId: '00D1', orgAlias: null, deploy: true, ackDestructive: false });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.tool, 'driveWorkspaceFlow.mjs');
  assert.equal(report.args.deploy, true);
  assert.equal(report.args.orgId, '00D1');
  assert.deepEqual(report.stages, []);
  assert.equal(report.outcome, null);
  assert.equal(report.org, null);
});

test('recordStage appends stage entries in order', () => {
  const report = createReport({ base: 'http://x', orgId: null, orgAlias: 'a', deploy: false, ackDestructive: false });
  recordStage(report, 1, 'Connect Org', 'ok', { orgId: '00D1' });
  recordStage(report, 6, 'Refusal Gates', 'refused', { total: 3 });
  assert.equal(report.stages.length, 2);
  assert.equal(report.stages[1].n, 6);
  assert.equal(report.stages[1].status, 'refused');
  assert.equal(report.stages[1].detail.total, 3);
});

test('writeReport writes parseable JSON with the full audit trail', () => {
  const report = createReport({ base: 'http://localhost:3001', orgId: '00D1', orgAlias: null, deploy: true, ackDestructive: false });
  recordStage(report, 1, 'Connect Org', 'ok', { orgId: '00D1' });
  report.outcome = { exitCode: 0, status: 'success' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-report-'));
  const file = path.join(dir, 'nested', 'a2-report.json'); // parent dir must be created
  const written = writeReport(report, file);
  assert.equal(written, file);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.args.base, 'http://localhost:3001');
  assert.equal(parsed.outcome.status, 'success');
  assert.equal(parsed.stages[0].detail.orgId, '00D1');
});

test('a usage error (unknown arg) still writes the --report audit trail (exit 1)', () => {
  const script = new URL('./driveWorkspaceFlow.mjs', import.meta.url).pathname;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-usage-'));
  const file = path.join(dir, 'usage.json');
  let exit = 0;
  let out = '';
  try {
    out = execFileSync(process.execPath, [script, '--report', file, '--bogus-flag'], { encoding: 'utf8' });
  } catch (e) {
    exit = e.status ?? 1;
    out = (e.stdout || '') + (e.stderr || '');
  }
  assert.equal(exit, 1);
  assert.match(out, /Unknown argument/);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.outcome.exitCode, 1);
  assert.equal(parsed.outcome.status, 'usage-error');
  assert.match(parsed.outcome.error, /bogus-flag/);
});
