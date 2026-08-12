'use strict';

// BUG-6 fix: Use the shared Supabase client from dbClient instead of creating a new instance.
import { getClient } from './dbClient.js'

//  saveLog()
//  Called from aiOrchestrator.js when a deployment fails.
//  Writes one row to agentforge_logs.ai_logs.
//  This is fire-and-forget — never throws, never blocks the user.
async function saveLog({ userId, sessionId, prompt, aiResponse, toolCalls, salesforceError, errorCode, status, latencyMs, modelVersion }) {
  const client = getClient();
  if (!client) return;

  try {
    const { error } = await client
      .schema('agentforge_logs')
      .from('ai_logs')
      .insert({
        user_id:          userId        || 'unknown',
        session_id:       sessionId     || null,
        prompt:           prompt        || '',
        ai_response:      aiResponse    || null,
        tool_calls:       toolCalls     || null,
        salesforce_error: salesforceError || null,
        error_code:       errorCode     || null,
        status:           status        || 'FAILED',
        latency_ms:       latencyMs     || null,
        model_version:    modelVersion  || process.env.GEMINI_MODEL || 'gemini'
      });

    if (error) {
      console.error('[LOG_SERVICE] Failed to save log:', error.message);
    } else {
      console.log(`[LOG_SERVICE] Saved ${status} log for session ${sessionId}`);
    }
  } catch (err) {
    // Never let logging crash the main request
    console.error('[LOG_SERVICE] Unexpected error saving log:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  fetchActiveLessons()
//  Called from aiOrchestrator.js before each Gemini call.
//  Returns an array of active lesson rule strings, sorted by priority.
//  Returns [] if no lessons or Supabase is unavailable.
// ─────────────────────────────────────────────────────────────
async function fetchActiveLessons() {
  const client = getClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .schema('agentforge_logs')
      .from('ai_lessons')
      .select('topic, rule')
      .eq('is_active', true)
      .gte('priority', 7)           // only inject high-priority rules (7–10)
      .order('priority', { ascending: false })
      .limit(10);                   // hard cap — top-10 by priority only

    if (error) {
      console.error('[LOG_SERVICE] Failed to fetch lessons:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[LOG_SERVICE] Unexpected error fetching lessons:', err.message);
    return [];
  }
}

export { saveLog, fetchActiveLessons };
