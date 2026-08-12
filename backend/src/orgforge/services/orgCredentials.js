import { decrypt, encrypt } from '../utils/cryptoUtils.js';
import { salesforceClient } from './salesforceClient.js';

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

/**
 * Loads decrypted Salesforce credentials for a user + org, transparently
 * refreshing the access token when it is missing, expired, or about to expire.
 *
 * Works with any supabase client (RLS-scoped request client or the admin
 * client used by background jobs).
 *
 * @param {object} db     - supabase client
 * @param {string} userId - authenticated user id
 * @param {string} orgId  - Salesforce org id
 * @returns {Promise<{accessToken: string, refreshToken: string, instanceUrl: string, orgType: string, expiresAt: number}>}
 */
export async function getOrgCredentials(db, userId, orgId) {
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
    try {
      const refreshed = await salesforceClient.refreshAccessToken(
        tokens.refreshToken,
        orgType,
        // Scratch orgs refresh on their own instance URL, not login.salesforce.com
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
    } catch (err) {
      // Refresh failed (e.g. revoked refresh token). Keep the stored access
      // token as a last resort and surface the failure in the logs.
      console.error(`Token refresh failed for org ${orgId}:`, err.message);
    }
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    instanceUrl,
    orgType,
    expiresAt: tokens.expiresAt
  };
}
