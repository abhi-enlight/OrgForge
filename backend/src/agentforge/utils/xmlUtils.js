'use strict';

/**
 * Centralized XML utility functions.
 * ALWAYS use these before injecting user-generated strings into XML.
 */

/**
 * Escapes all 5 special XML characters to prevent broken/injected XML.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Sanitizes a string for use as a Salesforce API name / developer name.
 * Rules: starts with a letter, alphanumeric + underscores only, max 40 chars.
 * @param {string} str
 * @returns {string}
 */
function sanitizeName(str) {
  if (!str) return 'Generated';
  let safe = str
    .replace(/[^a-zA-Z0-9_]/g, '_')  // replace invalid chars with underscore
    .replace(/_+/g, '_')              // collapse multiple underscores
    .replace(/^[^a-zA-Z]+/, '');      // must start with a letter
  if (!safe) return 'Generated';
  safe = safe.substring(0, 40).replace(/_+$/, ''); // apply length limit THEN remove trailing underscores
  return safe || 'Generated';
}

/**
 * Sanitizes a string for use as an Apex class name.
 * Apex class names: start with letter, alphanumeric + underscore, max 40 chars, no leading/trailing underscore.
 * @param {string} str
 * @returns {string}
 */
function sanitizeApexClassName(str) {
  if (!str) return 'GeneratedAction';
  let safe = str
    .replace(/[^a-zA-Z0-9_]/g, '_')   // replace invalid chars with underscore
    .replace(/_+/g, '_')               // BUG-12: collapse consecutive underscores (matches sanitizeName behavior)
    .replace(/^[^a-zA-Z]+/, '')        // must start with a letter
    .replace(/_+$/, '');               // no trailing underscores
  if (!safe) return 'GeneratedAction';
  return safe.substring(0, 40);
}


export { escapeXml, sanitizeName, sanitizeApexClassName };
