import { Router } from 'express';
import { z } from 'zod';
import { createAuthMiddleware, tenantIsolation } from '@orgforge/auth';
import { getOrgCredentials } from '@orgforge/org-connections';
import { runPreFlightCheck, getDiagnostics, invalidateDiagnostics } from '@orgforge/diagnostics';
import { forgeDb as forgeDbSingleton, publicDb as credsDbSingleton } from '../lib/supabaseClients.js';

const paramsSchema = z.object({
  orgId: z.string().min(3).max(18),
});

// OrgForge Connector package metadata (same ids + URL shape as
// orgforge/routes/orgs.js — keep the two in sync). The 033 SubscriberPackageId
// and 04t version id come from the Dev Hub package; env overrides win.
const ORGFORGE_PACKAGE_VERSION_ID =
  process.env.ORGFORGE_ECA_PACKAGE_VERSION_ID ||
  process.env.ORGFORGE_PACKAGE_VERSION_ID ||
  '04tfj000000QFHxAAO';

/** Builds the Salesforce package-installer URL for an org type (mirrors orgs.js). */
function buildInstallUrl(orgType, instanceUrl) {
  const base =
    orgType === 'sandbox'
      ? 'https://test.salesforce.com'
      : orgType === 'scratch'
        ? (instanceUrl || '').replace(/\/$/, '')
        : 'https://login.salesforce.com';
  return `${base}/packaging/installPackage.apexp?p0=${ORGFORGE_PACKAGE_VERSION_ID}`;
}

// Shared singletons from lib/supabaseClients.js — one connection pool per schema per process.
const forgeSchemaClient = () => forgeDbSingleton;



/**
 * Builds the unified diagnostics router (plan §10.1, §12.4).
 *
 * GET  /api/v1/diagnostics?orgId=...  → cached pre-flight (24h, server-side)
 * POST /api/v1/diagnostics/recheck    → force a fresh run
 *
 * The pre-flight needs a live Salesforce access token, resolved from the
 * unified org-connections store via getOrgCredentials (which auto-refreshes
 * with dedup). Refresh failure surfaces 401 → "Reconnect org" (EC-10) and —
 * when the failure is an auth break (401/403) — invalidates this org's
 * diagnostics cache (EC-14 `invalidateAndRecheck`) so the next read re-runs
 * the pre-flight instead of serving a stale 24h result.
 *
 * @param {object} [opts]
 * @param {object} [opts.authMiddleware] - injectable (tests)
 * @param {(db, userId, orgId, opts) => Promise<object>} [opts.getCredentials] - opts.onRefreshFailure fires inside the refresh path (EC-10); the route uses it for EC-14 cache invalidation
 * @param {(token, instanceUrl, opts) => Promise<object>} [opts.preFlight]
 * @param {() => object} [opts.forgeDbFactory] - forge-schema supabase client (diagnostics cache, default env-based)
 * @param {() => object} [opts.credsDbFactory] - DEFAULT-schema client for org_connections (credentials)
 */
export function createDiagnosticsRouter({
  authMiddleware = createAuthMiddleware(),
  getCredentials = getOrgCredentials,
  preFlight = runPreFlightCheck,
  forgeDbFactory = forgeSchemaClient,
  credsDbFactory = () => credsDbSingleton,
} = {}) {
  const router = Router();
  const requireAuth = authMiddleware;

  const runChecked = async (req, res, forceRecheck) => {
    const parsed = paramsSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', issues: parsed.error.errors });
    }
    const { orgId } = parsed.data;

    // Resolve live Salesforce credentials for this (user, org). Every query is
    // tenant-scoped by requireAuth + the explicit userId here (tenantIsolation
    // contract — RLS is not a backstop on service-role clients).
    // org_connections lives in the DEFAULT schema (the shared store the OAuth
    // flow writes) — NOT the forge schema — so credentials resolve via
    // credsDbFactory; forgeDbFactory is for the forge.diagnostics cache only.
    const credsDb = credsDbFactory();
    const forgeDb = forgeDbFactory();
    let creds;
    try {
      // The onRefreshFailure hook fires INSIDE the org-connections refresh
      // path (before the 401 surfaces here). On an auth break (401/403) it
      // drops this org's diagnostics cache row so the next read re-checks
      // fresh (EC-14). Other failures (e.g. a transient Salesforce 500) leave
      // the cache alone — the stored token may still be fine.
      creds = await getCredentials(credsDb, req.user.id, orgId, {
        onRefreshFailure: async (refreshErr) => {
          if (refreshErr.status !== 401 && refreshErr.status !== 403) return;
          await invalidateDiagnostics({ db: forgeDb, userId: req.user.id, orgId });
        },
      });
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: 'Org connection not found' });
      }
      if (err.status === 401) {
        // ORG_RECONNECT_REQUIRED discriminates this 401 from a session-auth
        // 401: the user's app session is fine — only the Salesforce org needs
        // reconnecting. The frontend checks this code before deciding to sign
        // the user out (EC-10).
        return res.status(401).json({
          error: 'Reconnect this org. Salesforce access could not be refreshed',
          code: 'ORG_RECONNECT_REQUIRED',
        });
      }
      throw err;
    }

    // The cache lives in forge.diagnostics — needs a forge-schema client, not
    // the default-schema tenantIsolation client (declared above).
    const result = await getDiagnostics({
      db: forgeDb,
      run: () => preFlight(creds.accessToken, creds.instanceUrl),
      userId: req.user.id,
      orgId,
      forceRecheck,
    });

    // When the connector package is missing, carry the org-aware Salesforce
    // install link (the same URL the package-health route returns) so every
    // "setup needed" surface — the readiness banner, Settings → Advanced,
    // the agents page — can send the user straight to the package installer
    // instead of only saying "install it". Additive: a cached row written
    // before this field existed simply lacks it and the UI degrades to a
    // Settings pointer.
    if (result?.checks?.package?.installed === false) {
      result.installUrl = buildInstallUrl(creds.orgType, creds.instanceUrl);
      result.packageVersionId = ORGFORGE_PACKAGE_VERSION_ID;
    }

    return res.json(result);
  };

  router.get('/', requireAuth, tenantIsolation, async (req, res, next) => {
    try {
      await runChecked(req, res, false);
    } catch (err) {
      next(err);
    }
  });

  router.post('/recheck', requireAuth, tenantIsolation, async (req, res, next) => {
    try {
      await runChecked(req, res, true);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const diagnosticsRouter = createDiagnosticsRouter();
