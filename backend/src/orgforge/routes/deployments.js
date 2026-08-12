import express from 'express';
import { z } from 'zod';
import AdmZip from 'adm-zip';
import { createAuthMiddleware, tenantIsolation } from '@forge/auth';
const requireAuth = createAuthMiddleware();
import { streamLimiter } from '../middleware/rateLimiter.js';
import { metadataTransport } from '../services/metadataTransport.js';
import { changeRecordService } from '../services/changeRecordService.js';
import { rollbackService } from '../services/rollbackService.js';
import { getOrgCredentials } from '../services/orgCredentials.js';
import { redisConnection, deploymentQueue } from '../jobs/queue.js';

const router = express.Router();
router.use(requireAuth, tenantIsolation);

// Boundary validation: every external input is validated at the route edge
// before it can reach Salesforce or the database.
const artifactSchema = z.object({
  filePath: z.string().min(1).max(500),
  metadataType: z.string().min(1).max(100),
  fullName: z.string().min(1).max(300).optional(),
  skillUsed: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(2_000_000)
});

const dryRunSchema = z.object({
  changeSetId: z.string().max(200).optional(),
  orgId: z.string().min(1),
  artifacts: z.array(artifactSchema).min(1).max(50)
});

const backupSchema = z.object({
  intentId: z.string().uuid().optional(),
  orgId: z.string().min(1),
  artifacts: z.array(artifactSchema).min(1).max(50)
});

const executeSchema = z.object({
  changeSetId: z.string().min(1).max(200),
  approverIdentity: z.string().email().optional(),
  productionMode: z.boolean().optional(),
  orgId: z.string().min(1),
  intentId: z.string().uuid().optional(),
  intent: z.string().max(20000).optional(),
  businessRationale: z.string().max(20000).optional(),
  // Evidence captured earlier in the pipeline (PRD Hard Rule 1): the audit
  // record stores what was shown to the human operator.
  dryRunId: z.string().max(255).optional(),
  impactBrief: z.record(z.unknown()).optional(),
  gateResults: z.array(z.record(z.unknown())).max(50).optional(),
  artifacts: z.array(artifactSchema).min(1).max(50)
});

const statusQuerySchema = z.object({
  orgId: z.string().min(1)
});

const backupStatusSchema = z.object({
  intentId: z.string().uuid().optional(),
  orgId: z.string().min(1)
});

/**
 * Normalizes route errors: validation errors get 400 with issues, expected
 * client errors (err.status set) keep their message, and unexpected server
 * errors return a generic message so internals never leak to the client.
 */
function handleRouteError(res, err, fallback) {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: 'Validation failed', issues: err.errors });
  }
  const status = err.status || 500;
  // Server-class errors (>500) return the sanitized fallback so internal
  // details (Salesforce internals, Redis errors, stack fragments) never
  // reach the client. Only explicitly-marked client errors (err.status < 500)
  // surface their message.
  if (status >= 500) {
    return res.status(500).json({ error: fallback });
  }
  return res.status(status).json({ error: err.message || fallback });
}

router.post('/dry-run', async (req, res) => {
  try {
    const { artifacts, orgId } = dryRunSchema.parse(req.body);
    const { accessToken, instanceUrl } = await getOrgCredentials(req.supabaseClient, req.user.id, orgId);

    const zipBuffer = metadataTransport.assembleDeploymentZip(artifacts);

    // Traceability: record exactly what was packaged (and where each file
    // landed in the zip) so a rejected deployment can be matched back to the
    // submitted artifacts — e.g. a stale artifact with an unexpected filePath.
    const debugZip = new AdmZip(zipBuffer);
    const packageEntries = debugZip.getEntries().map(e => e.entryName);
    console.log('Dry-run package assembled:', JSON.stringify({
      artifacts: artifacts.map(a => ({ filePath: a.filePath, metadataType: a.metadataType, fullName: a.fullName || null })),
      packageEntries
    }));

    const result = await metadataTransport.deployCheckOnly(accessToken, instanceUrl, zipBuffer);
    
    // Cache the intentId so we can log ai_logs on failure in the status route
    if (req.body.changeSetId) {
      await setDeployMeta(result.deploymentId, { intentId: req.body.changeSetId, isDryRun: true });
    }
    
    res.json({ deploymentId: result.deploymentId, status: 'Queued', packageEntries });
  } catch (err) {
    console.error('Dry-run failed:', err.message);
    handleRouteError(res, err, 'Dry-run failed');
  }
});

