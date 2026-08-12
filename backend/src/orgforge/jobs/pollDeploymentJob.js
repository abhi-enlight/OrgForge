import { Worker } from 'bullmq';
import { createRedisConnection } from './queue.js';
import { supabaseAdmin } from '../services/supabaseClient.js';
import { getOrgCredentials } from '../services/orgCredentials.js';
import { salesforceClient } from '../services/salesforceClient.js';
import { changeRecordService } from '../services/changeRecordService.js';

// BullMQ workers require their own connection instance when using blocking commands
const connection = createRedisConnection();

const POLL_INTERVAL_MS = 2000;
// Bound the poll loop so a deployment stuck in "Queued"/"InProgress" forever
// cannot hold a concurrency slot (concurrency: 5) and hammer the SOAP API
// every 2s for the life of the process.
const MAX_POLL_DURATION_MS = 30 * 60 * 1000; // 30 minutes

const TERMINAL_STATUSES = ['Succeeded', 'Failed', 'Canceled'];

const worker = new Worker('orgforge-deployments', async job => {
  const {
    deploymentId,
    changeSetId,
    approverIdentity,
    intent,
    businessRationale,
    userId,
    orgId,
    intentId,
    dryRunId,
    impactBrief,
    gateResults,
    skillsUsed,
    artifacts
  } = job.data;

  // The payload is the only source of truth for credentials — never rely on
  // the Redis meta key for them, since it may have expired for long deploys.
  if (!deploymentId || !userId || !orgId) {
    throw new Error(
      `poll-deployment job missing required payload fields (deploymentId=${deploymentId}, userId=${userId}, orgId=${orgId}); enqueue with the full deployment context`
    );
  }

  console.log(`Starting deployment polling for ${deploymentId}`);

  try {
    const { accessToken, instanceUrl } = await getOrgCredentials(supabaseAdmin, userId, orgId);

    let statusResult;
    const deadline = Date.now() + MAX_POLL_DURATION_MS;
    // Poll until a terminal state (bounded).
    while (true) {
      statusResult = await salesforceClient.checkDeployStatus(accessToken, instanceUrl, deploymentId);
      if (TERMINAL_STATUSES.includes(statusResult.status)) {
        break;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Deployment ${deploymentId} did not reach a terminal state within ${MAX_POLL_DURATION_MS / 60000} minutes`
        );
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (statusResult.status !== 'Succeeded') {
      console.log(`Deployment ${deploymentId} finished with status: ${statusResult.status}`);
      return { success: false, status: statusResult.status, errors: statusResult.componentFailures };
    }

    // Succeeded: create the tamper-evident change record exactly once.
    // The Redis deploy-meta key is the claim token shared with the SSE stream:
    // whoever DELETEs it first owns record creation, the other side fetches the
    // persisted row instead.
    const metaKey = `orgforge:deploy:meta:${deploymentId}`;
    const rawMeta = await connection.get(metaKey);
    let claimed = false;
    if (rawMeta) {
      claimed = (await connection.del(metaKey)) > 0;
    }

    if (claimed) {
      const meta = JSON.parse(rawMeta);
      console.log(`Deployment ${deploymentId} succeeded. Assembling change record...`);
      try {
        const changeRecord = changeRecordService.assembleChangeRecord(
          meta.changeSetId ?? changeSetId,
          meta.approverIdentity ?? approverIdentity,
          deploymentId,
          null,
          meta.intent ?? intent,
          meta.businessRationale ?? businessRationale,
          meta.userId ?? userId,
          meta.orgId ?? orgId,
          meta.intentId ?? intentId,
          {
            dryRunId: meta.dryRunId ?? dryRunId,
            impactBrief: meta.impactBrief ?? impactBrief,
            gateResults: meta.gateResults ?? gateResults,
            skillsUsed: meta.skillsUsed ?? skillsUsed,
            artifacts: meta.artifacts ?? artifacts
          }
        );
        const signedRecord = await changeRecordService.exportAndPersist(
          changeRecord,
          process.env.HMAC_SECRET
        );
        console.log(`Successfully persisted change record for deployment ${deploymentId}`);
        return { success: true, signedRecordId: signedRecord.id };
      } catch (err) {
        console.error('Change record creation failed in worker:', err);
        throw new Error(`Failed to create change record: ${err.message}`);
      }
    }

    // We did not win the claim. Reconcile against the DB so the audit record is
    // never silently missing.
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('change_records')
      .select('id')
      .eq('deployment_id', deploymentId)
      .maybeSingle();

    if (fetchError) {
      console.error(`Failed to reconcile change record for ${deploymentId}:`, fetchError.message);
      throw new Error(`Failed to reconcile change record: ${fetchError.message}`);
    }

    if (existing) {
      console.log(`Deployment ${deploymentId} change record already exists (id ${existing.id}).`);
      return { success: true, note: 'Already processed' };
    }

    if (rawMeta) {
      // The key was claimed by the SSE stream but the row is not in the DB yet —
      // the stream is mid-creation; racing it would produce a duplicate.
      console.log(`Deployment ${deploymentId} change record is being created by the SSE stream.`);
      return { success: true, note: 'Processed by SSE' };
    }

    // No meta (expired after a >1h deploy) and no row: the SSE stream is long
    // gone, so create the record from the job payload.
    console.log(`Deployment ${deploymentId} meta expired; creating change record from job payload.`);
    const changeRecord = changeRecordService.assembleChangeRecord(
      changeSetId,
      approverIdentity,
      deploymentId,
      null,
      intent,
      businessRationale,
      userId,
      orgId,
      intentId,
      {
        dryRunId,
        impactBrief,
        gateResults,
        skillsUsed,
        artifacts
      }
    );
    const signedRecord = await changeRecordService.exportAndPersist(
      changeRecord,
      process.env.HMAC_SECRET
    );
    return { success: true, signedRecordId: signedRecord.id, note: 'Created from job payload' };
  } catch (error) {
    console.error(`Deployment polling job failed for ${deploymentId}:`, error);
    throw error;
  }
}, { connection, concurrency: 5 });

worker.on('completed', job => {
  console.log(`Deployment job ${job.id} completed.`);
});

worker.on('failed', (job, err) => {
  console.log(`Deployment job ${job.id} failed: ${err.message}`);
});

export default worker;
