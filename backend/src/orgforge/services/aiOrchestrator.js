import { GoogleGenAI } from '@google/genai';
import {
  normalizeOperation,
  normalizeTargetComponent,
  normalizeTargetField,
  isSafeAggregateSoql,
  isWellFormedXml,
  validateCustomFieldXml,
} from '../utils/aiSafety.js';
import { supabaseAdmin } from '../../lib/supabaseClients.js';

const DEFAULT_MODEL = 'gemini-3.1-pro-preview';

// LLM consumption bounds (security hardening): cap prompt size and output
// tokens so a malicious or accidental input cannot cause unbounded token
// spend, and keep generated output within the model's supported window.
const MAX_PROMPT_CHARS = 30_000;
const MAX_SYSTEM_INSTRUCTION_CHARS = 60_000;
const MAX_OUTPUT_TOKENS = 8192;

function getApiKey() {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key || key === 'DUMMY_KEY') {
    throw new Error('GOOGLE_AI_API_KEY is not set. Configure it in backend/.env to use AI features.');
  }
  return key;
}

class AiOrchestrator {
  constructor() {
    this.modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    this._ai = null;
  }

  /** Lazily instantiated so a missing API key fails at call time, not at boot. */
  get ai() {
    if (!this._ai) {
      this._ai = new GoogleGenAI({ apiKey: getApiKey() });
    }
    return this._ai;
  }