router.get('/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { orgId } = statusQuerySchema.parse(req.query);
    const { accessToken, instanceUrl } = await getOrgCredentials(req.supabaseClient, req.user.id, orgId);

    const statusResult = await metadataTransport.pollDeployStatus(accessToken, instanceUrl, id);

    // Normalizing componentFailures array just in case
    if (statusResult.componentFailures && !Array.isArray(statusResult.componentFailures)) {
      statusResult.componentFailures = [statusResult.componentFailures];
    }

    if (statusResult.status === 'Failed') {
      const meta = await getDeployMeta(id);
      if (meta && meta.isDryRun && meta.intentId) {
        // Attempt to claim to avoid logging the same error multiple times on repeated polling
        const claimed = await redisConnection.del(`orgforge:deploy:meta:${id}`);
        if (claimed > 0) {
          // checkDeployStatus returns componentFailures (may be an empty array)
          // and stateDetail; it has no errorMessage field.
          const dryRunErrors =
            Array.isArray(statusResult.componentFailures) && statusResult.componentFailures.length > 0
              ? statusResult.componentFailures
              : [{ problem: statusResult.stateDetail || 'Unknown MDAPI Error' }];
          const { error: insertError } = await req.supabaseClient.from('ai_logs').insert({
            intent_id: meta.intentId,
            dry_run_errors: dryRunErrors,
            ai_repair_attempts: 1 // Denotes it failed at least once
          });
          if (insertError) {
            // Never lose the failure trace silently: restore the claim so a
            // later status poll (or another server instance) can retry.
            console.error('Failed to log dry-run failure to ai_logs:', insertError.message);
            await setDeployMeta(id, meta);
          }
        }
      }
    } else if (statusResult.status === 'Succeeded' || statusResult.status === 'Canceled') {
      const meta = await getDeployMeta(id);
      if (meta && meta.isDryRun) {
        await redisConnection.del(`orgforge:deploy:meta:${id}`);
      }
    }

    res.json(statusResult);
  } catch (err) {
    console.error('Status check failed:', err.message);
    handleRouteError(res, err, 'Status check failed');
  }
});

router.post('/backup', async (req, res) => {
  try {
    const { intentId, artifacts, orgId } = backupSchema.parse(req.body);
    const { accessToken, instanceUrl } = await getOrgCredentials(req.supabaseClient, req.user.id, orgId);

    // REF-06 Destructive change detection (simple heuristic)
    const isDestructive = artifacts.some(a =>
      (a.filePath && a.filePath.toLowerCase().includes('destructive')) ||
      (typeof a.content === 'string' && a.content.includes('<members>'))
    );

    const result = await metadataTransport.retrieveBackup(accessToken, instanceUrl, artifacts);
    res.json({ retrieveId: result.retrieveId, status: 'Queued', isDestructive });
  } catch (err) {
    console.error('Backup retrieve failed:', err.message);
    handleRouteError(res, err, 'Backup retrieve failed');
  }
});

router.post('/backup/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { intentId, orgId } = backupStatusSchema.parse(req.body);
    const { accessToken, instanceUrl } = await getOrgCredentials(req.supabaseClient, req.user.id, orgId);

    const statusResult = await metadataTransport.pollRetrieveStatus(accessToken, instanceUrl, id);

    if (statusResult.status === 'Succeeded' && statusResult.zipFile) {
      // Upload the pre-change backup to Supabase Storage and capture the path.
      const rollbackInfo = await rollbackService.captureRollbackBundle(intentId || 'unknown', statusResult.zipFile);
      // Remove raw zipFile from the payload — it can be several MB and is now
      // persisted in storage; sending it to the browser would be wasteful.
      delete statusResult.zipFile;
      statusResult.rollbackInfo = rollbackInfo;

      // Persist the storage path into the change_intents row so the deploy
      // execute route can look it up when creating the change record, and the
      // rollback route can find it via change_records.rollback_bundle_ref.
      // Tenant-scoped: the request client uses the service role key, so RLS is
      // not a backstop — the user filter comes from the verified token.
      if (intentId) {
        await req.supabaseClient
          .from('change_intents')
          .update({ rollback_bundle_ref: rollbackInfo.storagePath })
          .eq('id', intentId)
          .eq('user_id', req.tenantId);
      }
    }

    res.json(statusResult);
  } catch (err) {
    console.error('Backup status check failed:', err.message);
    handleRouteError(res, err, 'Backup status check failed');
  }
});

