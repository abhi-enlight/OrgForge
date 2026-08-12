import express from 'express'
const router = express.Router();
import axios from 'axios'

import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { upsertConnection, getConnection, updateConnectionTokens } from '../services/dbClient.js'

// BUG-3: Deduplicate concurrent token refresh calls per org.
// If two simultaneous requests both detect an expiring token, they share one
// refresh promise instead of both hitting Salesforce's OAuth endpoint (which
// may invalidate the refresh token on the first use, causing 'invalid grant').
const refreshPromiseMap = new Map();


// JWT_SECRET is RETIRED in the unified app (plan §8.3): identity is Supabase
// auth via @forge/auth, and no code outside this transitional alias router
// consumes the legacy Agentforge JWT (getCredentialsFromToken has no callers
// in the unified app). So it is no longer read at boot — a missing secret can
// never crash the API. If a legacy client actually drives this router's
// token flow without JWT_SECRET configured, the failure is at USE time with a
// clear message instead.
function requireJwtSecret() {
  if (!process.env.JWT_SECRET) {
    const err = new Error('Legacy Agentforge JWT flow is retired — JWT_SECRET is no longer configured. Use the unified Supabase auth, or set JWT_SECRET only if you must keep the transition alias alive.');
    err.status = 500;
    throw err;
  }
  return process.env.JWT_SECRET;
}

function base64URLEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function getCredentialsFromToken(req) {
  const authHeader = req.headers.authorization;
  let tokenData = null;
  let isJwtExpired = false;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      tokenData = jwt.verify(token, requireJwtSecret());
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        try {
          tokenData = jwt.verify(token, requireJwtSecret(), { ignoreExpiration: true });
          isJwtExpired = true;
        } catch (innerErr) {
          return null;
        }
      } else {
        return null;
      }
    }
  } else if (req.session && req.session.orgId) {
    // Fallback: check session
    tokenData = { orgId: req.session.orgId };
  }

  if (!tokenData || !tokenData.orgId) {
    return null;
  }

  // BUG-2: Wrap getConnection in try/catch.
  // getConnection() throws on Supabase RPC errors (network issues, DB down).
  // Without this guard, the error propagates as an unhandled rejection, killing
  // the request and logging a confusing 500 instead of a clean 401.
  let connection;
  try {
    connection = await getConnection(tokenData.orgId);
  } catch (dbErr) {
    console.error('[AUTH] DB error fetching connection for org', tokenData.orgId, ':', dbErr.message);
    return null;
  }
  if (!connection) {
    return null;
  }

  // BUG-3: Proactive token refresh with deduplication.
  // If expiring in the next 5 minutes, refresh — but only once per org even if
  // multiple concurrent requests all detect the expiry at the same time.
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  const now = Date.now();
  if (expiresAt > 0 && (expiresAt - now) < 5 * 60 * 1000) {
    console.log(`[AUTH] Token for org ${tokenData.orgId} is expiring soon. Refreshing...`);
    
    // Reuse an in-flight refresh if one already started for this org
    if (!refreshPromiseMap.has(tokenData.orgId)) {
      const refreshPromise = (async () => {
        try {
          const response = await axios.post('https://login.salesforce.com/services/oauth2/token', new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: process.env.SALESFORCE_CLIENT_ID || process.env.SF_OAUTH_CLIENT_ID,
            client_secret: process.env.SALESFORCE_CLIENT_SECRET || process.env.SF_OAUTH_CLIENT_SECRET,
            refresh_token: connection.refresh_token
          }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });

          const newAccessToken = response.data.access_token;
          const newExpiresAt = Date.now() + (2 * 60 * 60 * 1000);

          await updateConnectionTokens(tokenData.orgId, {
            accessToken: newAccessToken,
            tokenExpiresAt: newExpiresAt
          });
          return newAccessToken;
        } catch (refreshErr) {
          console.error('[AUTH] Failed to refresh token:', refreshErr.response?.data || refreshErr.message);
          return null;
        } finally {
          refreshPromiseMap.delete(tokenData.orgId);
        }
      })();
      refreshPromiseMap.set(tokenData.orgId, refreshPromise);
    }

    const newToken = await refreshPromiseMap.get(tokenData.orgId);
    if (!newToken) {
      return null; // Refresh failed — force re-authentication
    }
    connection.access_token = newToken;
  }

  return { 
    accessToken: connection.access_token, 
    instanceUrl: connection.instance_url, 
    refreshToken: connection.refresh_token, 
    isJwtExpired: isJwtExpired,
    orgId: tokenData.orgId,
    agentforgeUserId: tokenData.agentforgeUserId
  };
}

