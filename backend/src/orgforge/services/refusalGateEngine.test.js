/**
 * Unit tests for refusalGateEngine.js
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RefusalGateEngine } from './refusalGateEngine.js';

const engine = new RefusalGateEngine();

/**
 * Returns a fully-passing context.
 * Tests override individual fields to trigger a specific gate.
 */
function passingContext(overrides = {}) {
  return {
    impactData: { blastRadiusClassification: 'Low', dataImpact: { violatingRecordsCount: 0 } },
    deployDryRunData: { componentFailures: [] },
    codeAnalyzerData: { hasHighViolations: false },
    approverIdentity: 'approver@example.com',
    orgType: 'sandbox',
    productionMode: false,
    targetComponentNamespace: '',
    skillsLockHashValid: true,
    ambiguities: [],
    operation: 'CREATE_VALIDATION_RULE',
    rollbackAcknowledged: true,
    ...overrides
  };
}

describe('RefusalGateEngine.evaluateGates — overall outcome', () => {
  it('returns PASS when all conditions are met', () => {
    const { gateOutcome, results } = engine.evaluateGates(passingContext());
    assert.equal(gateOutcome, 'PASS');
    assert.equal(results.length, 10);
    for (const r of results) {
      assert.equal(r.outcome, 'PASS', `Expected PASS for gate ${r.gateCode}`);
    }
  });

  it('returns REFUSED when any gate fails', () => {
    const ctx = passingContext({ impactData: null });
    const { gateOutcome } = engine.evaluateGates(ctx);
    assert.equal(gateOutcome, 'REFUSED');
  });

  it('always returns 10 gate results', () => {
    const { results } = engine.evaluateGates(passingContext());
    assert.equal(results.length, 10);
  });
});

describe('REF-01: Impact Analysis Required', () => {
  it('PASS when impactData is present and not errored', () => {
    const { gateCode, outcome } = engine._evaluateRef01({ blastRadiusClassification: 'Low' });
    assert.equal(gateCode, 'REF-01');
    assert.equal(outcome, 'PASS');
  });

  it('REFUSED when impactData is null', () => {
    assert.equal(engine._evaluateRef01(null).outcome, 'REFUSED');
  });

  it('REFUSED when impactData has an error field', () => {
    assert.equal(engine._evaluateRef01({ error: 'timeout' }).outcome, 'REFUSED');
  });

  it('REFUSED when analysis is explicitly incomplete (dependency/integration query failed)', () => {
    assert.equal(engine._evaluateRef01({ analysisComplete: false }).outcome, 'REFUSED');
  });

  it('PASS when analysisComplete is true or absent', () => {
    assert.equal(engine._evaluateRef01({ analysisComplete: true }).outcome, 'PASS');
    assert.equal(engine._evaluateRef01({ blastRadiusClassification: 'Low' }).outcome, 'PASS');
  });
});

describe('REF-02: Dry-Run Must Pass', () => {
  it('PASS with empty component failures', () => {
    assert.equal(engine._evaluateRef02({ componentFailures: [] }).outcome, 'PASS');
  });

  it('PASS when dryRunData is absent (not run yet)', () => {
    assert.equal(engine._evaluateRef02(null).outcome, 'PASS');
    assert.equal(engine._evaluateRef02(undefined).outcome, 'PASS');
  });

  it('REFUSED when component failures are present', () => {
    assert.equal(
      engine._evaluateRef02({ componentFailures: [{ problem: 'Compile error' }] }).outcome,
      'REFUSED'
    );
  });
});

describe('REF-03: No High Code Violations', () => {
  it('PASS when no high violations', () => {
    assert.equal(engine._evaluateRef03({ hasHighViolations: false }).outcome, 'PASS');
  });

  it('PASS when codeAnalyzerData is absent', () => {
    assert.equal(engine._evaluateRef03(null).outcome, 'PASS');
  });

  it('REFUSED when hasHighViolations is true', () => {
    assert.equal(engine._evaluateRef03({ hasHighViolations: true }).outcome, 'REFUSED');
  });

  it('names the offending static-analysis rules in the refusal message', () => {
    const result = engine._evaluateRef03({
      hasHighViolations: true,
      violations: [
        { rule: 'ApexSOQLInjection', severity: 'HIGH' },
        { rule: 'AvoidHardcodedCredentials', severity: 'HIGH' }
      ]
    });
    assert.equal(result.outcome, 'REFUSED');
    assert.match(result.plainLanguageReason, /ApexSOQLInjection/);
    assert.match(result.plainLanguageReason, /AvoidHardcodedCredentials/);
    assert.match(result.unblockPath, /Regenerate|fix/i);
  });
});

describe('REF-04: Permission Changes Need Approver', () => {
  it('PASS for non-permission operation without approver', () => {
    assert.equal(engine._evaluateRef04('CREATE_VALIDATION_RULE', null).outcome, 'PASS');
  });

  it('PASS for permission operation WITH approver', () => {
    assert.equal(engine._evaluateRef04('CREATE_PERMISSION_SET', 'admin@org.com').outcome, 'PASS');
  });

  it('REFUSED for permission operation WITHOUT approver', () => {
    assert.equal(engine._evaluateRef04('CREATE_PERMISSION_SET', null).outcome, 'REFUSED');
    assert.equal(engine._evaluateRef04('UPDATE_PERMISSION_SET', '').outcome, 'REFUSED');
  });
});