const DEPLOY_META_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Redis-backed deploy metadata cache.
 * Stores the context needed to create a change record when an SSE stream
 * detects a 'Succeeded' status. Using Redis means the data survives restarts
 * and is visible to all server instances.
 */
async function setDeployMeta(deploymentId, meta) {
  await redisConnection.set(
    `orgforge:deploy:meta:${deploymentId}`,
    JSON.stringify(meta),
    'EX',
    DEPLOY_META_TTL_SECONDS
  );
}

async function getDeployMeta(deploymentId) {
  const raw = await redisConnection.get(`orgforge:deploy:meta:${deploymentId}`);
  return raw ? JSON.parse(raw) : null;
}

router.post('/execute', async (req, res) => {
  try {
    const { changeSetId, approverIdentity, productionMode, artifacts, intent, businessRationale, orgId, intentId, dryRunId, impactBrief, gateResults } =
      executeSchema.parse(req.body);

    // REF-07 Production Gate Check
    if (productionMode && !approverIdentity) {
      return res.status(400).json({ error: 'Production deployments require an authorized approver identity (REF-07)' });
    }

    const { accessToken, instanceUrl, orgType } = await getOrgCredentials(req.supabaseClient, req.user.id, orgId);

    // REF-07: refuse production deploys unless production mode is explicitly enabled
    if (orgType === 'production' && !productionMode) {
      return res.status(400).json({ error: 'Production deployments require production mode enabled (REF-07)' });
    }

    // Final deploy — production orgs must run Apex tests (PRD FR-37 test-level
    // selection); sandbox/scratch deploys skip tests for speed.
    const zipBuffer = metadataTransport.assembleDeploymentZip(artifacts);
    const testLevel = orgType === 'production' ? 'RunLocalTests' : 'NoTestRun';
    const deployResult = await metadataTransport.deployFinal(accessToken, instanceUrl, zipBuffer, testLevel);

    // Evidence for the change record (PRD Hard Rule 1): skills used are
    // derived server-side from the shipped artifacts.
    const skillsUsed = [...new Set(artifacts.map(a => a.skillUsed).filter(Boolean))];

    // Cache metadata in Redis for the worker and SSE stream
    await setDeployMeta(deployResult.deploymentId, {
      changeSetId,
      approverIdentity: approverIdentity || 'unknown',
      intent,
      businessRationale,
      userId: req.user.id,
      orgId,
      intentId: intentId || null,
      dryRunId: dryRunId || null,
      impactBrief: impactBrief || null,
      gateResults: gateResults || null,
      skillsUsed,
      artifacts
    });

    // Enqueue the background polling job to guarantee audit log creation.
    // The full context rides in the job payload: the worker uses it to resolve
    // org credentials and (as a fallback) to assemble the change record if the
    // Redis meta key has expired before the deployment finishes. The Redis key
    // remains the claim token that coordinates with the SSE stream, so only
    // one of them creates the record.
    // Retries are safe: the worker's claim (DEL of the Redis meta key) plus its
    // DB reconcile make record creation idempotent, so a transient poll or
    // persistence failure re-runs into the "create from job payload" path
    // instead of silently losing the audit record.
    await deploymentQueue.add('poll-deployment', {
      deploymentId: deployResult.deploymentId,
      changeSetId,
      approverIdentity: approverIdentity || 'unknown',
      intent: intent || null,
      businessRationale: businessRationale || null,
      userId: req.user.id,
      orgId,
      intentId: intentId || null,
      dryRunId: dryRunId || null,
      impactBrief: impactBrief || null,
      gateResults: gateResults || null,
      skillsUsed,
      artifacts
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    });

    res.json({ deploymentId: deployResult.deploymentId });
  } catch (err) {
    console.error('Execution failed:', err.message);
    handleRouteError(res, err, 'Execution failed');
  }
});

