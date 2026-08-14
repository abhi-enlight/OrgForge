import express from 'express';
import { z } from 'zod';
import { createAuthMiddleware, tenantIsolation } from '@forge/auth';
const requireAuth = createAuthMiddleware();
import { githubService } from '../services/githubService.js';
import { redisConnection } from '../jobs/queue.js';
import { isMissingTableError } from '../../lib/isMissingTable.js';

const router = express.Router();

const connectSchema = z.object({
  installationId: z.coerce.number().int().positive(),
  repoOwner: z.string().min(1).max(255),
  repoName: z.string().min(1).max(255)
});

// A user may only list repos / connect an installation after initiating their
// own install flow (which mints this claim in Redis for 10 minutes). This
// closes the cross-tenant enumeration window: GitHub App installation IDs are
// sequential integers, so without the claim any logged-in user could probe
// arbitrary installation ids and read other tenants' accessible repo names.
const PENDING_CLAIM_TTL_SECONDS = 10 * 60;

async function pendingClaimKey(userId) {
  return `orgforge:github:pending:${userId}`;
}

async function assertPendingClaim(userId) {
  const raw = await redisConnection.get(await pendingClaimKey(userId));
  return Boolean(raw);
}

async function consumePendingClaim(userId) {
  await redisConnection.del(await pendingClaimKey(userId));
}

/*
 * PUBLIC route — GitHub's post-install redirect carries no OrgForge session.
 * Must be registered before the auth middleware below so it is not blocked.
 */
router.get('/callback', (req, res) => {
  const { installation_id, setup_action } = req.query;
  const corsOrigin = process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:3000';
  if (!installation_id) {
    return res.redirect(`${corsOrigin}/settings?github=error&reason=missing_installation`);
  }
  res.redirect(
    `${corsOrigin}/settings?github=install&installation_id=${encodeURIComponent(String(installation_id))}&action=${encodeURIComponent(String(setup_action || 'install'))}`
  );
});

// All remaining routes require an authenticated, tenant-scoped session.
router.use(requireAuth, tenantIsolation);

/**
 * Returns the GitHub App installation URL. The operator opens this in a new
 * tab, installs the OrgForge Audit Logger on a repo, and GitHub redirects to
 * the callback below with ?installation_id=...&setup_action=install.
 *
 * Mints a Redis pending-install claim for this user (10-min TTL) so the
 * subsequent /repos and /connect calls are scoped to a flow they started.
 */
router.get('/install-url', async (req, res) => {
  if (!githubService.isConfigured()) {
    return res.status(503).json({
      error: 'GitHub App is not configured. Set GITHUB_APP_ID and GITHUB_PRIVATE_KEY in the backend environment.'
    });
  }
  try {
    await redisConnection.set(
      await pendingClaimKey(req.tenantId),
      JSON.stringify({ createdAt: Date.now() }),
      'EX',
      PENDING_CLAIM_TTL_SECONDS
    );
  } catch (err) {
    // Redis hiccup must not block the install link itself; /repos and /connect
    // will reject without the claim, so the user simply retries.
    console.warn('Failed to mint GitHub pending-install claim:', err.message);
  }
  res.json({ installUrl: githubService.getInstallUrl() });
});

/**
 * Lists repos the given installation grants access to, so the operator can
 * choose which repo receives the audit trail. Requires an active pending
 * claim (the user must have just requested the install URL) — prevents
 * enumerating other tenants' installations by sequential id.
 */
router.get('/repos', async (req, res) => {
  try {
    if (!(await assertPendingClaim(req.tenantId))) {
      return res.status(403).json({ error: 'No pending GitHub install. Start a new install from Settings first.' });
    }

    const installationId = Number(req.query.installationId);
    if (!Number.isInteger(installationId) || installationId <= 0) {
      return res.status(400).json({ error: 'installationId must be a positive integer' });
    }
    const repos = await githubService.listReposForInstallation(installationId);
    res.json({ repos });
  } catch (err) {
    console.error('Failed to list GitHub repos:', err.message);
    res.status(500).json({ error: 'Failed to list repositories for this installation' });
  }
});

/**
 * Persists the user's GitHub audit-log destination. Verifies the submitted
 * repo actually belongs to the installation (via the GitHub API) before
 * storing, so a user cannot claim a repo they were not granted. Upserts on
 * user_id so a re-connect replaces the previous repo.
 */
router.post('/connect', async (req, res) => {
  try {
    if (!(await assertPendingClaim(req.tenantId))) {
      return res.status(403).json({ error: 'No pending GitHub install. Start a new install from Settings first.' });
    }

    const { installationId, repoOwner, repoName } = connectSchema.parse(req.body);

    // Verify the repo is actually accessible to this installation before
    // persisting — the client payload is untrusted.
    let accessible = false;
    try {
      const repos = await githubService.listReposForInstallation(installationId);
      accessible = repos.some(
        (r) => r.owner === repoOwner && r.name === repoName
      );
    } catch (err) {
      console.error('Failed to verify installation access:', err.message);
      return res.status(400).json({ error: 'Could not verify access to this installation. Please try again.' });
    }
    if (!accessible) {
      return res.status(403).json({
        error: `The GitHub installation does not grant access to ${repoOwner}/${repoName}. Grant the app access to this repository and try again.`
      });
    }

    const { error } = await req.supabaseClient
      .from('github_connections')
      .upsert({
        user_id: req.tenantId,
        installation_id: String(installationId),
        repo_owner: repoOwner,
        repo_name: repoName
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('Failed to save GitHub connection:', error.message);
      return res.status(500).json({ error: 'Failed to save GitHub connection' });
    }

    // Claim is consumed on success — a re-point requires a fresh install flow.
    await consumePendingClaim(req.tenantId);

    res.json({ success: true, repoOwner, repoName });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', issues: err.errors });
    }
    console.error('GitHub connect failed:', err.message);
    res.status(500).json({ error: 'Failed to connect GitHub repository' });
  }
});

/**
 * Returns the current GitHub audit destination (or null when none).
 */
router.get('/status', async (req, res) => {
  try {
    const { data, error } = await req.supabaseClient
      .from('github_connections')
      .select('installation_id, repo_owner, repo_name, created_at')
      .eq('user_id', req.tenantId)
      .maybeSingle();

    if (error) throw error;

    res.json({
      connected: Boolean(data),
      installationId: data?.installation_id || null,
      repoOwner: data?.repo_owner || null,
      repoName: data?.repo_name || null,
      connectedAt: data?.created_at || null
    });
  } catch (err) {
    // A missing github_connections table (migration not applied yet) must
    // read as "no GitHub connected", not a 500 — this endpoint runs on the
    // login/settings pages automatically, and a 500 here used to surface as
    // a scary "Failed to load GitHub status" on every sign-in. Any other DB
    // failure still fails loudly.
    if (isMissingTableError(err)) {
      console.warn('[github] github_connections table missing — reporting disconnected:', err.message);
      return res.json({
        connected: false,
        installationId: null,
        repoOwner: null,
        repoName: null,
        connectedAt: null
      });
    }
    console.error('Failed to fetch GitHub status:', err.message);
    res.status(500).json({ error: 'Failed to fetch GitHub connection status' });
  }
});

/**
 * Disconnects the GitHub audit destination.
 */
router.delete('/connect', async (req, res) => {
  try {
    const { error } = await req.supabaseClient
      .from('github_connections')
      .delete()
      .eq('user_id', req.tenantId);

    if (error) throw error;
    await consumePendingClaim(req.tenantId);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to disconnect GitHub:', err.message);
    res.status(500).json({ error: 'Failed to disconnect GitHub repository' });
  }
});

export default router;
