import { Worker } from 'bullmq';
import { createRedisConnection, dependencyGraphQueue } from './queue.js';
import { salesforceClient } from '../services/salesforceClient.js';
import { supabaseAdmin } from '../../lib/supabaseClients.js';
import { getOrgCredentials } from '@orgforge/org-connections';

// BullMQ workers require their own connection instance when using blocking commands
const connection = createRedisConnection();

const worker = new Worker('orgforge-index-org', async job => {
  const { userId, orgId } = job.data;
  console.log(`Starting indexing for org ${orgId} (user ${userId})`);

  try {
    connection.publish(`orgforge:index-progress:${orgId}`, JSON.stringify({ progress: 10, status: 'fetching_credentials' }));

    // 1. Fetch credentials (with transparent token refresh). EC-10: if the
    //    stored refresh token is dead, flag the org disconnected so the UI
    //    shows a "Reconnect" CTA — the job itself fails loudly and retries.
    const { accessToken, instanceUrl } = await getOrgCredentials(supabaseAdmin, userId, orgId, {
      onRefreshFailure: async () => {
        try {
          await supabaseAdmin
            .from('org_connections')
            .update({ disconnected_at: new Date().toISOString() })
            .eq('org_id', orgId)
            .eq('user_id', userId);
        } catch (hookErr) {
          console.warn('[indexOrgJob] mark-disconnected hook failed:', hookErr.message);
        }
      }
    });

    connection.publish(`orgforge:index-progress:${orgId}`, JSON.stringify({ progress: 30, status: 'fetching_metadata' }));

    // 2. Fetch Objects
    const sobjects = await salesforceClient.fetchOrgSchema(accessToken, instanceUrl);
    const objectRows = sobjects.map(obj => ({
      org_id: orgId,
      metadata_type: obj.custom ? 'CustomObject' : 'StandardObject',
      api_name: obj.name,
      namespace_prefix: obj.namespacePrefix || (obj.custom ? 'c' : null)
    }));

    connection.publish(`orgforge:index-progress:${orgId}`, JSON.stringify({ progress: 50, status: 'fetching_tooling' }));

    // 3. Fetch Top-Level Metadata (Apex Classes as example)
    const apexClasses = await salesforceClient.queryTooling(accessToken, instanceUrl, 'SELECT Name, NamespacePrefix FROM ApexClass');
    const apexRows = apexClasses.map(cls => ({
      org_id: orgId,
      metadata_type: 'ApexClass',
      api_name: cls.Name,
      namespace_prefix: cls.NamespacePrefix
    }));

    // Combine all indexed components
    const allRows = [...objectRows, ...apexRows];

    connection.publish(`orgforge:index-progress:${orgId}`, JSON.stringify({ progress: 70, status: 'saving_database' }));

    // 4. Save to Database
    if (allRows.length > 0) {
      // Clear old indexes for this org before bulk insert (simple sync strategy)
      await supabaseAdmin.from('org_indexes').delete().eq('org_id', orgId);

      const { error: insertError } = await supabaseAdmin
        .from('org_indexes')
        .insert(allRows);

      if (insertError) throw new Error('Failed to insert indexes: ' + insertError.message);
    }

    connection.publish(`orgforge:index-progress:${orgId}`, JSON.stringify({ progress: 85, status: 'caching_redis' }));

    // 5. Cache to Redis for AI Orchestrator
    const contextPayload = {
      objects: sobjects.map(o => o.name),
      apex: apexClasses.map(c => c.Name)
    };
    await connection.set(`org_context:${userId}:${orgId}`, JSON.stringify(contextPayload), 'EX', 86400); // 24 hours

    // 6. Update indexed_at timestamp
    await supabaseAdmin
      .from('org_connections')
      .update({ context_indexed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('org_id', orgId);

    connection.publish(`orgforge:index-progress:${orgId}`, JSON.stringify({ progress: 100, status: 'completed' }));

    // Enqueue the deep dependency-graph backfill so org_indexes
    // referencing_components is populated with real Tooling API data (feeds
    // REF-01 blast radius and the What-If explorer). Non-fatal: the index is
    // already persisted, so a queue hiccup should not fail the job.
    try {
      await dependencyGraphQueue.add('build-dependency-graph', { tenantId: userId, orgId });
    } catch (queueErr) {
      console.warn('Failed to enqueue dependency graph job:', queueErr.message);
    }

    return { success: true, componentCount: allRows.length };
  } catch (error) {
    console.error('Indexing failed:', error);
    connection.publish(`orgforge:index-progress:${orgId}`, JSON.stringify({ progress: 0, status: 'failed', error: error.message }));
    throw error;
  }
}, { connection, concurrency: 2 });

worker.on('completed', job => {
  console.log(`${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`${job.id} has failed with ${err.message}`);
});

export default worker;
