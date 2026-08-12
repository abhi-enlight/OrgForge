'use strict';

import { createClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '../utils/cryptoUtils.js'

// ─────────────────────────────────────────────────────────────
//  SHARED SUPABASE CLIENT (BUG-6 fix)
//  Single singleton for the entire backend. logService.js and
//  judgeService.js import this instead of creating their own.
// ─────────────────────────────────────────────────────────────
let supabase = null;

function getClient() {
  if (supabase) return supabase;

  // Unified Supabase naming first; legacy Agentforge names still honored for
  // existing env files (PROJECT_URL / SERVICE_ROLE_KEY).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PROJECT_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn('[DB_CLIENT] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — database disabled.');
    return null;
  }

  supabase = createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: 'public' }
  });

  return supabase;
}

async function upsertConnection({ agentforgeUserId, orgId, instanceUrl, accessToken, refreshToken, tokenExpiresAt }) {
  const client = getClient();
  if (!client) throw new Error('Database not configured');

  const encryptedAccessToken = encrypt(accessToken);
  const encryptedRefreshToken = encrypt(refreshToken);

  const { data, error } = await client.rpc('upsert_salesforce_connection', {
    p_agentforge_user_id: agentforgeUserId,
    p_org_id: orgId,
    p_instance_url: instanceUrl,
    p_access_token: encryptedAccessToken,
    p_refresh_token: encryptedRefreshToken,
    p_token_expires_at: tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : null
  });

  if (error) {
    console.error('[DB_CLIENT] Failed to upsert connection:', error.message);
    throw error;
  }
  return data;
}

async function getConnection(orgId) {
  const client = getClient();
  if (!client) throw new Error('Database not configured');

  const { data, error } = await client.rpc('get_salesforce_connection', {
    p_org_id: orgId
  });

  if (error) {
    console.error('[DB_CLIENT] Failed to get connection:', error.message);
    throw error;
  }
  
  if (data) {
    data.access_token = decrypt(data.access_token);
    data.refresh_token = decrypt(data.refresh_token);
  }
  return data;
}

async function updateConnectionTokens(orgId, { accessToken, tokenExpiresAt }) {
  const client = getClient();
  if (!client) throw new Error('Database not configured');

  const encryptedAccessToken = encrypt(accessToken);

  const { data, error } = await client.rpc('update_salesforce_connection_tokens', {
    p_org_id: orgId,
    p_access_token: encryptedAccessToken,
    p_token_expires_at: tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : null
  });

  if (error) {
    console.error('[DB_CLIENT] Failed to update tokens:', error.message);
    throw error;
  }
  return data;
}

export { getClient, upsertConnection, getConnection, updateConnectionTokens };
