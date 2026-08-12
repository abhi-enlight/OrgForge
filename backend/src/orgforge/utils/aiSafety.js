/**
 * AI Output Safety & Validation utilities.
 *
 * LLM output is untrusted. Every structured field the AI returns must be
 * validated before it is used to build SOQL, metadata paths, or deployment
 * packages. These helpers fail closed: anything that does not match is
 * rejected, never sanitized into something dangerous.
 */

/** Operations the platform knows how to generate & deploy. */
export const OPERATION_WHITELIST = new Set([
  'CREATE_VALIDATION_RULE',
  'UPDATE_VALIDATION_RULE',
  'DELETE_VALIDATION_RULE',
  'CREATE_CUSTOM_FIELD',
  'UPDATE_CUSTOM_FIELD',
  'DELETE_CUSTOM_FIELD',
  'CREATE_CUSTOM_OBJECT',
  'UPDATE_CUSTOM_OBJECT',
  'CREATE_APEX_CLASS',
  'UPDATE_APEX_CLASS',
  'CREATE_APEX_TRIGGER',
  'UPDATE_APEX_TRIGGER',
  'CREATE_PERMISSION_SET',
  'UPDATE_PERMISSION_SET',
  'CREATE_FLOW',
  'UPDATE_FLOW',
  'CREATE_CUSTOM_TAB',
  'UPDATE_CUSTOM_TAB',
  'CREATE_SHARING_RULE',
  'UPDATE_SHARING_RULE',
  'CREATE_RECORD_TYPE',
  'UPDATE_RECORD_TYPE',
  'CREATE_LIST_VIEW',
  'UPDATE_LIST_VIEW',
]);

const OPERATION_RE = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * Returns the operation if it is a known, well-formed value, otherwise
 * 'UNKNOWN'. Used to whitelist the LLM's `operation` field.
 */
export function normalizeOperation(operation) {
  if (typeof operation !== 'string') return 'UNKNOWN';
  const trimmed = operation.trim().toUpperCase();
  return OPERATION_RE.test(trimmed) && OPERATION_WHITELIST.has(trimmed) ? trimmed : 'UNKNOWN';
}

/** Salesforce API identifier: letters/digits/underscores, no quotes or separators. */
export function isValidSfIdentifier(name) {
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name.trim());
}

/** Returns a trimmed, validated target component name, or null if unsafe. */
export function normalizeTargetComponent(target) {
  return typeof target === 'string' && isValidSfIdentifier(target) ? target.trim() : null;
}

/**
 * Valid Metadata API custom field <type> values (the FieldType enum, per the
 * platform-custom-field-generate skill). "Formula" is intentionally absent —
 * formula fields use their result type as <type>. Anything outside this set
 * makes the MDAPI dry-run fail with "Unsupported custom field type conversion
 * attempted".
 */
const CUSTOM_FIELD_TYPES = new Set([
  'AutoNumber',
  'Checkbox',
  'Currency',
  'Date',
  'DateTime',
  'Email',
  'Html',
  'Location',
  'LongTextArea',
  'Lookup',
  'MasterDetail',
  'MultiselectPicklist',
  'Number',
  'Percent',
  'Phone',
  'Picklist',
  'Summary',
  'Text',
  'TextArea',
  'Time',
  'Url',
]);

/**
 * Extracts the <type> element value from a CustomField XML document. Comments,
 * CDATA sections, and processing instructions are stripped first (mirroring
 * isWellFormedXml) so neither a commented-out <type> nor a literal
 * "<type>...</type>" inside a formula's CDATA can poison the result. The tag
 * pattern requires whitespace (or end-of-tag) after "type" so element names
 * like <typeName> are not matched. Returns null when absent or not a single
 * short text value.
 */
export function extractCustomFieldType(xml) {
  if (typeof xml !== 'string') return null;
  const cleaned = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');
  const match = cleaned.match(/<type(?:\s[^>]*)?>([\s\S]*?)<\/type>/i);
  if (!match) return null;
  const type = match[1].trim();
  return type.length > 0 && type.length <= 50 ? type : null;
}

/**
 * Extracts the <fullName> element from CustomField XML.
 */
function extractCustomFieldFullName(xml) {
  if (typeof xml !== 'string') return null;
  const cleaned = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');
  const match = cleaned.match(/<fullName(?:\s[^>]*)?>([\s\S]*?)<\/fullName>/i);
  if (!match) return null;
  const fullName = match[1].trim();
  return fullName.length > 0 ? fullName : null;
}

/**
 * Validates that a CustomField XML document declares a supported field type
 * and includes a <fullName>.
 * Returns an error message when invalid, or null when the XML is OK.
 */
export function validateCustomFieldXml(xml) {
  const fullName = extractCustomFieldFullName(xml);
  if (!fullName) {
    return 'Generated CustomField XML is missing a <fullName> element.';
  }
  
  const type = extractCustomFieldType(xml);
  if (!type) {
    return 'Generated CustomField XML is missing a <type> element.';
  }
  if (!CUSTOM_FIELD_TYPES.has(type)) {
    return `Unsupported custom field type "${type}". Valid <type> values: ${[...CUSTOM_FIELD_TYPES].sort().join(', ')}.`;
  }
  return null;
}

/**
 * Returns a trimmed, validated child-component name (field / rule / etc.), or
 * null if unsafe. Same identifier rules as targetComponent — "Object.Field"
 * dot-qualified forms are NOT valid here; split them before calling.
 */
export function normalizeTargetField(field) {
  return typeof field === 'string' && isValidSfIdentifier(field) ? field.trim() : null;
}

/**
 * Accepts only a single aggregate COUNT SOQL query of the shape
 * `SELECT COUNT(Id) FROM <Identifier> [WHERE ... | LIMIT ...]`.
 * Rejects multi-statement input, semicolons, and free-form query text so
 * LLM-generated queries cannot be used to exfiltrate or scan arbitrary data.
 */
export function isSafeAggregateSoql(soql) {
  if (typeof soql !== 'string') return false;
  const trimmed = soql.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return false;
  if (trimmed.includes(';')) return false;
  const match = trimmed.match(
    /^SELECT\s+COUNT\(\s*(Id)?\s*\)\s+FROM\s+([A-Za-z][A-Za-z0-9_]*)(\s+(WHERE|LIMIT)[\s\S]*)?$/i
  );
  return Boolean(match);
}

/**
 * Lightweight well-formedness check for generated XML. Uses a tag stack to
 * verify all open tags are closed and balanced (handles comments, CDATA and
 * processing instructions). Not a full XSD validation — the Salesforce
 * checkOnly dry-run remains the authoritative schema check — but it catches
 * broken LLM output before it reaches a deployment package.
 */
export function isWellFormedXml(xml) {
  if (typeof xml !== 'string') return false;
  const trimmed = xml.trim();
  if (!trimmed || (!trimmed.startsWith('<') && !trimmed.startsWith('<?xml'))) return false;
  if (/<\s*script\b/i.test(trimmed)) return false;

  const stripped = trimmed
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  const stack = [];
  const tagRe = /<\/?([A-Za-z][\w:.-]*)(?:"[^"]*"|'[^']*'|[^"'>])*\/?>/g;
  let match;
  while ((match = tagRe.exec(stripped)) !== null) {
    const token = match[0];
    const name = match[1];
    if (token.startsWith('</')) {
      const open = stack.pop();
      if (open !== name) return false;
    } else if (!token.endsWith('/>')) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}