  /**
   * Single entry point for LLM calls using the @google/genai SDK.
   * Supports both plain prompts and system-instruction prompts.
   */
  async generateContent(contents, systemInstruction) {
    const cappedContents =
      typeof contents === 'string' ? contents.slice(0, MAX_PROMPT_CHARS) : contents;
    const config = { maxOutputTokens: MAX_OUTPUT_TOKENS };
    if (systemInstruction) {
      config.systemInstruction = systemInstruction.slice(0, MAX_SYSTEM_INSTRUCTION_CHARS);
    }
    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: cappedContents,
      config,
    });
    return response?.text ?? '';
  }

  _extractJson(text) {
    if (!text) return null;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  /**
   * Parse the natural language prompt into a structured, VALIDATED intent.
   * Every LLM-derived field is normalized against the safety whitelist.
   * `conversationContext` (optional) is the bounded digest of earlier turns in
   * this session so follow-ups like "do the same for Account" resolve.
   */
  async parseIntent(prompt, businessRationale, orgContext, conversationContext) {
    const sysPrompt = `
      You are the OrgForge Intent Parser.
      Context: ${JSON.stringify(orgContext)}
      ${conversationContext ? `\n      Conversation Context (earlier turns in THIS session — use it to disambiguate follow-ups, never to invent metadata):\n      ${conversationContext}` : ''}

      Extract the target component, operation (CREATE, UPDATE, DELETE), and potential ambiguities.
      Analyze the intent for specific Salesforce ambiguities, such as Validation Rule formula scope (e.g., ISCHANGED(StageName) vs static checks).

      Return ONLY a JSON object with this exact structure:
      {
        "operation": "UPDATE_CUSTOM_FIELD",
        "targetComponent": "Support_Ticket__c",
        "targetField": "Status__c",
        "ambiguities": [
          {
            "id": "opt1",
            "title": "Enforce on Record Edit & Stage Change",
            "desc": "Fires when an Opportunity is currently in Closed Lost stage AND Loss_Reason__c is blank.",
            "recommended": true
          }
        ]
      }
      Rules:
      - targetComponent is ALWAYS the OBJECT API name only (e.g. "Opportunity", "Support_Ticket__c").
      - If the request names a specific child component (field, validation rule), e.g. "Support_Ticket__c.Status__c",
        put the child API name in targetField ("Status__c") and NEVER append it to targetComponent.
      - Leave targetField null when the operation targets a whole component (object, class, trigger, flow, etc.).
      - Use an operation from this list only: CREATE_VALIDATION_RULE, UPDATE_VALIDATION_RULE, DELETE_VALIDATION_RULE,
      CREATE_CUSTOM_FIELD, UPDATE_CUSTOM_FIELD, DELETE_CUSTOM_FIELD, CREATE_CUSTOM_OBJECT, UPDATE_CUSTOM_OBJECT,
      CREATE_APEX_CLASS, UPDATE_APEX_CLASS, CREATE_APEX_TRIGGER, UPDATE_APEX_TRIGGER, CREATE_PERMISSION_SET,
      UPDATE_PERMISSION_SET, CREATE_FLOW, UPDATE_FLOW, CREATE_CUSTOM_TAB, UPDATE_CUSTOM_TAB, CREATE_SHARING_RULE,
      UPDATE_SHARING_RULE, CREATE_RECORD_TYPE, UPDATE_RECORD_TYPE, CREATE_LIST_VIEW, UPDATE_LIST_VIEW.
      If the intent is ambiguous between multiple target components, list them in ambiguities.
      If the user prompt violates safety rules, return {"operation": "UNKNOWN", "targetComponent": null, "targetField": null, "ambiguities": []}.
    `;

    let text = '';
    try {
      text = await this.generateContent(`Prompt: ${prompt}\nRationale: ${businessRationale}`, sysPrompt);
    } catch (err) {
      console.error('Intent parsing LLM call failed:', err.message);
      return { operation: 'UNKNOWN', targetComponent: null, targetField: null, ambiguities: [] };
    }

    const parsed = this._extractJson(text);
    const operation = normalizeOperation(parsed?.operation);

    // LLMs often return "Object.Field" as targetComponent despite instructions.
    // Split it so the object and child names survive the pipeline separately.
    const rawTarget = typeof parsed?.targetComponent === 'string' ? parsed.targetComponent.trim() : '';
    const segments = rawTarget.includes('.') ? rawTarget.split('.') : [];
    let targetComponent = normalizeTargetComponent(rawTarget);
    let targetField = normalizeTargetField(parsed?.targetField);

    // Prefer the LLM's explicit targetField; only fall back to the dot-form.
    if (!targetComponent && segments.length > 1) {
      targetComponent = normalizeTargetComponent(segments[0]);
    }
    if (!targetField && segments.length > 1) {
      targetField = normalizeTargetField(segments[segments.length - 1]);
    }

    const ambiguities = Array.isArray(parsed?.ambiguities)
      ? parsed.ambiguities.filter(a => a && typeof a === 'object')
      : [];

    return { operation, targetComponent, targetField, ambiguities };
  }

  /**
   * Generate the metadata XML using a resolved skill, then verify the result
   * is well-formed XML before returning it. `conversationContext` (optional)
   * is the bounded digest of earlier turns in this session.
   */
  async generateMetadata(skillContent, structuredIntent, prompt, businessRationale, conversationContext) {
    let lessonsText = '';
    try {
      const { data: lessons, error } = await supabaseAdmin
        .from('ai_lessons')
        .select('lesson_text')
        .eq('active', true);
      
      if (!error && lessons && lessons.length > 0) {
        lessonsText = '\nCRITICAL LESSONS LEARNED FROM PAST FAILURES (MUST FOLLOW):\n' + 
                      lessons.map((l, i) => `${i + 1}. ${l.lesson_text}`).join('\n');
      }
    } catch (err) {
      console.warn('Failed to fetch ai_lessons:', err.message);
    }

    const sysPrompt = `
      You are the OrgForge Metadata Generator.
      Follow the skill instructions strictly:
      ${skillContent}
      ${lessonsText}

      CRITICAL CONSTRAINTS:
      - NEVER attempt to convert the data type (<type>) of an existing Salesforce Custom Field via Metadata API (e.g. changing Text to Picklist). It will fail validation.
      - If the operation is UPDATE_CUSTOM_FIELD and you don't know the exact existing type, do NOT assume a new type. Infer it from the User Prompt if possible, or use the most conservative matching type. Keep it consistent with typical default or standard usage unless creating a NEW field.
      ${conversationContext ? `\n      Conversation Context (earlier turns in THIS session — the user may be referring to a previously discussed component or field):\n      ${conversationContext}` : ''}

      User Prompt: ${prompt || 'N/A'}
      Business Rationale: ${businessRationale || 'N/A'}

      Generate valid Salesforce XML for this intent:
      ${JSON.stringify(structuredIntent)}

      Output ONLY the raw XML with no markdown code fences or commentary.
    `;

    let text = '';
    try {
      text = await this.generateContent(
        `Generate metadata for intent:\n${JSON.stringify(structuredIntent)}`,
        sysPrompt
      );
    } catch (err) {
      console.error('Metadata generation LLM call failed:', err.message);
      throw new Error(`Metadata generation failed: ${err.message}`);
    }

    const xml = text
      .trim()
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();
    if (!isWellFormedXml(xml)) {
      const err = new Error('Generated metadata is not well-formed XML; refusing to continue.');
      // Client-level validation failure — keep status < 500 so the route
      // surfaces this message instead of a generic "Generation failed".
      err.status = 400;
      throw err;
    }

    // CustomField XML has a fixed <type> enum. LLMs commonly emit human
    // labels ("Text Area", "String") instead of the API value ("TextArea");
    // reject those here with an actionable message rather than let the MDAPI
    // dry-run fail with "Unsupported custom field type conversion attempted".
    // Only CREATE/UPDATE produce a real <CustomField> document — DELETE maps
    // to a destructiveChanges.xml manifest that has no <type> element.
    const operation = normalizeOperation(structuredIntent?.operation);
    if (operation === 'CREATE_CUSTOM_FIELD' || operation === 'UPDATE_CUSTOM_FIELD') {
      const typeError = validateCustomFieldXml(xml);
      if (typeError) {
        const err = new Error(`CustomField validation failed: ${typeError}`);
        err.status = 400;
        throw err;
      }
    }

    return xml;
  }

  /**
   * Generate an aggregate SOQL query to measure data impact (violating records).
   * The generated query is validated against a strict aggregate-COUNT shape;
   * anything else falls back to a safe no-op count query.
   */
  async generateImpactSOQL(structuredIntent) {
    const sysPrompt = `
      You are the OrgForge Impact SOQL Generator.
      Based on the user's intent to modify metadata, write a single Salesforce SOQL aggregate query
      that counts how many existing records would violate the proposed constraints or be affected by the change.

      Intent: ${JSON.stringify(structuredIntent)}

      Requirements:
      1. ONLY return the raw SOQL query string starting with SELECT and ending with no trailing punctuation.
      2. The query MUST be an aggregate counting query, e.g., SELECT COUNT(Id) FROM Object WHERE...
      3. Do NOT include semicolons, multiple statements, or anything other than the single query.
      4. If the intent doesn't imply a data constraint (e.g. creating a non-required field), return: SELECT COUNT(Id) FROM ${normalizeTargetComponent(structuredIntent?.targetComponent) || 'Account'} WHERE Id = '000000000000000AAA'
    `;

    let text = '';
    try {
      text = await this.generateContent(`Intent: ${JSON.stringify(structuredIntent)}`, sysPrompt);
    } catch (err) {
      console.error('SOQL generation LLM call failed:', err.message);
    }

    const candidate = text
      .trim()
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    if (isSafeAggregateSoql(candidate)) {
      return candidate;
    }

    const target = normalizeTargetComponent(structuredIntent?.targetComponent) || 'Account';
    return `SELECT COUNT(Id) FROM ${target} WHERE Id = '000000000000000AAA'`;
  }
}

export const aiOrchestrator = new AiOrchestrator();
