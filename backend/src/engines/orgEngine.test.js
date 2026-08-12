import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrgEngine } from './orgEngine.js';

const CREDS = { accessToken: 'tok', instanceUrl: 'https://a.my.salesforce.com' };

/** Fake OrgForge service modules keyed by service file path. */
function fakeServices({ aiError, gateOutcome = 'PASS', dryRunStatus = 'Succeeded', deployStatus = 'Succeeded', persistError } = {}) {
  return {
    'services/aiOrchestrator.js': {
      aiOrchestrator: {
        parseIntent: aiError ? async () => { throw new Error(aiError); } : async () => ({
          operation: 'CREATE_VALIDATION_RULE',
          targetComponent: 'Opportunity',
          ambiguities: [],
        }),
        generateMetadata: async () => '<?xml version="1.0"?><ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Opportunity_Rule</fullName><errorConditionFormula>true</errorConditionFormula></ValidationRule>',
      },
    },
    'utils/aiSafety.js': {
      normalizeOperation: (op) => (op === 'UNKNOWN' ? 'UNKNOWN' : op),
    },
    'services/skillResolver.js': {
      skillResolver: {
        resolveSkill: () => ({ content: 'skill-content', skillName: 'validation-rule-generate', skillVersion: 'v1' }),
      },
    },
    'services/impactAnalyzer.js': {
      impactAnalyzer: {
        computeImpact: async () => ({ blastRadiusClassification: 'Low', dependenciesCount: 0, dataImpact: { violatingRecords: 0 } }),
      },
    },
    'services/refusalGateEngine.js': {
      refusalGateEngine: {
        evaluateGates: (ctx) => {
          const refused = gateOutcome !== 'PASS';
          return {
            gateOutcome: refused ? 'REFUSED' : 'PASS',
            results: refused
              ? [{ gateCode: 'REF-07', outcome: 'REFUSED', plainLanguageReason: 'Cannot deploy to production without production mode enabled.', unblockPath: 'Enable production mode.' }]
              : [{ gateCode: 'REF-01', outcome: 'PASS' }],
          };
        },
      },
    },
    'services/metadataTransport.js': {
      metadataTransport: {
        assembleDeploymentZip: (artifacts) => Buffer.from(JSON.stringify(artifacts)),
        deployCheckOnly: async () => ({ deploymentId: 'dry-run-id' }),
        deployFinal: async () => ({ deploymentId: 'deploy-id' }),
        pollDeployStatus: async (_t, _u, id) => ({
          status: id === 'dry-run-id' ? dryRunStatus : deployStatus,
          ...(dryRunStatus !== 'Succeeded' && id === 'dry-run-id' ? { errorMessage: 'Invalid field' } : {}),
        }),
      },
    },
    'services/changeRecordService.js': {
      changeRecordService: {
        assembleChangeRecord: (...args) => ({ id: `CR-${Date.now()}`, ...args[6] ? { userId: args[6], orgId: args[7] } : {}, intent: args[4] }),
        // Mirrors the real contract: signs internally and returns the signed
        // record with the git hash (single source of truth for the hash).
        exportAndPersist: persistError
          ? async () => { throw new Error(persistError); }
          : async (record) => ({ ...record, signatureHash: 'sha256:abc123', gitCommitHash: 'git:7f9a11b' }),
      },
    },
  };
}

function collect() {
  const events = [];
  return { events, onEvent: (ev) => events.push(ev) };
}

function makeEngine(fakes) {
  return createOrgEngine({ loader: async (file) => fakes[file] });
}

test('full pipeline emits artifact → blast_radius → refusal_gates → dry_run → deploy → record cards in order', async () => {
  const engine = makeEngine(fakeServices());
  const { events, onEvent } = collect();
  const result = await engine.runOrgChange({ message: 'Add a validation rule to Opportunity', creds: CREDS, userId: 'u1', orgId: '00D1', onEvent });

  const cards = events.filter((e) => e.card).map((e) => e.card);
  assert.deepEqual(cards, ['artifact', 'blast_radius', 'refusal_gates', 'dry_run', 'deploy', 'record']);
  assert.equal(result.role, 'assistant');

  const deploy = events.find((e) => e.card === 'deploy');
  assert.equal(deploy.type, 'deploy_success');
  assert.equal(deploy.payload.deploymentId, 'deploy-id');
  assert.equal(deploy.payload.success, true);

  const record = events.find((e) => e.card === 'record');
  assert.equal(record.payload.persisted, true);
  assert.equal(record.payload.signatureHash, 'sha256:abc123');
  assert.equal(record.payload.gitCommitHash, 'git:7f9a11b');

  const gates = events.find((e) => e.card === 'refusal_gates');
  assert.equal(gates.payload.gateOutcome, 'PASS');

  const artifact = events.find((e) => e.card === 'artifact');
  assert.equal(artifact.payload.operation, 'CREATE_VALIDATION_RULE');
  assert.equal(artifact.payload.files.length, 1);
  assert.match(artifact.payload.files[0].filePath, /validationRules/);
});

