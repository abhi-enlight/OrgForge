import express from 'express';
import { z } from 'zod';
import { salesforceClient } from '../services/salesforceClient.js';
import { encrypt } from '@forge/org-connections';
import { createAuthMiddleware } from '@forge/auth';
const requireAuth = createAuthMiddleware();
import { supabaseAdmin } from '../../lib/supabaseClients.js';
import { orgIndexQueue, redisConnection } from '../jobs/queue.js';

// OrgForge Connector package metadata (same ids + URL shape as
// orgforge/routes/orgs.js and routes/diagnostics.js — keep in sync). The 033
// SubscriberPackageId and 04t version id come from the Dev Hub package; env
// overrides win.
const ORGFORGE_PACKAGE_VERSION_ID =
  process.env.FORGE_ECA_PACKAGE_VERSION_ID ||
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

const router = express.Router();

const connectSchema = z.object({
  orgType: z.enum(['sandbox', 'production', 'scratch']).default('production'),
  alias: z.string().optional(),
  // Required for scratch orgs (they only authenticate on their own instance URL).
  // Optional otherwise; ignored by non-scratch org types.
  // Server-side domain restriction (defense in depth — mirrors the frontend
  // regex): the OAuth authorize URL is built from this value and carries the
  // real client_id, so it must never point off the Salesforce domain.
  instanceUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\/\S+\.salesforce\.com$/i.test(u), {
      message: 'instanceUrl must be a *.salesforce.com URL (e.g. https://xxx-dev-ed.scratch.my.salesforce.com)'
    })
    .optional()
});

const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes

/**
 * Persists OAuth PKCE state to Redis with a 10-minute TTL.
 * Survives server restarts and works across multiple instances.
 */
async function setOAuthState(state, data) {
  await redisConnection.set(
    `orgforge:oauth:state:${state}`,
    JSON.stringify(data),
    'EX',
    OAUTH_STATE_TTL_SECONDS
  );
}

async function getOAuthState(state) {
  const raw = await redisConnection.get(`orgforge:oauth:state:${state}`);
  return raw ? JSON.parse(raw) : null;
}

async function deleteOAuthState(state) {
  await redisConnection.del(`orgforge:oauth:state:${state}`);
}

router.post('/salesforce/connect', requireAuth, async (req, res) => {
  try {
    const { orgType, alias, instanceUrl } = connectSchema.parse(req.body);
    const { authUrl, state, codeVerifier } = salesforceClient.generateAuthUrl(orgType, instanceUrl);

    // Persist PKCE verifier + user context to Redis (TTL 10 min).
    // Survives restarts and works across horizontally-scaled instances.
    await setOAuthState(state, {
      codeVerifier,
      orgType,
      instanceUrl,
      userId: req.user.id,
      alias: alias || 'Salesforce Org'
    });

    res.json({ authUrl, state });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', issues: error.errors });
    }
    // Propagate intentional 4xx errors (e.g. scratch orgs require an instanceUrl)
    const status = error.status || 500;
    res.status(status).json({ error: status < 500 ? error.message : 'Failed to generate auth url' });
  }
});

router.get('/salesforce/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
    
    if (error) {
      // The "external client app is not installed" failure means the OrgForge
      // Connector ECA is missing from the target org — the user must install
      // it before sign-in can complete. Instead of bouncing the raw Salesforce
      // message back to the login screen, resolve the org type from the PKCE
      // state (still in Redis — not yet consumed) and redirect with a
      // structured code + the org-aware install link so the login flow can
      // pop up the install steps. Any other OAuth error keeps the old passthrough.
      const message = String(error_description || error || '');
      const ecaMissing = /external client app|not installed|isn'?t installed/i.test(message);

      let orgType = 'production';
      let instanceUrl = '';
      if (state) {
        try {
          const session = await getOAuthState(state);
          if (session) {
            orgType = session.orgType || 'production';
            instanceUrl = session.instanceUrl || '';
          }
        } catch {
          /* state lookup is best-effort — fall back to defaults */
        }
        try {
          await deleteOAuthState(state);
        } catch {
          /* cleanup is best-effort (TTL covers it) */
        }
      }

      if (ecaMissing) {
        const qs = new URLSearchParams({
          step: '2',
          error: 'ECANotInstalled',
          orgType,
          installUrl: buildInstallUrl(orgType, instanceUrl),
        });
        // Scratch orgs authenticate on their own instance domain — echo it
        // back so "Retry after installing" can re-start OAuth without the
        // user re-pasting the URL.
        if (instanceUrl) qs.set('instanceUrl', instanceUrl);
        return res.redirect(`${corsOrigin}/login?${qs.toString()}`);
      }

      return res.redirect(`${corsOrigin}/login?step=2&error=${encodeURIComponent(message)}`);
    }

    if (!code || !state) {
      return res.redirect(`${corsOrigin}/login?step=2&error=MissingAuthData`);
    }

    const session = await getOAuthState(state);
    if (!session) {
      return res.redirect(`${corsOrigin}/login?step=2&error=InvalidOrExpiredState`);
    }

    await deleteOAuthState(state); // Clean up immediately after use

    const tokens = await salesforceClient.exchangeCodeForTokens(
      code,
      session.codeVerifier,
      session.orgType,
      session.instanceUrl
    );
    
    const encryptedTokens = encrypt(
      JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt
      }),
      process.env.ENCRYPTION_KEY
    );

    if (!encryptedTokens) {
      throw new Error('Encryption failed');
    }

    // Persist to orgforge.org_connections using the service role client and the user ID from the session map
    const { error: dbError } = await supabaseAdmin
      .from('org_connections')
      .upsert({
        user_id: session.userId,
        org_id: tokens.orgId,
        org_type: session.orgType,
        alias: session.alias,
        instance_url: tokens.instanceUrl,
        encrypted_tokens: encryptedTokens,
        // EC-10 lifecycle: a successful reconnect clears the disconnected flag
        // (set when a token refresh failed) so the org returns to the
        // connected state — otherwise a revoked-token org stays flagged
        // "disconnected" forever even after re-linking through OAuth.
        disconnected_at: null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id, org_id'
      });

    if (dbError) {
      console.error('DB Insert Error:', dbError);
      return res.redirect(`${corsOrigin}/login?step=2&error=DatabaseError`);
    }
    
    // Enqueue the indexing worker (non-fatal: the connection is already saved,
    // so a queue hiccup should not fail the OAuth flow).
    try {
      await orgIndexQueue.add('index-org', { 
        userId: session.userId, 
        orgId: tokens.orgId,
        instanceUrl: tokens.instanceUrl
      });
    } catch (queueError) {
      console.warn('Failed to enqueue indexing job (will retry via /orgs/:orgId/index):', queueError.message);
    }
    
    // Success! Return to the onboarding flow where the user started (the
    // connect buttons all live on /login?step=2) — landing on /login?step=3
    // shows the "You're all set" screen, which then offers GitHub + dashboard.
    // (Previously this redirected to /workspace, pulling the user out of the
    // onboarding flow after a connect from /login.)
    res.redirect(`${corsOrigin}/login?step=3`);
  } catch (err) {
    console.error('OAuth Exchange Error:', err);
    const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
    res.redirect(`${corsOrigin}/login?step=2&error=ExchangeFailed`);
  }
});

export default router;
