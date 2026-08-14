import express from 'express';
import { z } from 'zod';
import { createAuthMiddleware, tenantIsolation } from '@orgforge/auth';
const requireAuth = createAuthMiddleware();
import { orgIndexQueue, redisConnection } from '../jobs/queue.js';
import { getOrgCredentials } from '@orgforge/org-connections';
import { salesforceClient } from '../services/salesforceClient.js';

const router = express.Router();

// OrgForge Connector package metadata (see docs/setup/packaged_eca_setup.md).
// The 033 SubscriberPackageId and 04t version id come from the Dev Hub package.
const ORGFORGE_PACKAGE_ID = process.env.ORGFORGE_PACKAGE_ID || '033fj000000PqLBAA0';
// Unified ECA version name first (the diagnostics preflight already uses
// ORGFORGE_ECA_PACKAGE_VERSION_ID); legacy ORGFORGE_PACKAGE_VERSION_ID honored.
const ORGFORGE_PACKAGE_VERSION_ID = process.env.ORGFORGE_ECA_PACKAGE_VERSION_ID || process.env.ORGFORGE_PACKAGE_VERSION_ID || '04tfj000000QFHxAAO';
const ORGFORGE_ECA_NAME = 'OrgForge_ECA';

// 10 minutes — short enough that a freshly-installed package clears quickly,
// long enough that page loads don't hammer the Tooling API.
const PACKAGE_HEALTH_TTL_SECONDS = 10 * 60;

/**
 * Builds the install-package URL for a given org type. Scratch orgs install
 * via their own instance domain (same as their OAuth base); production and
 * sandbox use their standard login endpoints.
 */
function buildInstallUrl(orgType, instanceUrl) {
  const base =
    orgType === 'sandbox'
      ? 'https://test.salesforce.com'
      : orgType === 'scratch'
        ? (instanceUrl || '').replace(/\/$/, '')
        : 'https://login.salesforce.com';
  return `${base}/packaging/installPackage.apexp?p0=${ORGFORGE_PACKAGE_VERSION_ID}`;
}

// Apply auth and tenant isolation to all org routes
router.use(requireAuth, tenantIsolation);

router.get('/', async (req, res) => {
  try {
    const { data: connections, error } = await req.supabaseClient
      .from('org_connections')
      .select('*')
      .eq('user_id', req.tenantId);

    if (error) throw error;

    const orgsWithCounts = await Promise.all(
      (connections || []).map(async (conn) => {
        const { count } = await req.supabaseClient
          .from('org_indexes')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', conn.org_id);

        return {
          id: conn.org_id,
          alias: conn.alias || conn.org_id,
          type: conn.org_type,
          instanceUrl: conn.instance_url,
          contextIndexedAt: conn.context_indexed_at,
          components: count || 0
        };
      })
    );

    res.json({ orgs: orgsWithCounts });
  } catch (err) {
    console.error('Failed to fetch orgs:', err);
    res.status(500).json({ error: 'Failed to fetch orgs' });
  }
});

router.post('/:orgId/index', async (req, res) => {
  try {
    const { orgId } = req.params;

    // Verify the org belongs to this tenant before enqueuing work for it.
    // (req.supabaseClient uses the service role key, so RLS is not a
    // backstop — ownership must be checked explicitly.)
    const { data: owned, error: ownErr } = await req.supabaseClient
      .from('org_connections')
      .select('org_id')
      .eq('org_id', orgId)
      .eq('user_id', req.tenantId)
      .maybeSingle();

    if (ownErr || !owned) {
      return res.status(404).json({ error: 'Org connection not found' });
    }

    // Add job to BullMQ
    const job = await orgIndexQueue.add('index-org', {
      userId: req.tenantId,
      orgId
    });

    res.json({ jobId: job.id, status: 'indexing' });
  } catch (err) {
    console.error('Failed to queue indexing job:', err.message);
    res.status(500).json({ error: 'Failed to queue indexing job' });
  }
});

/**
 * Package-install health check for an org.
 *
 * Tri-state response:
 *   { status: 'installed', ecaPresent }   — connector package present
 *   { status: 'missing',   ecaPresent, installUrl, copyLink }
 *                                          — package not installed → UI shows install popup
 *   { status: 'error', reason }            — cannot verify (expired token etc.) → UI prompts reconnect
 *
 * Cached in Redis per (user, org) for 10 min; pass ?force=1 to bypass
 * (used by the "I've installed it — re-check" action in the modal).
 */
