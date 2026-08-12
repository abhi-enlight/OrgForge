import jwt from 'jsonwebtoken';
import { encrypt } from './cryptoUtils.js';

/**
 * Legacy re-link flow (plan §8.4, EC-02/EC-38, D4).
 *
 * Agentforge connections are keyed by `agentforge_user_id` (a random UUID per
 * browser session); OrgForge keys by `auth.users.id`. Because both apps share
 * one Supabase project, this is a pure table re-parent:
 *
 *   1. Verify the legacy Agentforge JWT with LEGACY_JWT_SECRET.
 *   2. Move every `public.salesforce_connections` row with that
 *      `agentforge_user_id` onto the signed-in Supabase user — preserving org
 *      METADATA (org_id, instance_url, org_type, alias).
 *   3. Record `legacy_agentforge_user_id` for audit and set `disconnected_at`
 *      so the UI shows "Reconnect this org" (EC-10).
 *
 * Credentials are intentionally NOT migrated: legacy tokens are encrypted with
 * the legacy ENCRYPTION_KEY and, per D4/EC-41, are never re-encrypted. The
 * guaranteed path is the one-time OAuth re-connect. Re-link is best-effort
 * convenience that keeps the org visible — never a blocker (EC-38).
 *
 * @param {object} deps
 * @param {object} deps.supabase - service-role supabase client
 * @param {string} deps.legacyJwt - the token from localStorage.auth_token
 * @param {string} deps.userId - verified Supabase auth.users.id
 * @param {string} [deps.secret] - LEGACY_JWT_SECRET (falls back to env)
 * @returns {Promise<{linked: number, agentforgeUserId: string|null, reason?: string}>}
 */
export async function linkLegacyAgentforgeOrgs({ supabase, legacyJwt, userId, secret }) {
  const legacySecret = secret || process.env.LEGACY_JWT_SECRET;
  if (!legacySecret || !legacyJwt) {
    return { linked: 0, agentforgeUserId: null, reason: legacyJwt ? 'LEGACY_JWT_SECRET not configured' : 'no legacy token' };
  }

  let payload;
  try {
    payload = jwt.verify(legacyJwt, legacySecret);
  } catch (err) {
    // Expired/foreign tokens are silently discarded — never a hard error (EC-02).
    return { linked: 0, agentforgeUserId: null, reason: `legacy JWT invalid: ${err.name}` };
  }

  const agentforgeUserId = payload.agentforgeUserId;
  if (!agentforgeUserId) {
    return { linked: 0, agentforgeUserId: null, reason: 'legacy JWT missing agentforgeUserId' };
  }

  // Legacy RPC keyed by agentforge_user_id (exposed in the shared project).
  const { data: legacyRows, error } = await supabase.rpc('get_connections_by_agentforge_user', {
    p_agentforge_user_id: agentforgeUserId,
  });

  if (error || !Array.isArray(legacyRows) || legacyRows.length === 0) {
    // No rows (or DB error) — nothing to re-parent; the reconnect path covers it.
    return { linked: 0, agentforgeUserId, reason: error ? 'legacy lookup failed' : 'no legacy connections' };
  }

  // Empty credential blob (D4): the org is re-parented but marked disconnected
  // so the one-time OAuth re-connect refreshes real tokens (EC-10).
  // Never a blocker (EC-02/EC-38): a missing ENCRYPTION_KEY degrades to a
  // no-op with a reason instead of a 500.
  let emptyTokens;
  try {
    emptyTokens = encrypt(
      JSON.stringify({ accessToken: null, refreshToken: null, expiresAt: 0 }),
      process.env.ENCRYPTION_KEY
    );
  } catch (encryptErr) {
    return { linked: 0, agentforgeUserId, reason: 'ENCRYPTION_KEY not configured' };
  }

  let linked = 0;
  for (const row of legacyRows) {
    const { error: upsertError } = await supabase
      .from('org_connections')
      .upsert(
        {
          user_id: userId,
          org_id: row.org_id,
          org_type: row.org_type || 'production',
          instance_url: row.instance_url,
          encrypted_tokens: emptyTokens,
          alias: row.alias || null,
          legacy_agentforge_user_id: agentforgeUserId,
          capabilities: ['agents', 'org_change'],
          disconnected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id, org_id' }
      );

    if (!upsertError) {
      linked += 1;
      // Best-effort cleanup of the legacy row so it cannot be re-parented twice.
      await supabase
        .rpc('delete_salesforce_connection_by_user', {
          p_agentforge_user_id: agentforgeUserId,
          p_org_id: row.org_id,
        })
        .catch(() => {});
    }
  }

  return { linked, agentforgeUserId };
}
