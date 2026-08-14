import { Worker } from 'bullmq';
import { createRedisConnection } from './queue.js';
import { supabaseAdmin } from '../../lib/supabaseClients.js';
import { getOrgCredentials } from '@forge/org-connections';
import { salesforceClient } from '../services/salesforceClient.js';
import { isValidSfIdentifier } from '../utils/aiSafety.js';

// BullMQ workers require their own connection instance when using blocking commands
const connection = createRedisConnection();

/**
 * Builds the deep dependency graph for an org from the Tooling API
 * (MetadataComponentDependency) and backfills org_indexes.referencing_components.
 *
 * One job per org (enqueued by indexOrgJob after a successful index). The whole
 * org's dependency map is pulled in a single paginated query and resolved in
 * memory, so there is no per-component API fan-out.
 */
const worker = new Worker('orgforge-dependency-graph', async job => {
  const { tenantId, orgId, componentId } = job.data;
  console.log(`Building dependency graph for org ${orgId}`);

  try {
    // EC-10: a dead refresh token fails the job loudly AND flags the org
    // disconnected so the user sees the "Reconnect" CTA on their next visit.
    const { accessToken, instanceUrl } = await getOrgCredentials(supabaseAdmin, tenantId, orgId, {
      onRefreshFailure: async () => {
        try {
          await supabaseAdmin
            .from('org_connections')
            .update({ disconnected_at: new Date().toISOString() })
            .eq('org_id', orgId)
            .eq('user_id', tenantId);
        } catch (hookErr) {
          console.warn('[dependencyGraphJob] mark-disconnected hook failed:', hookErr.message);
        }
      }
    });

    // Components to resolve: a single named component (legacy call shape) or
    // every component the org index currently holds.
    let components = [];
    if (componentId && isValidSfIdentifier(componentId)) {
      components = [{ api_name: componentId }];
    } else {
      const { data, error } = await supabaseAdmin
        .from('org_indexes')
        .select('api_name')
        .eq('org_id', orgId);
      if (error) throw new Error(`Failed to load org indexes: ${error.message}`);
      components = data || [];
    }

    // Pull the org's dependency map once (paginated via nextRecordsUrl).
    const deps = await salesforceClient.queryToolingAll(
      accessToken,
      instanceUrl,
      `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, ` +
      `RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency`
    );

    // Reverse map: RefMetadataComponentName -> referencing components.
    const byName = new Map();
    for (const d of deps || []) {
      const key = d.RefMetadataComponentName;
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ type: d.MetadataComponentType, name: d.MetadataComponentName });
    }

    let updated = 0;
    for (const c of components) {
      const refs = byName.get(c.api_name);
      if (refs && refs.length > 0) {
        const { error } = await supabaseAdmin
          .from('org_indexes')
          .update({ referencing_components: refs })
          .eq('org_id', orgId)
          .eq('api_name', c.api_name);
        if (error) {
          console.warn(`Failed to update referencing_components for ${c.api_name}:`, error.message);
        } else {
          updated += 1;
        }
      }
    }

    return {
      success: true,
      componentsScanned: components.length,
      referencingBackfilled: updated,
      totalDependencies: (deps || []).length
    };
  } catch (error) {
    console.error('Dependency graph job failed:', error);
    throw error;
  }
}, { connection });

export default worker;
