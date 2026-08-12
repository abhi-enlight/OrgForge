import express from 'express';
import { z } from 'zod';
import { createAuthMiddleware, tenantIsolation } from '@forge/auth';
const requireAuth = createAuthMiddleware();
import { aiOrchestrator } from '../services/aiOrchestrator.js';
import { skillResolver } from '../services/skillResolver.js';
import { deriveFullName } from '../services/metadataTransport.js';
import { normalizeOperation, normalizeTargetField, isValidSfIdentifier } from '../utils/aiSafety.js';
import { redisConnection } from '../jobs/queue.js';

const router = express.Router();
router.use(requireAuth, tenantIsolation);

/**
 * Detects the PostgREST error thrown when the OrgForge tables are missing from
 * the Supabase project (RLS/schema migrations never applied). Returns a
 * user-actionable message instead of a generic 500.
 */
function isMissingTableError(err) {
  return /Could not find the table/.test(err?.message || '');
}

const SCHEMA_NOT_INITIALIZED =
  'Database schema is not initialized. Apply the OrgForge migrations ' +
  '(supabase/migrations/003_public_schema.sql, then 004 and 005) in the ' +
  'Supabase SQL editor — or add SUPABASE_ACCESS_TOKEN (or DATABASE_URL) to ' +
  'backend/.env so the schema can be applied automatically.';

const intentSchema = z.object({
  orgId: z.string().min(1),
  prompt: z.string().min(10),
  businessRationale: z.string().min(10)
});

router.post('/intent', async (req, res) => {
  try {
    const { orgId, prompt, businessRationale } = intentSchema.parse(req.body);

    // Verify the org belongs to this tenant before reading its context and
    // creating an intent for it. (req.supabaseClient uses the service role
    // key, so RLS is not a backstop — ownership must be checked explicitly.)
    const { data: owned, error: ownErr } = await req.supabaseClient
      .from('org_connections')
      .select('org_id')
      .eq('org_id', orgId)
      .eq('user_id', req.tenantId)
      .maybeSingle();

    if (ownErr || !owned) {
      return res.status(404).json({ error: 'Org connection not found' });
    }

    // Load the real indexed org context from Redis (populated by the indexing job).
    // Falls back to a minimal stub when the org hasn't been indexed yet so the
    // AI still has something to work with.
    let orgContext = { componentCount: 0, objects: [], apex: [] };
    try {
      const cached = await redisConnection.get(`org_context:${req.tenantId}:${orgId}`);
      if (cached) {
        const ctx = JSON.parse(cached);
        orgContext = {
          componentCount: (ctx.objects?.length || 0) + (ctx.apex?.length || 0),
          objects: ctx.objects || [],
          apex: ctx.apex || []
        };
      }
    } catch (ctxErr) {
      console.warn('Failed to load org context from Redis:', ctxErr.message);
    }

    const structuredIntent = await aiOrchestrator.parseIntent(prompt, businessRationale, orgContext);
    
    // Insert into orgforge.change_intents
    const { data, error } = await req.supabaseClient
      .from('change_intents')
      .insert({
        user_id: req.user.id,
        org_id: orgId,
        prompt: prompt,
        business_rationale: businessRationale,
        target_component: structuredIntent.targetComponent || null,
        operation: structuredIntent.operation || null,
        structured_intent: structuredIntent
      })
      .select('id')
      .single();

    if (error) throw error;
    const intentId = data.id;

    res.json({ intentId, ...structuredIntent });
  } catch (error) {
    // Zod validation errors use the shared { error, issues } shape so the
    // frontend can render each failing field instead of a bare array.
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', issues: error.errors });
    }
    console.error(error);
    if (isMissingTableError(error)) {
      return res.status(503).json({ error: SCHEMA_NOT_INITIALIZED });
    }
    res.status(500).json({ error: 'Intent parsing failed' });
  }
});

const clarifySchema = z.object({
  resolvedOption: z.string().min(1)
});

