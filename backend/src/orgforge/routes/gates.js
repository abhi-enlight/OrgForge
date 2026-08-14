import express from 'express';
import { createAuthMiddleware, tenantIsolation } from '@forge/auth';
const requireAuth = createAuthMiddleware();
import { refusalGateEngine } from '../services/refusalGateEngine.js';
import { getOrgCredentials } from '@forge/org-connections';
import { impactAnalyzer } from '../services/impactAnalyzer.js';
import { staticAnalyzer } from '../services/staticAnalysis.js';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';

const router = express.Router();
router.use(requireAuth, tenantIsolation);

const GATE_NAMES = {
  'REF-01': 'Impact Analysis Completeness',
  'REF-02': 'Metadata Dry-Run Integrity',
  'REF-03': 'Code Analyzer Violations',
  'REF-04': 'High-Risk Operation Approver',
  'REF-05': 'Data Violation Checks',
  'REF-06': 'Destructive Change Acknowledgment',
  'REF-07': 'Production Deployment Flag',
  'REF-08': 'Managed Package Constraints',
  'REF-09': 'Skills Definition Integrity',
  'REF-10': 'Intent Ambiguity Resolution'
};

router.post('/evaluate', async (req, res) => {
  try {
    const { intentId, approverIdentity, rollbackAcknowledged, productionMode, artifacts } = req.body;

    // 1. Fetch intent from Supabase (tables live in the public schema).
    // Tenant-scoped: req.supabaseClient uses the service role key, so RLS is
    // not a backstop — the user filter comes from the verified token.
    const { data: intentData, error: intentError } = await req.supabaseClient
      .from('change_intents')
      .select('*')
      .eq('id', intentId)
      .eq('user_id', req.tenantId)
      .single();

    if (intentError || !intentData) {
      return res.status(404).json({ error: 'Intent not found' });
    }

    // 2+3. Load org credentials (with transparent token refresh)
    const { accessToken, instanceUrl, orgType } = await getOrgCredentials(
      req.supabaseClient,
      req.user.id,
      intentData.org_id
    );

    // 4. Compute impact
    const impactData = await impactAnalyzer.computeImpact(intentData, accessToken, instanceUrl);

    // 5. Static analysis (REF-03) on the generated Apex artifacts. The
    // frontend sends the Stage-4 artifacts so the gate can inspect real code;
    // non-Apex changes (validation rules, fields) produce no violations.
    const codeAnalyzerData = staticAnalyzer.analyze(Array.isArray(artifacts) ? artifacts : []);

    // 6. Build changeSetContext
    const parsedIntent = typeof intentData.structured_intent === 'string' ? JSON.parse(intentData.structured_intent) : intentData.structured_intent;

    let skillsLockHashValid = null;
    const operation = parsedIntent?.operation;

    if (operation) {
      try {
        const rootLockPath = path.join(process.cwd(), '..', 'skills-lock.json');
        const rootLockStr = await fs.readFile(rootLockPath, 'utf8');
        const rootLock = JSON.parse(rootLockStr);

        const backendLockPath = path.join(process.cwd(), 'data', 'skills-lock.json');
        const backendLockStr = await fs.readFile(backendLockPath, 'utf8');
        const backendLock = JSON.parse(backendLockStr);

        const mappedSkillName = backendLock.skills[operation];

        if (mappedSkillName && rootLock.skills[mappedSkillName]) {
          const skillEntry = rootLock.skills[mappedSkillName];
          if (skillEntry.skillPath) {
            const skillFilePath = path.join(process.cwd(), '..', skillEntry.skillPath);
            const skillFileContent = await fs.readFile(skillFilePath, 'utf8');
            const computedHash = crypto.createHash('sha256').update(skillFileContent).digest('hex');
            
            skillsLockHashValid = (computedHash === skillEntry.computedHash);
          }
        }
      } catch (err) {
        console.warn('Could not verify skills lock hash:', err.message);
      }
    }

    const changeSetContext = {
      impactData: impactData,
      deployDryRunData: null,
      codeAnalyzerData,
      approverIdentity: approverIdentity || null,
      orgType: orgType,
      // REF-07: production mode is an explicit operator signal, not derived
      // from org type. The deploy route independently enforces the same gate.
      productionMode: productionMode === true,
      targetComponentNamespace: parsedIntent?.namespacePrefix || '',
      skillsLockHashValid,
      ambiguities: parsedIntent?.ambiguities || [],
      operation: parsedIntent?.operation || '',
      rollbackAcknowledged: rollbackAcknowledged === true
    };

    const evaluation = refusalGateEngine.evaluateGates(changeSetContext);
    
    // Add human-readable names to results
    evaluation.results = evaluation.results.map(r => ({
      ...r,
      name: GATE_NAMES[r.gateCode] || r.gateCode
    }));

    // 7. Persist every refusal to refusal_logs (PRD Group 7: refusal audit
    // trail). A logging failure must never hide the refusal itself — the
    // evaluation is still returned, and the error is surfaced server-side.
    const refused = evaluation.results.filter(r => r.outcome === 'REFUSED');
    if (refused.length > 0) {
      const { error: insertErr } = await req.supabaseClient.from('refusal_logs').insert(
        refused.map(r => ({
          change_intent_id: intentId,
          gate_code: r.gateCode,
          reason: r.plainLanguageReason || `Refused by ${r.gateCode}`,
          missing_evidence: r.missingEvidence ? String(r.missingEvidence) : null,
          unblock_path: r.unblockPath || null
        }))
      );
      if (insertErr) {
        console.error('Failed to persist refusal_logs:', insertErr.message);
      }
    }

    // 7b. Audit the REF-07 production acknowledgment. refusal_logs only
    // captures REFUSED outcomes, so an operator who explicitly waives the
    // production gate (productionMode + named approver) would otherwise
    // vanish from the audit trail. Recording it as a waiver row (distinct
    // unblock_path) keeps "who acknowledged the production deploy" traceable
    // even though the gate passed.
    if (productionMode === true && approverIdentity) {
      const { error: ackErr } = await req.supabaseClient.from('refusal_logs').insert({
        change_intent_id: intentId,
        gate_code: 'REF-07',
        reason: `Production deployment acknowledged by ${approverIdentity}`,
        unblock_path: 'operator-acknowledged'
      });
      if (ackErr) {
        console.error('Failed to persist REF-07 acknowledgment:', ackErr.message);
      }
    }

    res.json(evaluation);
  } catch (error) {
    // getOrgCredentials throws 401 when the stored refresh token is dead
    // (EC-10) — discriminate so the frontend shows "Reconnect Salesforce"
    // instead of treating the 401 as a session expiry and signing out.
    if (error.status === 401) {
      return res.status(401).json({
        error: 'Reconnect this org. Salesforce access could not be refreshed',
        code: 'ORG_RECONNECT_REQUIRED',
      });
    }
    console.error('Gates Evaluation Error:', error);
    res.status(500).json({ error: 'Failed to evaluate gates' });
  }
});

export default router;
