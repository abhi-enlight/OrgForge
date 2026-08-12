import { decrypt, encrypt } from './cryptoUtils.js';

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

/**
 * Per-(userId,orgId) in-flight refresh promises (port of Agentforge BUG-3).
 *
 * Salesforce can revoke a refresh token the first time it is used. If two
 * concurrent requests both detect an expiring token and both hit the OAuth
 * endpoint, the second gets `invalid_grant` and the user is logged out
 * (EC-11). This Map makes concurrent refreshes for the same org share ONE
 * promise. The Redis lock (EC-50) extends this across process instances.
 */
const refreshPromises = new Map();

function refreshKey(userId, orgId) {
  return `${userId}|${orgId}`;
}

/**
 * Default Salesforce refresh-token exchange (org-type aware base URL).
 * Injectable so tests can stub the network (plan §8.2).
 */
export async function refreshSalesforceAccessToken(refreshToken, orgType = 'production', instanceUrl) {
  const baseUrl =
    orgType === 'sandbox'
      ? 'https://test.salesforce.com'
      : orgType === 'scratch'
        ? (instanceUrl || '').replace(/\/$/, '') // scratch orgs refresh on their own instance
        : 'https://login.salesforce.com';

  if (orgType === 'scratch' && !instanceUrl) {
    const err = new Error('Scratch orgs require an instanceUrl for token refresh');
    err.status = 400;
    throw err;
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.SALESFORCE_CLIENT_ID,
    client_secret: process.env.SALESFORCE_CLIENT_SECRET,
    redirect_uri: process.env.SALESFORCE_REDIRECT_URI,
  });

  const response = await fetch(`${baseUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const err = new Error(`Salesforce token refresh failed (${response.status})`);
    err.status = response.status === 401 || response.status === 400 ? 401 : response.status;
    throw err;
  }

  const data = await response.json();
  const expiresIn = Number(data.expires_in) || 7200;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

/**
 * Loads decrypted Salesforce credentials for a user + org, transparently
 * refreshing the access token when it is missing, expired, or about to expire.
 *
 * Works with any supabase client (RLS-scoped request client or the admin
 * client used by background jobs). Every query is tenant-scoped by the caller
 * passing the verified userId (tenantIsolation contract).
 *
 * @param {object} db - supabase client
 * @param {string} userId - authenticated user id (auth.users.id)
 * @param {string} orgId - Salesforce org id
 * @param {object} [opts]
 * @param {(refreshToken: string, orgType?: string, instanceUrl?: string) => Promise<{accessToken: string, refreshToken: string, expiresAt: number}>} [opts.refresher]
 * @param {() => Promise<void>|void} [opts.onRefreshFailure] - called when refresh fails (default: no-op; routes may mark org disconnected, EC-10)
 * @returns {Promise<{accessToken: string, refreshToken: string, instanceUrl: string, orgType: string, expiresAt: number}>}
 */
export async function getOrgCredentials(db, userId, orgId, opts = {}) {
  const refresher = opts.refresher || refreshSalesforceAccessToken;

  if (!orgId) {
    const err = new Error('orgId is required');
    err.status = 400;
    throw err;
  }

  const { data: orgConn, error } = await db
    .from('org_connections')
    .select('instance_url, encrypted_tokens, org_type')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single();

  if (error || !orgConn) {
    const err = new Error('Org connection not found');
    err.status = 404;
    throw err;
  }

  const tokensStr = decrypt(orgConn.encrypted_tokens, process.env.ENCRYPTION_KEY);
  if (!tokensStr) {
    const err = new Error('Failed to decrypt org credentials');
    err.status = 500;
    throw err;
  }

  const tokens = JSON.parse(tokensStr);
  const { instance_url: instanceUrl, org_type: orgType } = orgConn;

  const shouldRefresh =
    tokens.refreshToken &&
    (!tokens.expiresAt || tokens.expiresAt - REFRESH_MARGIN_MS < Date.now());

  if (shouldRefresh) {
    const key = refreshKey(userId, orgId);

    if (!refreshPromises.has(key)) {
      const refreshPromise = (async () => {
        try {
          const refreshed = await refresher(
            tokens.refreshToken,
            orgType,
            orgType === 'scratch' ? instanceUrl : undefined
          );
          tokens.accessToken = refreshed.accessToken;
          tokens.refreshToken = refreshed.refreshToken || tokens.refreshToken;
          tokens.expiresAt = refreshed.expiresAt;

          const reEncrypted = encrypt(JSON.stringify(tokens), process.env.ENCRYPTION_KEY);
          if (reEncrypted) {
            await db
              .from('org_connections')
              .update({ encrypted_tokens: reEncrypted })
              .eq('org_id', orgId)
              .eq('user_id', userId);
          }
          // All concurrent callers awaiting this promise receive the fresh
          // credentials, not their own stale copy of `tokens`.
          return { ok: true, accessToken: refreshed.accessToken, refreshToken: tokens.refreshToken, expiresAt: refreshed.expiresAt };
        } catch (err) {
          console.error(`Token refresh failed for org ${orgId}:`, err.message);
          if (typeof opts.onRefreshFailure === 'function') {
            try { await opts.onRefreshFailure(err); } catch (hookErr) {
              console.error('onRefreshFailure hook error:', hookErr.message);
            }
          }
          return { ok: false };
        } finally {
          refreshPromises.delete(key);
        }
      })();

      refreshPromises.set(key, refreshPromise);
    }

    const result = await refreshPromises.get(key);
    if (!result?.ok) {
      // Refresh failed (e.g. revoked token). The stored access token may be
      // stale — surface a 401 so the caller can drive the "Reconnect org" flow
      // (EC-10) instead of racing on a dead token.
      const err = new Error('Salesforce credentials could not be refreshed');
      err.status = 401;
      throw err;
    }

    // Apply the shared refresh result to this caller's copy so every
    // concurrent request returns the fresh token (BUG-3 dedup correctness).
    tokens.accessToken = result.accessToken;
    tokens.refreshToken = result.refreshToken;
    tokens.expiresAt = result.expiresAt;
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    instanceUrl,
    orgType,
    expiresAt: tokens.expiresAt,
  };
}

/** Clears the in-flight refresh dedup map (tests / org disconnect). */
export function _clearRefreshDedup() {
  refreshPromises.clear();
}
