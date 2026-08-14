import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// OrgForge services are first-class modules in this repo: api/src/orgforge
// (ported from the legacy OrgForge backend — no out-of-repo resolution).
const ORGFORGE_SRC = path.join(__dirname, '..', 'orgforge');

const DEFAULT_RATIONALE = 'Requested via the Forge Copilot.';
// Mirrors changes.js /intent's fallback when the org hasn't been indexed yet.
const MINIMAL_ORG_CONTEXT = { componentCount: 0, objects: [], apex: [] };

// Lazy-load cache so each service module resolves once per process.
const serviceCache = new Map();

/** Default loader — OrgForge backend is ESM, so dynamic import (not require). */
function defaultLoader(serviceFile) {
  const href = pathToFileURL(path.join(ORGFORGE_SRC, serviceFile)).href;
  if (!serviceCache.has(href)) serviceCache.set(href, import(href));
  return serviceCache.get(href);
}

/**
 * Rough org-type detection from the instance URL (unified creds lack orgType
 * today). Order matters: scratch orgs use `<name>-dev-ed.my.salesforce.com`
 * (which also ends in .salesforce.com), sandboxes use `.sandbox.` hosts or
 * test.salesforce.com — check those BEFORE the production fallback so scratch
 * and sandbox orgs aren't REF-07-refused as production.
 */
function detectOrgType(instanceUrl = '') {
  if (/-dev-ed\./i.test(instanceUrl)) return 'scratch';
  if (/\.sandbox\./i.test(instanceUrl) || /\.test\.salesforce\.com/i.test(instanceUrl)) return 'sandbox';
  if (/\.salesforce\.com$/i.test(instanceUrl)) return 'production';
  return 'scratch';
}

/**
 * Compact replica of changes.js `mapOperationToArtifact` — same path rules for
 * the supported operations, without importing the route module (which would
 * spin up Redis/BullMQ at import time). Object/field names come from the
 * generated XML or the structured intent, mirroring `deriveObjectName` /
 * `deriveFieldName`'s precedence.
 */