test('missing AI capability emits an honest gap and stops before any deploy', async () => {
  const engine = makeEngine(fakeServices({ aiError: 'GOOGLE_AI_API_KEY is not configured' }));
  const { events, onEvent } = collect();
  await engine.runOrgChange({ message: 'Add a validation rule to Opportunity', creds: CREDS, userId: 'u1', orgId: '00D1', onEvent });

  const warning = events.find((e) => e.type === 'deploy_warning');
  assert.ok(warning, 'expected a deploy_warning gap event');
  assert.match(warning.content, /GOOGLE_AI_API_KEY/);
  // No card beyond the gap — and definitely no deploy.
  assert.equal(events.some((e) => e.card === 'deploy'), false);
  assert.equal(events.some((e) => e.card === 'artifact'), false);
});

test('refused gates stop the pipeline before the dry run', async () => {
  const engine = makeEngine(fakeServices({ gateOutcome: 'REFUSED' }));
  const { events, onEvent } = collect();
  await engine.runOrgChange({ message: 'Update a production permission set', creds: CREDS, userId: 'u1', orgId: '00D1', onEvent });

  const gates = events.find((e) => e.card === 'refusal_gates');
  assert.equal(gates.payload.gateOutcome, 'REFUSED');
  assert.equal(gates.payload.results[0].gateCode, 'REF-07');
  // The card content names the offending gates (not a bare "blocked").
  assert.match(gates.content, /REF-07/);
  const warning = events.find((e) => e.type === 'deploy_warning');
  // The bubble enumerates the refused gates with reasons + unblock paths so
  // the chat itself states what caused the refusal.
  assert.match(warning.content, /refused by 1 refusal gate/);
  assert.match(warning.content, /REF-07/);
  assert.match(warning.content, /Cannot deploy to production/);
  assert.match(warning.content, /Unblock:/);
  assert.match(warning.summary, /Blocked by 1 refusal gate/);
  assert.equal(events.some((e) => e.card === 'dry_run'), false);
  assert.equal(events.some((e) => e.card === 'deploy'), false);
});

test('failed dry run stops before a live deploy', async () => {
  const engine = makeEngine(fakeServices({ dryRunStatus: 'Failed' }));
  const { events, onEvent } = collect();
  await engine.runOrgChange({ message: 'Add a validation rule to Opportunity', creds: CREDS, userId: 'u1', orgId: '00D1', onEvent });

  const dryRun = events.find((e) => e.card === 'dry_run');
  assert.equal(dryRun.payload.success, false);
  assert.deepEqual(dryRun.payload.errors, [{ problem: 'Invalid field' }]);
  assert.equal(events.some((e) => e.card === 'deploy'), false);
});

test('missing HMAC_SECRET keeps the stream alive with an unsigned-record warning', async () => {
  const engine = makeEngine(fakeServices({ persistError: 'HMAC_SECRET is not configured; refusing to sign audit records.' }));
  const { events, onEvent } = collect();
  await engine.runOrgChange({ message: 'Add a validation rule to Opportunity', creds: CREDS, userId: 'u1', orgId: '00D1', onEvent });

  const record = events.find((e) => e.card === 'record');
  assert.equal(record.payload.persisted, false);
  assert.match(record.payload.reason, /HMAC_SECRET/);
  const warning = events.find((e) => e.type === 'deploy_warning');
  assert.match(warning.content, /audit record could not be persisted/);
  // Deployment itself still reported success before the record stage.
  assert.equal(events.some((e) => e.card === 'deploy' && e.payload.success), true);
});

test('production instance URL + no production mode → REF-07 refused via the real gate engine', async () => {
  // Use the REAL refusalGateEngine through the fake loader to prove the
  // org-type/production-mode guard wiring is correct.
  const fakes = fakeServices();
  const real = await import('../orgforge/services/refusalGateEngine.js');
  fakes['services/refusalGateEngine.js'] = { refusalGateEngine: real.refusalGateEngine };
  const engine = makeEngine(fakes);
  const { events, onEvent } = collect();
  await engine.runOrgChange({ message: 'Add a validation rule to Opportunity', creds: { accessToken: 'tok', instanceUrl: 'https://a.my.salesforce.com' }, userId: 'u1', orgId: '00D1', onEvent });

  const gates = events.find((e) => e.card === 'refusal_gates');
  assert.equal(gates.payload.gateOutcome, 'REFUSED');
  assert.ok(gates.payload.results.some((r) => r.gateCode === 'REF-07'));
  assert.equal(events.some((e) => e.card === 'dry_run'), false);
});