// SSE Route for live polling (bounded by the stream rate limiter)
router.get('/status-stream/:id', streamLimiter, async (req, res) => {
  const { id } = req.params;

  try {
    // Parse inside the try block: a missing/invalid orgId must produce a
    // proper 400 response — parsing outside would throw in an async handler
    // and leave the connection hanging with no response.
    const { orgId } = statusQuerySchema.parse(req.query);
    const { accessToken, instanceUrl } = await getOrgCredentials(req.supabaseClient, req.user.id, orgId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const intervalId = setInterval(async () => {
      try {
        const statusResult = await metadataTransport.pollDeployStatus(accessToken, instanceUrl, id);

        if (statusResult.status === 'Succeeded') {
          const meta = await getDeployMeta(id);
          if (meta) {
            // Attempt to claim the creation rights (atomic)
            const claimed = await redisConnection.del(`orgforge:deploy:meta:${id}`);
            if (claimed > 0) {
              try {
                const changeRecord = changeRecordService.assembleChangeRecord(
                  meta.changeSetId,
                  meta.approverIdentity,
                  id,
                  null,
                  meta.intent,
                  meta.businessRationale,
                  meta.userId,
                  meta.orgId,
                  meta.intentId,
                  {
                    dryRunId: meta.dryRunId,
                    impactBrief: meta.impactBrief,
                    gateResults: meta.gateResults,
                    skillsUsed: meta.skillsUsed,
                    artifacts: meta.artifacts
                  }
                );
                const signedRecord = await changeRecordService.exportAndPersist(
                  changeRecord,
                  process.env.HMAC_SECRET
                );
                statusResult.changeRecord = signedRecord;
              } catch (err) {
                console.error('Change record creation failed in SSE:', err.message);
                statusResult.changeRecordError = err.message;
                // If it failed, we could restore the meta so the worker can try, 
                // but the worker would also fail on the same data.
              }
            } else {
              // The worker already claimed and processed it. Fetch from DB.
              const { data: dbRecord } = await req.supabaseClient
                .from('change_records')
                .select('*')
                .eq('deployment_id', id)
                .maybeSingle();
              if (dbRecord) {
                statusResult.changeRecord = {
                  id: dbRecord.id,
                  changeSetId: meta.changeSetId,
                  approverIdentity: dbRecord.approver_identity,
                  deploymentId: dbRecord.deployment_id,
                  gitCommitHash: dbRecord.git_commit_hash,
                  intent: dbRecord.intent,
                  businessRationale: dbRecord.business_rationale,
                  userId: dbRecord.user_id,
                  orgId: dbRecord.org_id,
                  changeIntentId: dbRecord.change_intent_id,
                  dryRunId: dbRecord.dry_run_id,
                  impactBrief: dbRecord.impact_brief,
                  gateResults: dbRecord.gate_results,
                  skillsUsed: dbRecord.skills_used,
                  artifacts: dbRecord.artifacts,
                  timestamp: dbRecord.created_at,
                  signatureHash: dbRecord.signature_hash
                };
              }
            }
          } else {
            // No meta found in Redis. It might have been processed long ago.
            const { data: dbRecord } = await req.supabaseClient
              .from('change_records')
              .select('*')
              .eq('deployment_id', id)
              .maybeSingle();
            if (dbRecord) {
              statusResult.changeRecord = {
                id: dbRecord.id,
                deploymentId: dbRecord.deployment_id,
                approverIdentity: dbRecord.approver_identity,
                gitCommitHash: dbRecord.git_commit_hash,
                intent: dbRecord.intent,
                businessRationale: dbRecord.business_rationale,
                userId: dbRecord.user_id,
                orgId: dbRecord.org_id,
                changeIntentId: dbRecord.change_intent_id,
                dryRunId: dbRecord.dry_run_id,
                impactBrief: dbRecord.impact_brief,
                gateResults: dbRecord.gate_results,
                skillsUsed: dbRecord.skills_used,
                artifacts: dbRecord.artifacts,
                timestamp: dbRecord.created_at,
                signatureHash: dbRecord.signature_hash
              };
            }
          }
        }

        res.write(`data: ${JSON.stringify(statusResult)}\n\n`);

        if (statusResult.status === 'Succeeded' || statusResult.status === 'Failed' || statusResult.status === 'Canceled') {
          clearInterval(intervalId);
          res.end();
        }
      } catch (err) {
        console.error('SSE Poll Error:', err.message);
        // Never leak internal error details over the SSE stream.
        res.write(`data: ${JSON.stringify({ status: 'Error', error: 'Deployment status check failed' })}\n\n`);
        clearInterval(intervalId);
        res.end();
      }
    }, 2000);

    req.on('close', () => {
      clearInterval(intervalId);
    });
  } catch (err) {
    console.error('SSE setup failed:', err.message);
    return handleRouteError(res, err, 'Status stream failed');
  }
});

export default router;