function mapArtifact(operation, targetComponent, xml, targetField) {
  const fieldNameFromXml = (xml || '').replace(/<!--[\s\S]*?-->/g, '').match(/<fullName[^>]*>([\s\S]*?)<\/fullName>/i)?.[1]?.trim();
  const dotIndex = targetComponent.indexOf('.');
  const objectName = dotIndex > 0 ? targetComponent.slice(0, dotIndex) : targetComponent;
  const fieldName = fieldNameFromXml || targetField || 'NewField__c';

  if (/VALIDATION_RULE$/.test(operation)) {
    return operation.startsWith('DELETE')
      ? { filePath: 'force-app/main/default/destructiveChanges.xml', metadataType: 'ValidationRule', artifactName: `${targetComponent}_Rule` }
      : { filePath: `force-app/main/default/objects/${targetComponent}/validationRules/${targetComponent}_Rule.validationRule-meta.xml`, metadataType: 'ValidationRule', artifactName: `${targetComponent}_Rule` };
  }
  if (/CUSTOM_FIELD$/.test(operation)) {
    const fullName = `${objectName}.${fieldName}`;
    return operation.startsWith('DELETE')
      ? { filePath: 'force-app/main/default/destructiveChanges.xml', metadataType: 'CustomField', artifactName: fullName }
      : { filePath: `force-app/main/default/objects/${objectName}/fields/${fieldName}.field-meta.xml`, metadataType: 'CustomField', artifactName: fullName };
  }
  if (/CUSTOM_OBJECT$/.test(operation)) {
    return operation.startsWith('DELETE')
      ? { filePath: 'force-app/main/default/destructiveChanges.xml', metadataType: 'CustomObject', artifactName: targetComponent }
      : { filePath: `force-app/main/default/objects/${targetComponent}/${targetComponent}.object-meta.xml`, metadataType: 'CustomObject', artifactName: targetComponent };
  }
  if (/APEX_CLASS$/.test(operation)) {
    return { filePath: `force-app/main/default/classes/${targetComponent}.cls`, metadataType: 'ApexClass', artifactName: targetComponent };
  }
  if (/APEX_TRIGGER$/.test(operation)) {
    return { filePath: `force-app/main/default/triggers/${targetComponent}.trigger`, metadataType: 'ApexTrigger', artifactName: targetComponent };
  }
  if (/PERMISSION_SET$/.test(operation)) {
    const name = `${targetComponent}_PermissionSet`;
    return { filePath: `force-app/main/default/permissionsets/${name}.permissionset-meta.xml`, metadataType: 'PermissionSet', artifactName: name };
  }
  if (/FLOW$/.test(operation)) {
    const name = `${targetComponent}_Flow`;
    return { filePath: `force-app/main/default/flows/${name}.flow-meta.xml`, metadataType: 'Flow', artifactName: name };
  }
  if (/CUSTOM_TAB$/.test(operation)) {
    const name = targetComponent.endsWith('__c') ? targetComponent : `${targetComponent}__c`;
    return { filePath: `force-app/main/default/tabs/${name}.tab-meta.xml`, metadataType: 'CustomTab', artifactName: name };
  }
  if (/SHARING_RULE$/.test(operation)) {
    return { filePath: `force-app/main/default/sharingRules/${targetComponent}.sharingRules-meta.xml`, metadataType: 'SharingRules', artifactName: targetComponent };
  }
  if (/RECORD_TYPE$/.test(operation)) {
    const name = `${targetComponent}_RecordType`;
    return { filePath: `force-app/main/default/objects/${targetComponent}/recordTypes/${name}.recordType-meta.xml`, metadataType: 'RecordType', artifactName: `${targetComponent}.${name}` };
  }
  if (/LIST_VIEW$/.test(operation)) {
    const name = `${targetComponent}_ListView`;
    return { filePath: `force-app/main/default/objects/${targetComponent}/listViews/${name}.listView-meta.xml`, metadataType: 'ListView', artifactName: `${targetComponent}.${name}` };
  }
  const err = new Error(`Operation "${operation}" is not supported for artifact generation.`);
  err.status = 400;
  throw err;
}

