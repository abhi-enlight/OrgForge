'use strict';

// BUG-6 fix: Use the shared Supabase client from dbClient instead of creating a new instance.
import { getClient } from './dbClient.js'
import { GoogleGenerativeAI } from '@google/generative-ai'

// ─────────────────────────────────────────────────────────────
//  AI JUDGE SERVICE
//  Reads failure logs from the last 24h, sends them to Gemini,
//  and inserts auto-generated corrective rules into ai_lessons
//  with is_active = false for developer review.
// ─────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY);

// ─────────────────────────────────────────────────────────────
//  runJudge()
//  Main entry point called by the internal route.
//  Returns a summary of what was done.
// ─────────────────────────────────────────────────────────────
async function runJudge() {
  const client = getClient();
  if (!client) {
    return { success: false, error: '[AI JUDGE] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }
  const startedAt = new Date().toISOString();
  console.log(`\n[AI JUDGE] ── Starting run at ${startedAt} ──`);

  // Step 1: Fetch all FAILED logs from the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: failures, error: fetchErr } = await client
    .schema('agentforge_logs')
    .from('ai_logs')
    .select('id, error_code, salesforce_error, prompt')
    .eq('status', 'FAILED')
    .gte('created_at', since)
    .limit(50); // cap to avoid massive prompts

  if (fetchErr) {
    console.error('[AI JUDGE] Failed to fetch logs:', fetchErr.message);
    return { success: false, error: fetchErr.message };
  }

  if (!failures || failures.length === 0) {
    console.log('[AI JUDGE] No failures in the last 24 hours. Nothing to do. Exiting.');
    return { success: true, lessonsInserted: 0, message: 'No failures found.' };
  }

  console.log(`[AI JUDGE] Found ${failures.length} failure(s). Sending to Gemini for analysis...`);

  // Step 2: Group failures by error_code to deduplicate and find patterns
  const grouped = {};
  for (const f of failures) {
    const code = f.error_code || 'UNKNOWN';
    if (!grouped[code]) grouped[code] = [];
    grouped[code].push({
      salesforce_error: f.salesforce_error,
      prompt_snippet: f.prompt ? f.prompt.substring(0, 200) : '(no prompt)'
    });
  }

  // Build a rich summary for the judge prompt with multiple sample errors per code
  const errorSummary = Object.entries(grouped)
    .map(([code, instances]) => {
      const uniqueErrors = [...new Set(instances.map(i => i.salesforce_error || '(none)'))].slice(0, 3);
      const samplePrompt = instances[0].prompt_snippet;
      const errorListText = uniqueErrors.map((err, idx) => `  ${idx + 1}. ${err}`).join('\n');
      return `Error Code: ${code} (occurred ${instances.length} time(s))\nSample Error Messages:\n${errorListText}\nSample User Prompt Snippet: "${samplePrompt}"`;
    })
    .join('\n\n---\n\n');

  // Step 3: Build the judge prompt
  const judgePrompt = `You are a Principal Salesforce Architect and AI Systems Engineer reviewing deployment and build failures made by an autonomous AI agent builder called Agentforge.

Agentforge builds Salesforce Agentforce agents by generating conversational agent YAML instructions, Apex invocable actions, Permission Sets, and metadata ZIP packages.
When Agentforge makes mistakes during deployment or code generation, this AI Judge analyzes the failure logs and synthesizes corrective system prompt rules.
The rules you generate will be injected directly into Agentforge's runtime System Prompt under "## LEARNED LESSONS FROM PAST FAILURES (MANDATORY)".

The AI builder encountered the following deployment errors in the last 24 hours. Each entry shows the Salesforce error code, sample error messages, and a snippet of the user's original prompt:

${errorSummary}

For each DISTINCT error pattern or root cause above, synthesize ONE precise, authoritative system prompt rule that will prevent Agentforge from repeating this mistake.

### CORE ARCHITECTURAL KNOWLEDGE & REMEDY GUIDELINES FOR THE JUDGE:
When formulating rules, you MUST apply your expert domain knowledge of Agentforce and Salesforce architecture:
1. **What Data Objects to Access vs. Avoid (License Restrictions)**:
   - Einstein Agent Users and standard Agentforce Service Agent licenses have strict data model limitations. They completely forbid org-wide "View All Records", "Modify All Records", or "Create" permissions on restricted standard CRM objects like \`Case\`, \`Order\`, \`Invoice\`, \`Lead\`, and \`Opportunity\`.
   - If an error involves license permission limits (e.g., \`LICENSE_LIMIT_EXCEEDED\`, \`SECURITY_RESTRICTION_ERROR\`, or "The user license doesn't allow the permission..."), your rule MUST instruct the AI builder to NEVER blindly retry deploying permissions on standard objects.
   - Instead, the rule must instruct the AI builder to propose an architectural remedy: advise the user of the license limitation and switch to a Custom Object ending in \`__c\` (e.g., \`Support_Ticket__c\`, \`Customer_Order__c\`, \`Client_Invoice__c\`), which fully supports agent access without license conflicts.
2. **Apex Action & Wrapper Class Architecture**:
   - Invocable Apex methods for Agentforce must take \`List<InputWrapper>\` and return \`List<OutputWrapper>\`. Passing primitive lists strips away description metadata.
   - Every wrapper variable must be annotated with \`@InvocableVariable(required=... label='...' description='...')\`.
   - Rules for Apex compilation errors (\`COMPILE_ERROR\`, \`INVALID_TYPE\`, etc.) must prescribe exact syntax fixes, bulkification rules, or wrapper patterns.
3. **Metadata, SOQL & Schema Guardrails**:
   - Never use wildcards (\`*\`) in \`package.xml\`. All user-facing strings in XML must be properly XML-escaped.
   - SOQL queries must query real schema fields; never generate fake data or use \`Math.random()\`.
   - Custom object and custom field API names must always end with \`__c\`.
4. **Graceful Error Handling & Retry Prevention**:
   - If an error is unrecoverable via automated code tweaks (such as license limits or missing org features), instruct the AI builder to stop retrying immediately and explain the error and exact remedy gracefully to the user once in plain English.

### IMPORTANT RULES FOR YOUR RESPONSE:
1. Respond ONLY with a valid JSON array. No markdown code fences, no commentary or explanation outside the JSON.
2. Each element must be a JSON object with exactly these keys: "topic", "rule", "error_pattern".
3. "topic" — A concise category title (e.g., "Standard Object License Limits", "Apex String Literals", "SOQL Invocable Wrapper").
4. "rule" — A direct, authoritative system prompt instruction directed at the AI agent builder starting with "CRITICAL:", "ALWAYS:", "NEVER:", or "REMEDY RULE:". It must clearly state WHAT went wrong, WHAT objects or patterns to use/avoid, and WHAT architectural remedy to execute.
5. "error_pattern" — The Salesforce error_code from the input (e.g., "LICENSE_LIMIT_EXCEEDED", "COMPILE_ERROR").

Example format:
[
  {
    "topic": "Standard Object License Limits",
    "rule": "REMEDY RULE: Einstein Agent Users cannot be assigned View/Modify All permissions on standard objects like Case, Order, Invoice, or Lead. If a deployment fails with license permission errors or if the user requests standard CRM object features, NEVER retry identical permission sets. Immediately stop retrying, explain the license limitation to the user in plain English, and propose creating a Custom Object (e.g., Support_Ticket__c or Customer_Order__c) as your remedy.",
    "error_pattern": "LICENSE_LIMIT_EXCEEDED"
  },
  {
    "topic": "Apex String Literals",
    "rule": "CRITICAL: Always use single quotes for string literals in Apex. Double quotes cause compilation failures. When concatenating multi-line strings or queries, ensure proper spacing between words.",
    "error_pattern": "COMPILE_ERROR"
  }
]`;

  // Step 4: Call Gemini
  // BUG-13 fix: Use JUDGE_MODEL env var or fall back to the correct model identifier.
  let lessons = [];
  try {
    const model = genAI.getGenerativeModel({ model: process.env.JUDGE_MODEL || 'gemini-3.6-flash' });
    const result = await model.generateContent(judgePrompt);
    const rawText = result.response.text().trim();

    // Strip markdown code fences if Gemini wraps the JSON
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    lessons = JSON.parse(jsonText);

    if (!Array.isArray(lessons)) {
      throw new Error('Gemini response was not a JSON array');
    }
    console.log(`[AI JUDGE] Gemini generated ${lessons.length} corrective rule(s).`);
  } catch (geminiErr) {
    console.error('[AI JUDGE] Gemini analysis failed:', geminiErr.message);
    return { success: false, error: 'Gemini analysis failed: ' + geminiErr.message };
  }

  // Step 5: Insert lessons into ai_lessons with is_active = FALSE
  let insertedCount = 0;
  for (const lesson of lessons) {
    if (!lesson.topic || !lesson.rule) continue; // skip malformed entries

    const { error: insertErr } = await client
      .schema('agentforge_logs')
      .from('ai_lessons')
      .insert({
        topic:         lesson.topic,
        rule:          lesson.rule,
        error_pattern: lesson.error_pattern || null,
        is_active:     false,  // ALWAYS false — requires developer approval
        priority:      5       // default mid-priority; developer can change after review
      });

    if (insertErr) {
      console.error(`[AI JUDGE] Failed to insert lesson "${lesson.topic}":`, insertErr.message);
    } else {
      insertedCount++;
      console.log(`[AI JUDGE] Inserted lesson for review: [${lesson.topic}]`);
    }
  }

  // Step 6: Log summary to Render console
  console.log(`\n[AI JUDGE] ── Run complete ──`);
  console.log(`[AI JUDGE] Failures analysed: ${failures.length}`);
  console.log(`[AI JUDGE] Lessons inserted (pending review): ${insertedCount}`);
  console.log(`[AI JUDGE] Review them at: https://supabase.com/dashboard/project/mhwvoomjzfdiwanrfusz/sql/new`);
  console.log(`[AI JUDGE] SQL: SELECT id, topic, rule FROM agentforge_logs.ai_lessons WHERE is_active = false ORDER BY created_at DESC;\n`);

  return {
    success:          true,
    failuresAnalysed: failures.length,
    lessonsInserted:  insertedCount,
    completedAt:      new Date().toISOString()
  };
}

// ─────────────────────────────────────────────────────────────
//  analyzeSingleFailure()
//  Analyzes a single deployment failure in real-time.
//  Returns a single rule string or null if analysis fails.
// ─────────────────────────────────────────────────────────────
async function analyzeSingleFailure(salesforceError, promptSnippet, chatHistory, errorCode) {
  if (!salesforceError) return null;
  
  const judgePrompt = `You are a Principal Salesforce Architect and AI Systems Engineer reviewing a real-time deployment failure made by an autonomous AI agent builder called Agentforge.

Agentforge builds Salesforce Agentforce agents. The agent just encountered this error during deployment:

Error Code: ${errorCode || 'UNKNOWN'}
Salesforce Error Message:
${salesforceError}

User Prompt Snippet:
"${promptSnippet}"

Recent Chat History Context:
${chatHistory}

Based on the error, the user's intent, and the conversational context, synthesize ONE precise, authoritative system prompt rule that will help Agentforge fix this specific mistake on its next immediate retry.

### CORE ARCHITECTURAL KNOWLEDGE & REMEDY GUIDELINES:
1. **What Data Objects to Access vs. Avoid**:
   - Einstein Agent Users cannot have org-wide "View All Records" or "Modify All Records" on restricted standard objects (e.g. Case, Order, Invoice, Lead). 
   - If the error involves license permission limits (e.g. \`LICENSE_LIMIT_EXCEEDED\`, \`SECURITY_RESTRICTION_ERROR\`), tell the AI builder to STOP retrying identical permission sets, explain the license limitation to the user, and propose a Custom Object (e.g. \`Support_Ticket__c\`).
2. **Apex Action & Wrapper Class Architecture**:
   - Invocable Apex methods must take \`List<InputWrapper>\` and return \`List<OutputWrapper>\`.
   - Every wrapper variable must be annotated with \`@InvocableVariable(required=... label='...' description='...')\`.
   - For compilation errors (\`COMPILE_ERROR\`, \`INVALID_TYPE\`), prescribe exact syntax fixes.
3. **Graceful Error Handling & Retry Prevention**:
   - If unrecoverable without user input, instruct the AI to explain the error to the user and stop retrying.

### IMPORTANT RULES FOR YOUR RESPONSE:
Respond ONLY with the precise rule text (a string). Do not use JSON. Do not include commentary. Start your rule with "CRITICAL:", "ALWAYS:", "NEVER:", or "REMEDY RULE:". It must clearly state WHAT went wrong and WHAT architectural fix to execute.`;

  try {
    const model = genAI.getGenerativeModel({ model: process.env.JUDGE_MODEL || 'gemini-3.6-flash' });
    const result = await model.generateContent(judgePrompt);
    const rawText = result.response.text().trim();
    return rawText;
  } catch (err) {
    console.error('[AI JUDGE] analyzeSingleFailure failed:', err.message);
    return null;
  }
}

export { runJudge, analyzeSingleFailure };
