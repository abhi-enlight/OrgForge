import express from 'express';
import { z } from 'zod';
import { salesforceClient } from '../services/salesforceClient.js';
import { encrypt } from '../utils/cryptoUtils.js';
import { createAuthMiddleware } from '@forge/auth';
const requireAuth = createAuthMiddleware();
import { supabaseAdmin } from '../services/supabaseClient.js';
import { orgIndexQueue, redisConnection } from '../jobs/queue.js';

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
      return res.redirect(`${corsOrigin}/workspace?error=${encodeURIComponent(error_description || error)}`);
    }

    if (!code || !state) {
      return res.redirect(`${corsOrigin}/workspace?error=MissingAuthData`);
    }

    const session = await getOAuthState(state);
    if (!session) {
      return res.redirect(`${corsOrigin}/workspace?error=InvalidOrExpiredState`);
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
        encrypted_tokens: encryptedTokens
      }, {
        onConflict: 'user_id, org_id'
      });

    if (dbError) {
      console.error('DB Insert Error:', dbError);
      return res.redirect(`${corsOrigin}/workspace?error=DatabaseError`);
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
    
    // Success! Redirect back to frontend
    res.redirect(`${corsOrigin}/workspace?success=true`);
  } catch (err) {
    console.error('OAuth Exchange Error:', err);
    const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
    res.redirect(`${corsOrigin}/workspace?error=ExchangeFailed`);
  }
});

export default router;