describe('REF-05: No Violating Records', () => {
  it('PASS with zero violations', () => {
    assert.equal(engine._evaluateRef05({ violatingRecordsCount: 0 }).outcome, 'PASS');
  });

  it('PASS when dataImpact is absent', () => {
    assert.equal(engine._evaluateRef05(null).outcome, 'PASS');
  });

  it('REFUSED when violating records > 0', () => {
    assert.equal(engine._evaluateRef05({ violatingRecordsCount: 5 }).outcome, 'REFUSED');
  });
});

describe('REF-06: DELETE Must Be Acknowledged', () => {
  it('PASS for non-DELETE operation without acknowledgement', () => {
    assert.equal(engine._evaluateRef06('CREATE_VALIDATION_RULE', false).outcome, 'PASS');
    assert.equal(engine._evaluateRef06('UPDATE_CUSTOM_FIELD', false).outcome, 'PASS');
  });

  it('PASS for DELETE with acknowledgement', () => {
    assert.equal(engine._evaluateRef06('DELETE', true).outcome, 'PASS');
    assert.equal(engine._evaluateRef06('DELETE_CUSTOM_FIELD', true).outcome, 'PASS');
    assert.equal(engine._evaluateRef06('DELETE_VALIDATION_RULE', true).outcome, 'PASS');
  });

  it('REFUSED for DELETE without acknowledgement (bare and prefixed operations)', () => {
    assert.equal(engine._evaluateRef06('DELETE', false).outcome, 'REFUSED');
    assert.equal(engine._evaluateRef06('DELETE', null).outcome, 'REFUSED');
    // The real operation strings are DELETE_* variants — these must refuse too
    // (previously the gate silently passed because 'DELETE_CUSTOM_FIELD' !== 'DELETE').
    assert.equal(engine._evaluateRef06('DELETE_CUSTOM_FIELD', false).outcome, 'REFUSED');
    assert.equal(engine._evaluateRef06('DELETE_CUSTOM_OBJECT', null).outcome, 'REFUSED');
    assert.equal(engine._evaluateRef06('DELETE_APEX_CLASS', false).outcome, 'REFUSED');
    assert.equal(engine._evaluateRef06('DELETE_PERMISSION_SET', undefined).outcome, 'REFUSED');
  });
});

describe('REF-07: Production Mode Gating', () => {
  it('PASS for sandbox regardless of productionMode', () => {
    assert.equal(engine._evaluateRef07('sandbox', false).outcome, 'PASS');
    assert.equal(engine._evaluateRef07('sandbox', true).outcome, 'PASS');
  });

  it('PASS for production WITH productionMode enabled', () => {
    assert.equal(engine._evaluateRef07('production', true).outcome, 'PASS');
  });

  it('REFUSED for production WITHOUT productionMode', () => {
    assert.equal(engine._evaluateRef07('production', false).outcome, 'REFUSED');
    assert.equal(engine._evaluateRef07('production', null).outcome, 'REFUSED');
  });
});

describe('REF-08: No Managed Package Components', () => {
  it('PASS when namespace is empty string', () => {
    assert.equal(engine._evaluateRef08('').outcome, 'PASS');
  });

  it('PASS when namespace is null/undefined', () => {
    assert.equal(engine._evaluateRef08(null).outcome, 'PASS');
    assert.equal(engine._evaluateRef08(undefined).outcome, 'PASS');
  });

  it('REFUSED when a namespace prefix is present', () => {
    assert.equal(engine._evaluateRef08('SFDC').outcome, 'REFUSED');
  });
});

describe('REF-09: Skill Lock Hash Integrity', () => {
  it('PASS when hash is valid', () => {
    assert.equal(engine._evaluateRef09(true).outcome, 'PASS');
  });

  it('PASS when skillsLockHashValid is null/undefined (lock file absent in dev)', () => {
    assert.equal(engine._evaluateRef09(null).outcome, 'PASS');
    assert.equal(engine._evaluateRef09(undefined).outcome, 'PASS');
  });

  it('REFUSED when hash is explicitly false', () => {
    assert.equal(engine._evaluateRef09(false).outcome, 'REFUSED');
  });
});

describe('REF-10: No Unresolved Ambiguities', () => {
  it('PASS with empty ambiguity list', () => {
    assert.equal(engine._evaluateRef10([]).outcome, 'PASS');
  });

  it('PASS when ambiguities is null/undefined', () => {
    assert.equal(engine._evaluateRef10(null).outcome, 'PASS');
    assert.equal(engine._evaluateRef10(undefined).outcome, 'PASS');
  });

  it('REFUSED when unresolved ambiguities remain', () => {
    assert.equal(engine._evaluateRef10([{ id: '1', title: 'Which field?' }]).outcome, 'REFUSED');
  });
});
