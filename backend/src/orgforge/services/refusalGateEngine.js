export class RefusalGateEngine {
  /**
   * Evaluates all 10 REF gates.
   */
  evaluateGates(changeSetContext) {
    const { 
      impactData, 
      deployDryRunData, 
      codeAnalyzerData, 
      approverIdentity, 
      orgType, 
      productionMode,
      targetComponentNamespace,
      skillsLockHashValid,
      ambiguities
    } = changeSetContext;

    const results = [];

    // REF-01
    results.push(this._evaluateRef01(impactData));
    // REF-02
    results.push(this._evaluateRef02(deployDryRunData));
    // REF-03
    results.push(this._evaluateRef03(codeAnalyzerData));
    // REF-04
    results.push(this._evaluateRef04(changeSetContext.operation, approverIdentity));
    // REF-05
    results.push(this._evaluateRef05(impactData?.dataImpact));
    // REF-06
    results.push(this._evaluateRef06(changeSetContext.operation, changeSetContext.rollbackAcknowledged));
    // REF-07
    results.push(this._evaluateRef07(orgType, productionMode));
    // REF-08
    results.push(this._evaluateRef08(targetComponentNamespace));
    // REF-09
    results.push(this._evaluateRef09(skillsLockHashValid));
    // REF-10
    results.push(this._evaluateRef10(ambiguities));

    const gateOutcome = results.some(r => r.outcome === 'REFUSED') ? 'REFUSED' : 'PASS';

    return { gateOutcome, results };
  }

  _evaluateRef01(impactData) {
    // analysisComplete is set by impactAnalyzer.computeImpact: false when any
    // blast-radius dimension (dependency / data / permission / integration)
    // failed to run. Passing on an incomplete brief would violate Hard Rule 2.
    if (!impactData || impactData.error || impactData.analysisComplete === false) {
      const reasons = [];
      if (impactData?.dependencyImpact?.analysisComplete === false) {
        reasons.push(`Dependency analysis incomplete${impactData.dependencyImpact.reason ? ` (${impactData.dependencyImpact.reason})` : ''}`);
      }
      if (impactData?.dataImpact?.analysisComplete === false) {
        reasons.push(`Data violation scan incomplete${impactData.dataImpact.reason ? ` (${impactData.dataImpact.reason})` : ''}`);
      }
      if (impactData?.permissionImpact?.analysisComplete === false) {
        reasons.push(`Permission impact scan incomplete${impactData.permissionImpact.reason ? ` (${impactData.permissionImpact.reason})` : ''}`);
      }
      if (impactData?.integrationImpact?.analysisComplete === false) {
        reasons.push(`Integration scan incomplete${impactData.integrationImpact.reason ? ` (${impactData.integrationImpact.reason})` : ''}`);
      }
      const detail = reasons.length > 0 ? reasons.join('. ') : (impactData?.error || 'Incomplete blast radius data');
      return {
        gateCode: 'REF-01',
        outcome: 'REFUSED',
        plainLanguageReason: `Impact analysis failed or returned incomplete data: ${detail}.`,
        missingEvidence: 'Complete blast radius data across dependencies, data, and permissions.',
        unblockPath: 'Retry impact analysis or verify Salesforce API permissions.'
      };
    }
    return { gateCode: 'REF-01', outcome: 'PASS' };
  }

  _evaluateRef02(deployDryRunData) {
    if (deployDryRunData?.componentFailures?.length > 0) {
      return { gateCode: 'REF-02', outcome: 'REFUSED', plainLanguageReason: 'Metadata dry-run failed.', missingEvidence: 'Successful checkOnly deployment.', unblockPath: 'Fix metadata errors.' };
    }
    return { gateCode: 'REF-02', outcome: 'PASS' };
  }

  _evaluateRef03(codeAnalyzerData) {
    if (codeAnalyzerData?.hasHighViolations) {
      // Name the offending rules so the operator knows exactly what to fix
      // (e.g. "ApexSOQLInjection, AvoidHardcodedCredentials").
      const rules = [...new Set((codeAnalyzerData.violations || []).map(v => v.rule))];
      const detail = rules.length > 0 ? rules.join(', ') : 'unknown rule';
      return {
        gateCode: 'REF-03',
        outcome: 'REFUSED',
        plainLanguageReason: `Generated Apex violates blocking static-analysis rules: ${detail}.`,
        missingEvidence: 'Clean code analyzer report.',
        unblockPath: 'Regenerate with secure templates or fix the flagged violations, then re-run the evaluation.'
      };
    }
    return { gateCode: 'REF-03', outcome: 'PASS' };
  }

  _evaluateRef04(operation, approverIdentity) {
    if (operation && operation.includes('PERMISSION') && !approverIdentity) {
      return { gateCode: 'REF-04', outcome: 'REFUSED', plainLanguageReason: 'Permission changes require an approver.', missingEvidence: 'approverIdentity is absent.', unblockPath: 'Provide approver email.' };
    }
    return { gateCode: 'REF-04', outcome: 'PASS' };
  }

  _evaluateRef05(dataImpact) {
    if (dataImpact?.violatingRecordsCount > 0) {
      return { gateCode: 'REF-05', outcome: 'REFUSED', plainLanguageReason: `${dataImpact.violatingRecordsCount} existing records violate this rule.`, missingEvidence: 'Zero violating records.', unblockPath: 'Clean up data before deploying.' };
    }
    return { gateCode: 'REF-05', outcome: 'PASS' };
  }

  _evaluateRef06(operation, rollbackAcknowledged) {
    // Operations are `DELETE_*` variants (DELETE_CUSTOM_FIELD, …), not the bare
    // 'DELETE' string — match the prefix so the gate can actually fire.
    const isDestructive = typeof operation === 'string' && operation.startsWith('DELETE');
    if (isDestructive && !rollbackAcknowledged) {
      return { gateCode: 'REF-06', outcome: 'REFUSED', plainLanguageReason: 'Destructive changes cannot be rolled back without acknowledgement.', missingEvidence: 'Rollback acknowledgement.', unblockPath: 'Acknowledge irreversible change.' };
    }
    return { gateCode: 'REF-06', outcome: 'PASS' };
  }

  _evaluateRef07(orgType, productionMode) {
    if (orgType === 'production' && !productionMode) {
      return { gateCode: 'REF-07', outcome: 'REFUSED', plainLanguageReason: 'Cannot deploy to production without production mode enabled.', missingEvidence: 'Production mode flag.', unblockPath: 'Enable production mode.' };
    }
    return { gateCode: 'REF-07', outcome: 'PASS' };
  }

  _evaluateRef08(targetComponentNamespace) {
    if (targetComponentNamespace && targetComponentNamespace !== '') {
      return { gateCode: 'REF-08', outcome: 'REFUSED', plainLanguageReason: 'Cannot modify managed package components.', missingEvidence: 'Component must be unpackaged.', unblockPath: 'Select unmanaged component.' };
    }
    return { gateCode: 'REF-08', outcome: 'PASS' };
  }

  _evaluateRef09(skillsLockHashValid) {
    if (skillsLockHashValid === false) {
      return { gateCode: 'REF-09', outcome: 'REFUSED', plainLanguageReason: 'Skill definition hash drifted from skills-lock.json.', missingEvidence: 'Matching skill hash.', unblockPath: 'Update skills-lock.json.' };
    }
    return { gateCode: 'REF-09', outcome: 'PASS' };
  }

  _evaluateRef10(ambiguities) {
    if (Array.isArray(ambiguities) && ambiguities.length > 0) {
      const options = ambiguities.map((a, i) => {
        if (typeof a === 'object' && a !== null) {
          return {
            id: a.id || `opt${i + 1}`,
            title: a.title || `Option ${i + 1}`,
            desc: a.desc || '',
            recommended: Boolean(a.recommended || i === 0),
          };
        }
        return {
          id: `opt${i + 1}`,
          title: String(a),
          desc: '',
          recommended: i === 0,
        };
      });

      const titles = options.map((o, idx) => `Option ${idx + 1} (${o.title})`).join(' vs ');
      const suggestion = options[0]?.title || 'Option 1';

      return {
        gateCode: 'REF-10',
        outcome: 'REFUSED',
        plainLanguageReason: `Clarification needed: Choose between ${titles}`,
        missingEvidence: 'Your preferred option for rule enforcement.',
        unblockPath: `Select ${suggestion} on the card above, or specify your preference in chat.`,
        options,
      };
    }
    return { gateCode: 'REF-10', outcome: 'PASS' };
  }
}

export const refusalGateEngine = new RefusalGateEngine();