router.get('/login', (req, res) => {
  const loginSchema = z.object({ returnTo: z.string().optional() });
  const parseResult = loginSchema.safeParse(req.query);
  if (!parseResult.success) return res.status(400).send('Invalid query parameters');
  
  let returnTo = parseResult.data.returnTo || '/';
  const allowedPaths = ['/', '/chat', '/use-cases'];
  const basePath = returnTo.split('?')[0];
  if (!allowedPaths.includes(basePath)) {
    returnTo = '/';
  }

  // Generate PKCE Challenge & Verifier
  const verifier = base64URLEncode(crypto.randomBytes(32));
  const challenge = base64URLEncode(crypto.createHash('sha256').update(verifier).digest());
  
  // Generate OAuth State
  const state = crypto.randomBytes(16).toString('hex');
  
  // Generate Agentforge User ID if not exists
  if (!req.session.agentforgeUserId) {
    req.session.agentforgeUserId = crypto.randomUUID();
  }

  // Store in session for the callback
  req.session.codeVerifier = verifier;
  req.session.oauthState = state;
  req.session.returnTo = returnTo;

  const scope = encodeURIComponent('api web refresh_token einstein_gpt_api full sfap_api openid id');
  const authUrl = `https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id=${process.env.SALESFORCE_CLIENT_ID || process.env.SF_OAUTH_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.SALESFORCE_REDIRECT_URI || process.env.SF_CALLBACK_URL)}&scope=${scope}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
  
  // Explicitly save session before redirecting to Salesforce
  req.session.save((err) => {
    if (err) {
      console.error('Session save error on login:', err);
      return res.status(500).send('Session error. Please try again.');
    }
    res.redirect(authUrl);
  });
});

router.get('/callback', async (req, res) => {
  const callbackSchema = z.object({
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional()
  });
  const parseResult = callbackSchema.safeParse(req.query);
  if (!parseResult.success) return res.status(400).send('Invalid callback payload');
  
  const { code, state, error, error_description } = parseResult.data;
  const verifier = req.session.codeVerifier;
  const expectedState = req.session.oauthState;

  let frontendUrlRaw = process.env.FRONTEND_URL || 'http://localhost:3000';
  let frontendUrl = frontendUrlRaw;
  try {
    frontendUrl = new URL(frontendUrlRaw).origin;
  } catch (e) {
    frontendUrl = frontendUrlRaw.replace(/\/$/, '');
  }

  if (error) {
    console.error('OAuth Callback Error:', { error, error_description });
    return res.redirect(`${frontendUrl}/?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || '')}`);
  }
  if (!state || state !== expectedState) {
    console.error('State mismatch:', { received: state, expected: expectedState });
    return res.status(403).send('Invalid state parameter');
  }

  try {
    const response = await axios.post('https://login.salesforce.com/services/oauth2/token', new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.SALESFORCE_CLIENT_ID || process.env.SF_OAUTH_CLIENT_ID,
      client_secret: process.env.SALESFORCE_CLIENT_SECRET || process.env.SF_OAUTH_CLIENT_SECRET,
      redirect_uri: process.env.SALESFORCE_REDIRECT_URI || process.env.SF_CALLBACK_URL,
      code_verifier: verifier
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // Extract the Salesforce Org ID from the id URL (e.g. https://login.salesforce.com/id/00D.../005...)
    const idUrl = response.data.id;
    const orgId = idUrl.split('/id/')[1].split('/')[0];
    const agentforgeUserId = req.session.agentforgeUserId || 'unknown';

    // Calculate approximate expiration time based on 'issued_at' if available, otherwise just use 2 hours from now
    const tokenExpiresAt = Date.now() + (2 * 60 * 60 * 1000);

    // Upsert into Supabase
    await upsertConnection({
      agentforgeUserId: agentforgeUserId,
      orgId: orgId,
      instanceUrl: response.data.instance_url,
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      tokenExpiresAt: tokenExpiresAt
    });

    // Generate a JWT to identify the session/org statelessly on the frontend
    const bearerToken = jwt.sign({
      agentforgeUserId,
      orgId
    }, requireJwtSecret(), { expiresIn: '7d' });

    // Also save to session for backward compatibility
    req.session.orgId = orgId;

    // Redirect to frontend with token in URL
    

    const returnTo = req.session.returnTo || '/';
    const redirectPath = returnTo.startsWith('/') ? returnTo : `/${returnTo}`;
    
    const separator = redirectPath.includes('?') ? '&' : '?';
    res.redirect(`${frontendUrl}${redirectPath}${separator}token=${bearerToken}`);
  } catch (err) {
    console.error('OAuth Error:', err.response?.data || err.message);
    res.status(500).send('Authentication failed. Please try again later.');
  }
});

router.post('/logout', (req, res) => {
  // For stateless JWT, we rely on the client removing the token from localStorage.
  // We still clear the express-session for completeness.
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Failed to logout' });
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

export default router;
export { getCredentialsFromToken };