/** Bounded deploy-status polling (mirrors the OrgForge poll window, 30 × 2s). */
async function pollDeploy(transport, accessToken, instanceUrl, deploymentId) {
  const MAX_TRIES = 30;
  for (let i = 0; i < MAX_TRIES; i += 1) {
    const status = await transport.pollDeployStatus(accessToken, instanceUrl, deploymentId);
    if (['Succeeded', 'Failed', 'Canceled'].includes(status?.status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { status: 'Failed', errorMessage: 'Deployment polling timed out.' };
}

/**
 * Org-change engine adapter (plan §10.1, §6.3) — drives the org-change
 * pipeline from the Copilot and emits the unified SSE card events.
 *
 * Pipeline (mirrors OrgForge's specialist flow): parse intent → generate
 * artifact → blast radius → refusal gates → dry-run → deploy → signed record.
 * Each stage is guarded: if a dependency is missing (AI key, live Salesforce,
 * HMAC_SECRET, unsupported operation) the engine emits an honest gap card and
 * stops — it never fakes a deployment. Refusals (gate REFUSED / dry-run
 * failure) stop before any live deploy.
 *
 * Services are loaded lazily from OrgForge (ESM — dynamic import, not the CJS
 * compat loader) so tests inject fakes and the API boots without the engine.
 *
 * @param {object} [opts]
 * @param {(serviceFile: string) => Promise<object>} [opts.loader] - injectable
 */
export function createOrgEngine({ loader = defaultLoader } = {}) {
  const load = async (file) => {
    const mod = await loader(file);
    return mod?.default ?? mod;
  };

  const gap = (onEvent, stage, action) => (err) => {
    const reason = err?.message || String(err);
    onEvent({ type: 'status', content: `${action}: ${reason}` });
    onEvent({
      type: 'deploy_warning',
      content: `${action}. The pipeline stopped before any deployment: ${reason}`,
      summary: `${stage} unavailable`,
    });
    return { role: 'assistant', content: `${stage} step unavailable.` };
  };

  return {
    /**
     * Runs one org-change request end-to-end. Emits status + card events
     * through `onEvent`; returns a short `{role, content}` handshake.
     *
     * @param {object} opts
     * @param {string} opts.message - the user prompt (post-routing)
     * @param {string} opts.sessionKey - `${orgId}|${sessionId}` conversation key
     * @param {object} opts.creds - {accessToken, instanceUrl} from the route
     * @param {string} [opts.userId] - Supabase user id (audit record owner)
     * @param {string} [opts.orgId] - Salesforce org id (audit record scope)
     * @param {string} [opts.priorContext] - bounded digest of earlier turns in
     *   THIS session (context-memory pass). Injected into intent parsing and
     *   metadata generation only — never into the audit record, which keeps
     *   the original `message`.
     * @param {(ev: object) => void} opts.onEvent
     */
    async runOrgChange({ message, sessionKey, creds, userId, orgId, priorContext, onEvent }) {
      void sessionKey;
      const { accessToken, instanceUrl } = creds || {};
      const orgType = detectOrgType(instanceUrl);

      // ── 1. Parse intent ─────────────────────────────────────────────────
      onEvent({ type: 'status', content: 'Parsing your org-change request…' });
      let structuredIntent;
      let operation;
      let targetComponent;
      try {
        const { aiOrchestrator: ai } = await load('services/aiOrchestrator.js');
        const { normalizeOperation } = await load('utils/aiSafety.js');
        structuredIntent = await ai.parseIntent(message, DEFAULT_RATIONALE, MINIMAL_ORG_CONTEXT, priorContext);
        operation = normalizeOperation(structuredIntent?.operation);
        targetComponent = structuredIntent?.targetComponent;
        if (!operation || operation === 'UNKNOWN') {
          const err = new Error('Intent could not be mapped to a supported operation. Please rephrase the request.');
          err.status = 400;
          throw err;
        }
        if (!targetComponent) {
          const err = new Error('Intent is missing a target component. Please clarify the target metadata.');
          err.status = 400;
          throw err;
        }
      } catch (err) {
        return gap(onEvent, 'Intent parsing', 'The org-change pipeline needs the AI generator (GOOGLE_AI_API_KEY) to parse and scope your request')(err);
      }

      // ── 2. Generate the artifact ───────────────────────────────────────
      let artifacts = [];
      try {
        const { aiOrchestrator: ai } = await load('services/aiOrchestrator.js');
        const { skillResolver } = await load('services/skillResolver.js');
        const skill = skillResolver.resolveSkill(operation);
        const xml = await ai.generateMetadata(skill.content, structuredIntent, message, DEFAULT_RATIONALE, priorContext);
        const mapped = mapArtifact(operation, targetComponent, xml, structuredIntent?.targetField);
        artifacts = [{ ...mapped, skillUsed: skill.skillName || skill.name || operation, skillVersion: skill.skillVersion, content: xml }];
        onEvent({
          type: 'status',
          content: `Generated ${mapped.filePath}`,
          card: 'artifact',
          payload: {
            operation,
            targetComponent,
            files: artifacts.map((a) => ({ filePath: a.filePath, metadataType: a.metadataType, fullName: a.fullName ?? a.artifactName })),
          },
        });
      } catch (err) {
        return gap(onEvent, 'Artifact generation', 'The metadata artifact could not be generated')(err);
      }

      // ── 3. Blast radius ────────────────────────────────────────────────
      let impactBrief = null;
      try {
        const { impactAnalyzer } = await load('services/impactAnalyzer.js');
        const intentData = {
          structured_intent: structuredIntent,
          org_id: orgId,
          prompt: message,
          business_rationale: DEFAULT_RATIONALE,
        };
        impactBrief = await impactAnalyzer.computeImpact(intentData, accessToken, instanceUrl);
        onEvent({
          type: 'status',
          content: `Blast radius: ${impactBrief?.blastRadiusClassification || 'unknown'}`,
          card: 'blast_radius',
          payload: impactBrief,
        });
      } catch (err) {
        return gap(onEvent, 'Blast radius', 'Impact analysis needs live Salesforce access to this org')(err);
      }

      // ── 4. Refusal gates ───────────────────────────────────────────────
      let gateEval;
      try {
        const { refusalGateEngine } = await load('services/refusalGateEngine.js');
        gateEval = refusalGateEngine.evaluateGates({
          impactData: impactBrief,
          deployDryRunData: null,
          codeAnalyzerData: { violations: [] },
          approverIdentity: null, // no named approver in the chat flow — REF-04 passes for non-access ops
          orgType,
          productionMode: false, // chat flow never silently enables production mode (REF-07)
          targetComponentNamespace: structuredIntent?.namespacePrefix || '',
          skillsLockHashValid: null,
          ambiguities: structuredIntent?.ambiguities || [],
          operation,
          rollbackAcknowledged: false,
        });
        const refused = (gateEval.results || []).filter((r) => r.outcome === 'REFUSED');
        // The chat must state exactly which gates refused and why — never a
        // bare "refused" with the reasons only buried in a card payload.
        // Each line reads as: gate code — plain-language reason + unblock path.
        // Gate codes always come from the engine, but guard like the card
        // renderer does (`|| 'gate'`) so a partial result can't print "undefined".
        const gateCodeOf = (r) => r.gateCode || 'gate';
        const refusalLines = refused.map((r) => {
          const reason = r.plainLanguageReason || 'Refused';
          return `• ${gateCodeOf(r)}: ${reason}${r.unblockPath ? ` Unblock: ${r.unblockPath}` : ''}`;
        });
        onEvent({
          type: 'status',
          content: gateEval.gateOutcome === 'PASS'
            ? 'All refusal gates passed.'
            : `Blocked by ${refused.length} refusal gate${refused.length === 1 ? '' : 's'}: ${refused.map(gateCodeOf).join(', ')}.`,
          card: 'refusal_gates',
          payload: { gateOutcome: gateEval.gateOutcome, results: gateEval.results || [] },
        });
        if (gateEval.gateOutcome !== 'PASS') {
          const refusalBody = refusalLines.length > 0 ? `\n${refusalLines.join('\n')}` : '';
          onEvent({
            type: 'deploy_warning',
            content: refused.length > 0
              ? `This change was refused by ${refused.length} refusal gate${refused.length === 1 ? '' : 's'} — no deployment was attempted.${refusalBody}`
              : 'The refusal gates did not pass — no deployment was attempted.',
            summary: refused.length > 0
              ? `Blocked by ${refused.length} refusal gate${refused.length === 1 ? '' : 's'}`
              : 'Blocked by refusal gates',
          });
          return {
            role: 'assistant',
            content: refused.length > 0
              ? `Org change refused by gates: ${refused.map((r) => `${gateCodeOf(r)} (${r.plainLanguageReason || 'refused'})`).join('; ')}.`
              : 'Org change refused by gates.',
          };
        }
      } catch (err) {
        return gap(onEvent, 'Refusal gates', 'Refusal-gate evaluation failed')(err);
      }

      // ── 5. Dry-run (checkOnly) ─────────────────────────────────────────
      let dryRunId = null;
      try {
        const { metadataTransport } = await load('services/metadataTransport.js');
        const zipBuffer = metadataTransport.assembleDeploymentZip(artifacts);
        const queued = await metadataTransport.deployCheckOnly(accessToken, instanceUrl, zipBuffer);
        dryRunId = queued.deploymentId;
        const status = await pollDeploy(metadataTransport, accessToken, instanceUrl, dryRunId);
        const errors = Array.isArray(status?.errors) ? status.errors : status?.errorMessage ? [{ problem: status.errorMessage }] : [];
        if (status?.status !== 'Succeeded') {
          onEvent({
            type: 'status',
            content: 'Dry run failed — the change was not deployed.',
            card: 'dry_run',
            payload: { deploymentId: dryRunId, status: status?.status || 'Failed', success: false, errors },
          });
          onEvent({ type: 'deploy_warning', content: 'Dry run failed — the change was not deployed.', summary: 'Dry run failed' });
          return { role: 'assistant', content: 'Org change dry run failed.' };
        }
        onEvent({
          type: 'status',
          content: 'Dry run passed — safe to deploy.',
          card: 'dry_run',
          payload: { deploymentId: dryRunId, status: 'Succeeded', success: true, errors: [] },
        });
      } catch (err) {
        return gap(onEvent, 'Dry run', 'The dry run could not reach Salesforce (live connection needed)')(err);
      }

      // ── 6. Deploy ──────────────────────────────────────────────────────
      let deploymentId = null;
      try {
        const { metadataTransport } = await load('services/metadataTransport.js');
        const zipBuffer = metadataTransport.assembleDeploymentZip(artifacts);
        const queued = await metadataTransport.deployFinal(accessToken, instanceUrl, zipBuffer);
        deploymentId = queued.deploymentId;
        const status = await pollDeploy(metadataTransport, accessToken, instanceUrl, deploymentId);
        const success = status?.status === 'Succeeded';
        const errors = Array.isArray(status?.errors) ? status.errors : status?.errorMessage ? [{ problem: status.errorMessage }] : [];
        onEvent({
          type: success ? 'deploy_success' : 'deploy_warning',
          content: success ? `Deployed to ${instanceUrl}` : `Deployment ended with ${status?.status || 'failure'}`,
          summary: success ? 'Deployment succeeded' : 'Deployment failed',
          card: 'deploy',
          payload: { deploymentId, status: status?.status || 'Failed', success, errors },
        });
        if (!success) return { role: 'assistant', content: 'Org change deployment failed.' };
      } catch (err) {
        return gap(onEvent, 'Deploy', 'The deployment could not reach Salesforce (live connection needed)')(err);
      }

      // ── 7. Signed audit record ─────────────────────────────────────────
      try {
        const { changeRecordService } = await load('services/changeRecordService.js');
        const secret = process.env.HMAC_SECRET;
        const record = changeRecordService.assembleChangeRecord(
          `cs_${Date.now()}`,
          null,
          deploymentId,
          null,
          message,
          DEFAULT_RATIONALE,
          userId,
          orgId,
          null,
          {
            dryRunId,
            impactBrief,
            gateResults: gateEval.results || [],
            skillsUsed: artifacts.map((a) => a.skillUsed).filter(Boolean),
            artifacts,
          }
        );
        // exportAndPersist signs internally (fail-loud on a missing
        // HMAC_SECRET) and RETURNS the signed record with the final git hash —
        // use that single hash everywhere so the displayed signature exactly
        // matches the persisted one (double-signing would mismatch).
        const persisted = await changeRecordService.exportAndPersist(record, secret);
        onEvent({
          type: 'status',
          content: 'Signed audit record created.',
          card: 'record',
          payload: {
            persisted: true,
            id: record.id,
            intent: record.intent,
            signatureHash: persisted?.signatureHash || null,
            gitCommitHash: persisted?.gitCommitHash || null,
          },
        });
      } catch (err) {
        onEvent({
          type: 'deploy_warning',
          content: `Deployment succeeded, but the audit record could not be persisted: ${err?.message || err}`,
          summary: 'Audit record not saved',
        });
        onEvent({
          type: 'status',
          content: 'Audit record could not be signed/persisted.',
          card: 'record',
          payload: { persisted: false, reason: err?.message || String(err) },
        });
      }

      return { role: 'assistant', content: 'Org change complete.' };
    },
  };
}

export const orgEngine = createOrgEngine();
