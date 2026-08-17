/**
 * Pure core for the Nightly AI Self-Improvement & Failure Judge loop.
 *
 * Analyzes failure traces in orgforge.ai_logs (both agent builds and org changes),
 * clusters error patterns, and uses Gemini Flash to synthesize deduplicated,
 * actionable rules into orgforge.ai_lessons.
 */
import { supabaseAdmin } from './supabaseClients.js';
import { aiOrchestrator } from '../orgforge/services/aiOrchestrator.js';

const SYSTEM_JUDGE_PROMPT = `You are the OrgForge Unified Architecture & Failure Judge.
Analyze recent failure logs across both Salesforce Agentforce agent builds and declarative org metadata changes.
Synthesize up to 3 distinct, concise, actionable architectural rules (under 80 words each) to prevent these failure modes in future AI generations.

CRITICAL INSTRUCTIONS:
- Do NOT duplicate or re-state any existing active rules provided below.
- Do NOT generate rules for transient errors (e.g., network timeouts, expired tokens, rate limits).
- Only generate rules for architectural, schema, DSL syntax, permission wrapper, or metadata generation mistakes that an LLM can avoid.
- If all failures are already covered or transient, return an empty array.
- Output MUST be valid JSON in the format: {"newLessons": ["Rule 1...", "Rule 2..."]}`;

/**
 * Normalizes and clusters recent error logs to minimize tokens sent to the LLM.
 */
export function clusterErrorLogs(logs = []) {
  const clusters = [];
  const seenKeys = new Set();

  for (const log of logs) {
    const errorDetails = [];
    if (log.salesforce_error) errorDetails.push(`SF Error: ${log.salesforce_error}`);
    if (log.error_code) errorDetails.push(`Error Code: ${log.error_code}`);
    if (log.dry_run_errors) {
      const dryErrors = Array.isArray(log.dry_run_errors)
        ? log.dry_run_errors.map(e => e.problem || e.message || JSON.stringify(e)).join('; ')
        : JSON.stringify(log.dry_run_errors);
      errorDetails.push(`Dry Run Failures: ${dryErrors}`);
    }

    if (errorDetails.length === 0 && log.status === 'FAILED') {
      errorDetails.push('Execution failed with unspecified error');
    }

    if (errorDetails.length === 0) continue;

    const signature = `${log.capability || 'unknown'}:${errorDetails.join(' | ')}`;
    if (!seenKeys.has(signature)) {
      seenKeys.add(signature);
      clusters.push({
        capability: log.capability || 'unknown',
        promptSnippet: typeof log.prompt === 'string' ? log.prompt.slice(0, 300) : '',
        error: errorDetails.join(' | '),
        repairAttempts: log.ai_repair_attempts || 0,
      });
    }
  }

  return clusters;
}

/**
 * Runs the self-improvement synthesis pass over the last N hours of logs.
 */
export async function runSelfImprovement({
  db = supabaseAdmin,
  ai = aiOrchestrator,
  lookbackHours = 24,
  maxActiveLessons = 25,
  now = Date.now(),
} = {}) {
  const cutoff = new Date(now - lookbackHours * 60 * 60 * 1000).toISOString();

  // 1. Fetch recent failures across both capabilities
  let recentLogs;
  try {
    const { data, error } = await db
      .from('ai_logs')
      .select('id, capability, prompt, ai_response, tool_calls, salesforce_error, error_code, status, dry_run_errors, ai_repair_attempts, created_at')
      .gte('created_at', cutoff);

    if (error) {
      if (error.message?.includes('Could not find') || error.code === 'PGRST106' || error.code === 'PGRST205') {
        console.warn('[self-improvement] ai_logs table not found (migration pending) — skipping.');
        return { missingTable: true, synthesizedCount: 0 };
      }
      throw new Error(`Failed to fetch ai_logs: ${error.message}`);
    }

    recentLogs = data || [];
  } catch (err) {
    if (err.message?.includes('Could not find') || err.code === 'PGRST106' || err.code === 'PGRST205') {
      return { missingTable: true, synthesizedCount: 0 };
    }
    throw err;
  }

  // Filter for failures only
  const failures = recentLogs.filter(
    log => log.status === 'FAILED' || log.dry_run_errors != null || log.salesforce_error != null
  );

  if (failures.length === 0) {
    return { success: true, synthesizedCount: 0, reason: 'no_failures' };
  }

  // 2. Cluster logs to eliminate token waste
  const clustered = clusterErrorLogs(failures);
  if (clustered.length === 0) {
    return { success: true, synthesizedCount: 0, reason: 'no_meaningful_errors' };
  }

  // 3. Fetch current active lessons for deduplication
  let activeLessons = [];
  try {
    const { data: lessons, error } = await db
      .from('ai_lessons')
      .select('id, lesson_text, created_at')
      .eq('active', true);
    if (!error && lessons) {
      activeLessons = lessons;
    }
  } catch (err) {
    console.warn('[self-improvement] Could not read existing ai_lessons:', err.message);
  }

  const existingRulesText = activeLessons.length > 0
    ? activeLessons.map((l, i) => `${i + 1}. ${l.lesson_text}`).join('\n')
    : 'None';

  const userPrompt = `EXISTING ACTIVE RULES:
${existingRulesText}

RECENT FAILURE SIGNATURES (Last ${lookbackHours}h):
${JSON.stringify(clustered, null, 2)}

Synthesize new non-duplicate rules to prevent these failures.`;

  // 4. Generate new lessons with Gemini
  let responseText;
  try {
    responseText = await ai.generateContent(userPrompt, SYSTEM_JUDGE_PROMPT);
  } catch (aiErr) {
    console.error('[self-improvement] AI synthesis call failed:', aiErr);
    throw aiErr;
  }

  let newLessons = [];
  if (responseText) {
    try {
      const cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed?.newLessons)) {
        newLessons = parsed.newLessons.filter(r => typeof r === 'string' && r.trim().length > 0);
      } else if (Array.isArray(parsed)) {
        newLessons = parsed.filter(r => typeof r === 'string' && r.trim().length > 0);
      }
    } catch {
      // If not strict JSON, fallback to line extraction if not empty
      if (!responseText.includes('NO_NEW_RULES') && responseText.trim().length > 10) {
        newLessons = [responseText.trim()];
      }
    }
  }

  if (newLessons.length === 0) {
    return { success: true, synthesizedCount: 0, reason: 'no_new_lessons' };
  }

  // 5. Insert new lessons into orgforge.ai_lessons
  const insertedLessons = [];
  for (const lessonText of newLessons) {
    const { error: insertError } = await db
      .from('ai_lessons')
      .insert({ lesson_text: lessonText.trim(), active: true });

    if (insertError) {
      console.error('[self-improvement] Failed to insert lesson:', insertError.message);
    } else {
      insertedLessons.push(lessonText.trim());
    }
  }

  // 6. Prune old lessons if active count exceeds maxActiveLessons
  if (activeLessons.length + insertedLessons.length > maxActiveLessons) {
    try {
      const overflowCount = (activeLessons.length + insertedLessons.length) - maxActiveLessons;
      const oldestToArchive = activeLessons.slice(0, overflowCount);
      for (const old of oldestToArchive) {
        await db.from('ai_lessons').update({ active: false }).eq('id', old.id);
      }
    } catch (pruneErr) {
      console.warn('[self-improvement] Pruning active lessons failed (non-fatal):', pruneErr.message);
    }
  }

  return {
    success: true,
    synthesizedCount: insertedLessons.length,
    lessons: insertedLessons,
  };
}