router.get('/:orgId/package-health', async (req, res) => {
  try {
    const { orgId } = orgIdSchema.parse(req.params);

    // 1. Ownership check (service-role client: RLS is not a backstop).
    const { data: owned, error: ownErr } = await req.supabaseClient
      .from('org_connections')
      .select('org_id, org_type, instance_url')
      .eq('org_id', orgId)
      .eq('user_id', req.tenantId)
      .maybeSingle();

    if (ownErr || !owned) {
      return res.status(404).json({ error: 'Org connection not found' });
    }

    const cacheKey = `orgforge:pkg-health:${req.tenantId}:${orgId}`;
    const force = req.query.force === '1' || req.query.force === 'true';

    if (!force) {
      const cached = await redisConnection.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    }

    // 2. Resolve live credentials (auto-refreshes within the 5-min margin).
    const { accessToken, instanceUrl, orgType } = await getOrgCredentials(
      req.supabaseClient,
      req.tenantId,
      orgId
    );

    const result = await salesforceClient.checkPackageInstalled(accessToken, instanceUrl, {
      packageId: ORGFORGE_PACKAGE_ID,
      ecaName: ORGFORGE_ECA_NAME
    });

    if (result.status === 'error') {
      // Cannot verify — e.g. INVALID_SESSION_ID. Don't cache; surface a fixed
      // message so the UI offers "reconnect" instead of a bogus install popup.
      // The raw Salesforce/axios detail stays server-side only.
      console.warn(`Package health check error for org ${orgId}:`, result.reason);
      return res.json({ status: 'error', reason: 'Could not verify connector status', orgId });
    }

    const payload = {
      orgId,
      orgType,
      status: result.status,
      ecaPresent: result.ecaPresent,
      installUrl: buildInstallUrl(orgType, instanceUrl),
      copyLink: buildInstallUrl(orgType, instanceUrl),
      packageId: ORGFORGE_PACKAGE_ID,
      packageVersionId: ORGFORGE_PACKAGE_VERSION_ID,
      checkedAt: new Date().toISOString()
    };

    try {
      await redisConnection.set(cacheKey, JSON.stringify(payload), 'EX', PACKAGE_HEALTH_TTL_SECONDS);
    } catch (cacheErr) {
      // Cache is best-effort: a Redis hiccup must not fail an otherwise-good
      // health check (the client just pays one extra Tooling round-trip next
      // load). Mirrors the install-url route's resilience.
      console.warn(`Failed to cache package health for org ${orgId}:`, cacheErr.message);
    }
    res.json(payload);
  } catch (err) {
    // getOrgCredentials throws 401 when the stored Salesforce refresh token is
    // dead (EC-10) — surface the ORG_RECONNECT_REQUIRED discriminator so the
    // frontend shows a "Reconnect Salesforce" CTA instead of signing the user
    // out (a bare 401 is treated as session expiry by apiFetch).
    if (err.status === 401) {
      return res.status(401).json({
        error: 'Reconnect this org. Salesforce access could not be refreshed',
        code: 'ORG_RECONNECT_REQUIRED',
      });
    }
    console.error('Package health check failed:', err.message);
    res.status(500).json({ error: 'Failed to check package health' });
  }
});

/**
 * Returns real indexed metadata components for an org.
 * Falls back to the Redis context cache if the DB has no rows yet.
 */
router.get('/:orgId/context', async (req, res) => {
  try {
    const { orgId } = req.params;

    // Ownership check first: req.supabaseClient uses the service role key, so
    // RLS is not a backstop — never read another tenant's org metadata.
    const { data: owned, error: ownErr } = await req.supabaseClient
      .from('org_connections')
      .select('org_id')
      .eq('org_id', orgId)
      .eq('user_id', req.tenantId)
      .maybeSingle();

    if (ownErr || !owned) {
      return res.status(404).json({ error: 'Org connection not found' });
    }

    // Try Redis cache first (populated by indexOrgJob)
    const cached = await redisConnection.get(`org_context:${req.tenantId}:${orgId}`);
    if (cached) {
      return res.json({ context: JSON.parse(cached) });
    }

    // Fall back to DB — return top-100 indexed components
    const { data, error } = await req.supabaseClient
      .from('org_indexes')
      .select('metadata_type, api_name, namespace_prefix')
      .eq('org_id', orgId)
      .limit(100);

    if (error) throw error;

    res.json({ context: data || [] });
  } catch (err) {
    console.error('Failed to fetch org context:', err);
    res.status(500).json({ error: 'Failed to fetch org context' });
  }
});

