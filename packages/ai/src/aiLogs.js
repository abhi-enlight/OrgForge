/**
 * Unified ai_logs writer (plan §3, §9.1) — ONE writer for BOTH engines,
 * writing to `forge.ai_logs`. The table is a merged superset of Agentforge's
 * `agentforge_logs.ai_logs` (user_id, session_id, prompt, ai_response,
 * tool_calls, salesforce_error, error_code, status, latency_ms, model_version)
 * and OrgForge's `orgforge.ai_logs` (intent_id, dry_run_errors,
 * ai_repair_attempts).
 *
 * Deliberately FIRE-AND-FORGET — this is the Agentforge logService contract
 * ("never let logging crash the main request"): it never throws. A missing
 * table (migration 008 pending) is warned and skipped; any other DB error is
 * warned and skipped. This differs from the request-critical S-2 writers
 * (routing_log, chat_sessions) which fail loudly — ai_logs feeds analytics +
 * the lessons loop, so availability of the row must never cost a user request.
 *
 * @param {object} opts
 * @param {object} opts.db - forge-schema supabase client (`.from('ai_logs').insert`)
 * @param {string} [opts.userId]
 * @param {string} [opts.orgId]
 * @param {string} [opts.sessionId]
 * @param {'agent'|'org_change'} [opts.capability]
 * @param {string} [opts.prompt]
 * @param {string} [opts.aiResponse]
 * @param {unknown} [opts.toolCalls]
 * @param {string} [opts.salesforceError]
 * @param {'SUCCESS'|'FAILED'} [opts.status]
 * @param {string} [opts.errorCode]
 * @param {number} [opts.latencyMs]
 * @param {string} [opts.modelVersion]
 * @param {string} [opts.intentId]
 * @returns {Promise<{ok?: true, missing?: true, error?: string}>}
 */
export async function writeAiLog({
  db,
  userId,
  orgId,
  sessionId,
  capability,
  prompt,
  aiResponse,
  toolCalls,
  salesforceError,
  status = 'SUCCESS',
  errorCode,
  latencyMs,
  modelVersion,
  intentId,
}) {
  if (!db || typeof db.from !== 'function') {
    return { error: 'no db provided' };
  }

  let result;
  try {
    result = await db.from('ai_logs').insert({
      user_id: userId || null,
      org_id: orgId || null,
      session_id: sessionId || null,
      capability: capability || null,
      prompt: prompt || null,
      ai_response: aiResponse || null,
      tool_calls: toolCalls ?? null,
      salesforce_error: salesforceError || null,
      status,
      error_code: errorCode || null,
      latency_ms: Number.isFinite(latencyMs) ? latencyMs : null,
      model_version: modelVersion || null,
      intent_id: intentId || null,
    });
  } catch (err) {
    // supabase-js usually returns errors, but a thrown error is possible.
    console.warn(`[ai_logs] write failed (fire-and-forget): ${err.message}`);
    return { error: err.message };
  }

  const error = result?.error;
  if (!error) return { ok: true };

  // Missing table (migration 008 not applied) → skip quietly, warn once.
  if (/could not find the table|does not exist|PGRST106|invalid schema/i.test(error.message || error)) {
    console.warn('[ai_logs] write skipped (migration 008 not applied?): table missing');
    return { missing: true };
  }
  console.warn(`[ai_logs] write failed (fire-and-forget): ${error.message}`);
  return { error: error.message };
}