router.post('/intent/:intentId/clarify', async (req, res) => {
  try {
    const { intentId } = req.params;
    const { resolvedOption } = clarifySchema.parse(req.body);

    const { data: intent, error: fetchError } = await req.supabaseClient
      .from('change_intents')
      .select('*')
      .eq('id', intentId)
      .eq('user_id', req.tenantId)
      .single();

    if (fetchError) {
      if (isMissingTableError(fetchError)) {
        return res.status(503).json({ error: SCHEMA_NOT_INITIALIZED });
      }
      throw fetchError;
    }

    // Update the intent with the resolved option
    const structuredIntent = intent.structured_intent || {};
    structuredIntent.resolvedOption = resolvedOption;
    structuredIntent.ambiguities = [];

    const { error: updateError } = await req.supabaseClient
      .from('change_intents')
      .update({
        structured_intent: structuredIntent
      })
      .eq('id', intentId)
      .eq('user_id', req.tenantId);

    if (updateError) throw updateError;

    res.json({ success: true, status: 'READY' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to clarify intent' });
  }
});

const generateSchema = z.object({
  intentId: z.string().uuid()
});

router.post('/generate', async (req, res) => {
  try {
    const { intentId } = generateSchema.parse(req.body);
    
    // Load intent from DB (tenant-scoped: the id alone is not enough now that
    // the request client uses the service role key — RLS is not a backstop)
    const { data: intentData, error } = await req.supabaseClient
      .from('change_intents')
      .select('*')
      .eq('id', intentId)
      .eq('user_id', req.tenantId)
      .single();

    if (error) throw error;
    if (!intentData || !intentData.structured_intent) throw new Error('Intent not found or missing structured_intent');
    
    const structuredIntent = intentData.structured_intent;

    // Refuse to generate for unknown or unsupported operations (fail loudly).
    const operation = normalizeOperation(structuredIntent?.operation);
    if (operation === 'UNKNOWN') {
      return res.status(400).json({ error: 'Intent could not be mapped to a supported operation. Please rephrase the request.' });
    }
    if (!structuredIntent.targetComponent) {
      return res.status(400).json({ error: 'Intent is missing a target component. Please clarify the target metadata.' });
    }

    const skill = skillResolver.resolveSkill(operation);
    
    const xml = await aiOrchestrator.generateMetadata(skill.content, structuredIntent, intentData.prompt, intentData.business_rationale);

    const { filePath, metadataType, artifactName } = mapOperationToArtifact(
      operation,
      structuredIntent.targetComponent,
      xml,
      structuredIntent.targetField
    );
    
    res.json({
      changeSetId: `cs_${Date.now()}`,
      artifacts: [{
        filePath,
        metadataType,
        fullName: deriveFullName(filePath) || artifactName,
        skillUsed: skill.skillName,
        skillVersion: skill.skillVersion,
        content: xml
      }]
    });
  } catch (err) {
    console.error('Generation error:', err);
    // Only client-level errors (err.status < 500) surface their message;
    // server errors return a generic message so internals never leak.
    const status = err.status || 500;
    if (status >= 500) {
      return res.status(500).json({ error: 'Generation failed' });
    }
    return res.status(status).json({ error: err.message || 'Generation failed' });
  }
});

/**
 * Parses the metadata member <fullName> from generated XML. Comments are
 * stripped first (mirroring isWellFormedXml) so a commented-out <fullName>
 * cannot poison the result. The first occurrence is the top-level element for
 * CustomField XML — nested picklist value <fullName> elements come later.
 * Returns a validated "Object.Field" or "Field" API name, or null when
 * absent/unsafe.
 */
function extractFullNameFromXml(xml) {
  if (typeof xml !== 'string') return null;
  const cleaned = xml.replace(/<!--[\s\S]*?-->/g, '');
  const match = cleaned.match(/<fullName[^>]*>([\s\S]*?)<\/fullName>/i);
  if (!match) return null;
  const segments = match[1].trim().split('.').map(s => s.trim());
  if (segments.length === 0 || segments.length > 2) return null;
  if (!segments.every(s => isValidSfIdentifier(s))) return null;
  return segments.join('.');
}

/**
 * Derives the field API name for a CustomField artifact. Precedence:
 *   1. <fullName> tag in the generated XML ("Status__c" or "Object.Status__c")
 *   2. targetField from the structured intent ("Status__c")
 *   3. dot-qualified targetComponent suffix ("Support_Ticket__c.Status__c" -> "Status__c")
 *   4. null (caller falls back to a placeholder)
 */
export function deriveFieldName(xml, targetComponent, targetField) {
  const xmlFullName = extractFullNameFromXml(xml);
  if (xmlFullName) return xmlFullName.split('.').pop();
  const field = normalizeTargetField(targetField);
  if (field) return field;
  if (typeof targetComponent === 'string' && targetComponent.includes('.')) {
    const suffix = targetComponent.split('.').pop().trim();
    if (isValidSfIdentifier(suffix)) return suffix;
  }
  return null;
}

/**
 * Derives the object API name for a CustomField artifact path. Precedence:
 *   1. object segment of an object-qualified <fullName> in the generated XML,
 *      so the file path always agrees with the XML member the dry-run checks
 *   2. first segment of the target component
 *      ("Support_Ticket__c.Status__c" -> "Support_Ticket__c")
 *   3. null (caller fails loudly rather than emit a mismatched path)
 */
export function deriveObjectName(xml, targetComponent) {
  const xmlFullName = extractFullNameFromXml(xml);
  if (xmlFullName && xmlFullName.includes('.')) {
    return xmlFullName.split('.')[0];
  }
  if (typeof targetComponent !== 'string') return null;
  const firstSegment = targetComponent.split('.')[0].trim();
  return isValidSfIdentifier(firstSegment) ? firstSegment : null;
}

/**
 * Maps a validated operation to a source-format file path and metadata type.
 * Covers all 24 whitelisted operations (CREATE, UPDATE, DELETE variants).
 * DELETE operations produce a destructiveChanges.xml manifest.
 * Throws 400 (fail loudly) for any operation not explicitly listed.
 *
 * `xml` is the AI-generated metadata for the intent; for CustomField
 * operations it is parsed so the file path matches the XML <fullName> tag
 * (a path/name mismatch is what makes the Stage 7 MDAPI dry-run reject the
 * change set). `targetField` is the child name extracted at intent time
 * (e.g. "Status__c" for "Support_Ticket__c.Status__c"). Falls back to
 * NewField__c only when nothing can be derived.
 */
export function mapOperationToArtifact(operation, targetComponent, xml, targetField) {
  // ── Validation Rules ────────────────────────────────────────────────────────
  if (/VALIDATION_RULE$/.test(operation)) {
    if (operation.startsWith('DELETE')) {
      return {
        filePath: 'force-app/main/default/destructiveChanges.xml',
        metadataType: 'ValidationRule',
        artifactName: `${targetComponent}_Rule`
      };
    }
    return {
      filePath: `force-app/main/default/objects/${targetComponent}/validationRules/${targetComponent}_Rule.validationRule-meta.xml`,
      metadataType: 'ValidationRule',
      artifactName: `${targetComponent}_Rule`
    };
  }

  // ── Custom Fields ────────────────────────────────────────────────────────────
  if (/CUSTOM_FIELD$/.test(operation)) {
    const objectName = deriveObjectName(xml, targetComponent);
    if (!objectName) {
      const err = new Error(`Target component "${targetComponent}" is not a valid Salesforce API name.`);
      err.status = 400;
      throw err;
    }
    const fieldName = deriveFieldName(xml, targetComponent, targetField) || 'NewField__c';
    if (operation.startsWith('DELETE')) {
      return {
        filePath: 'force-app/main/default/destructiveChanges.xml',
        metadataType: 'CustomField',
        artifactName: `${objectName}.${fieldName}`
      };
    }
    return {
      filePath: `force-app/main/default/objects/${objectName}/fields/${fieldName}.field-meta.xml`,
      metadataType: 'CustomField',
      artifactName: `${objectName}.${fieldName}`
    };
  }

  // ── Custom Objects ───────────────────────────────────────────────────────────
  if (/CUSTOM_OBJECT$/.test(operation)) {
    if (operation.startsWith('DELETE')) {
      return {
        filePath: 'force-app/main/default/destructiveChanges.xml',
        metadataType: 'CustomObject',
        artifactName: targetComponent
      };
    }
    return {
      filePath: `force-app/main/default/objects/${targetComponent}/${targetComponent}.object-meta.xml`,
      metadataType: 'CustomObject',
      artifactName: targetComponent
    };
  }

  // ── Apex Classes ─────────────────────────────────────────────────────────────
  if (/APEX_CLASS$/.test(operation)) {
    return {
      filePath: `force-app/main/default/classes/${targetComponent}.cls`,
      metadataType: 'ApexClass',
      artifactName: targetComponent
    };
  }

  // ── Apex Triggers ────────────────────────────────────────────────────────────
  if (/APEX_TRIGGER$/.test(operation)) {
    return {
      filePath: `force-app/main/default/triggers/${targetComponent}.trigger`,
      metadataType: 'ApexTrigger',
      artifactName: targetComponent
    };
  }

  // ── Permission Sets ──────────────────────────────────────────────────────────
  if (/PERMISSION_SET$/.test(operation)) {
    const name = `${targetComponent}_PermissionSet`;
    return {
      filePath: `force-app/main/default/permissionsets/${name}.permissionset-meta.xml`,
      metadataType: 'PermissionSet',
      artifactName: name
    };
  }

  // ── Flows ────────────────────────────────────────────────────────────────────
  if (/FLOW$/.test(operation)) {
    const name = `${targetComponent}_Flow`;
    return {
      filePath: `force-app/main/default/flows/${name}.flow-meta.xml`,
      metadataType: 'Flow',
      artifactName: name
    };
  }

  // ── Custom Tabs ──────────────────────────────────────────────────────────────
  if (/CUSTOM_TAB$/.test(operation)) {
    const name = targetComponent.endsWith('__c') ? targetComponent : `${targetComponent}__c`;
    return {
      filePath: `force-app/main/default/tabs/${name}.tab-meta.xml`,
      metadataType: 'CustomTab',
      artifactName: name
    };
  }

  // ── Sharing Rules ────────────────────────────────────────────────────────────
  if (/SHARING_RULE$/.test(operation)) {
    return {
      filePath: `force-app/main/default/sharingRules/${targetComponent}.sharingRules-meta.xml`,
      metadataType: 'SharingRules',
      artifactName: targetComponent
    };
  }

  // ── Record Types ─────────────────────────────────────────────────────────────
  if (/RECORD_TYPE$/.test(operation)) {
    const name = `${targetComponent}_RecordType`;
    return {
      filePath: `force-app/main/default/objects/${targetComponent}/recordTypes/${name}.recordType-meta.xml`,
      metadataType: 'RecordType',
      artifactName: `${targetComponent}.${name}`
    };
  }

  // ── List Views ───────────────────────────────────────────────────────────────
  if (/LIST_VIEW$/.test(operation)) {
    const name = `${targetComponent}_ListView`;
    return {
      filePath: `force-app/main/default/objects/${targetComponent}/listViews/${name}.listView-meta.xml`,
      metadataType: 'ListView',
      artifactName: `${targetComponent}.${name}`
    };
  }

  const err = new Error(`Operation "${operation}" is not supported for artifact generation.`);
  err.status = 400;
  throw err;
}

export default router;