const orgIdSchema = z.object({ orgId: z.string().min(1) });

/**
 * Returns real indexing status and component count from the database.
 */
router.get('/:orgId/status', async (req, res) => {
  try {
    const { orgId } = orgIdSchema.parse(req.params);

    const { data: conn, error: connErr } = await req.supabaseClient
      .from('org_connections')
      .select('context_indexed_at, org_type, alias')
      .eq('org_id', orgId)
      .eq('user_id', req.tenantId)
      .single();

    if (connErr || !conn) {
      return res.status(404).json({ error: 'Org connection not found' });
    }

    const { count } = await req.supabaseClient
      .from('org_indexes')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId);

    res.json({
      status: conn.context_indexed_at ? 'completed' : 'pending',
      componentCount: count || 0,
      lastIndexedAt: conn.context_indexed_at || null,
      orgType: conn.org_type,
      alias: conn.alias
    });
  } catch (err) {
    console.error('Failed to fetch org status:', err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

/**
 * SSE endpoint for real-time indexing progress updates.
 * Streams JSON from the `orgforge:index-progress:${orgId}` Redis channel.
 */
router.get('/:orgId/index-stream', async (req, res) => {
  const { orgId } = req.params;

  // 1. Verify org ownership
  const { data: owned, error: ownErr } = await req.supabaseClient
    .from('org_connections')
    .select('org_id')
    .eq('org_id', orgId)
    .eq('user_id', req.tenantId)
    .maybeSingle();

  if (ownErr || !owned) {
    return res.status(404).json({ error: 'Org connection not found' });
  }

  // 2. Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Create an isolated redis client for subscribing
  const subscriber = redisConnection.duplicate();
  await subscriber.connect();

  const channel = `orgforge:index-progress:${orgId}`;

  // 3. Listen to the channel and forward messages
  await subscriber.subscribe(channel, (message) => {
    try {
      res.write(`data: ${message}\n\n`);
      
      const parsed = JSON.parse(message);
      // Close the stream if terminal state reached
      if (parsed.status === 'completed' || parsed.status === 'failed') {
        res.end();
        subscriber.unsubscribe(channel);
        subscriber.quit();
      }
    } catch (e) {
      console.warn('Malformed progress message:', message);
    }
  });

  // Keep connection alive with periodic pings
  const interval = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  // 4. Handle client disconnect
  req.on('close', () => {
    clearInterval(interval);
    subscriber.unsubscribe(channel);
    subscriber.quit();
  });
});

/**
 * Disconnect an org: removes org_connections + org_indexes for this user+org.
 */
router.delete('/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;

    // Validate ownership first
    const { data: conn, error: findErr } = await req.supabaseClient
      .from('org_connections')
      .select('org_id')
      .eq('org_id', orgId)
      .eq('user_id', req.tenantId)
      .single();

    if (findErr || !conn) {
      return res.status(404).json({ error: 'Org connection not found' });
    }

    // Delete org indexes (scoped via org_id; RLS enforces user ownership via join)
    // Using supabaseAdmin here because org_indexes RLS SELECT policy uses a
    // sub-select join and DELETE may not propagate correctly for non-admin clients.
    // The ownership check above already guards this.
    const { error: indexErr } = await req.supabaseClient
      .from('org_indexes')
      .delete()
      .eq('org_id', orgId);

    if (indexErr) console.warn('Failed to delete org indexes:', indexErr.message);

    // Delete the org connection row
    const { error: deleteErr } = await req.supabaseClient
      .from('org_connections')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', req.tenantId);

    if (deleteErr) throw deleteErr;

    // Evict Redis context cache
    await redisConnection.del(`org_context:${req.tenantId}:${orgId}`);

    res.json({ success: true, orgId });
  } catch (err) {
    console.error('Failed to disconnect org:', err);
    res.status(500).json({ error: 'Failed to disconnect org' });
  }
});

export default router;
