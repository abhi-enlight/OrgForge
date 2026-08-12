/**
 * Lightweight static analysis for generated Apex (REF-03).
 *
 * The Salesforce Code Analyzer (`sf code-analyzer` / PMD / ESLint engines) is
 * the authoritative scanner; these deterministic heuristics are a
 * dependency-free complement that runs inside the API and flags the same
 * high-severity Apex anti-patterns the refusal gate cares about:
 *   - ApexSOQLInjection      (SOQL built by string concatenation)
 *   - AvoidHardcodedCredentials
 *   - ApexSharingViolations  (externally-reachable class doing DML with no
 *                             `with sharing` / `without sharing` declaration)
 *   - SystemDebugSecrets
 *
 * The analyzer only reports — it never repairs. Any flagged rule is a HIGH
 * severity violation, so one finding refuses REF-03. Rules are intentionally
 * conservative (fail-safe): clean code must never trip them, and borderline
 * code is more likely to be flagged than missed.
 */

const HIGH_SEVERITY_RULES = [
  {
    id: 'ApexSOQLInjection',
    severity: 'HIGH',
    message:
      'SOQL appears to be built by concatenating a variable into a query string (injection risk). ' +
      'Use bind variables (e.g. queryWithBinds or :var placeholders) instead of string concatenation.',
    test: (code) => {
      // A query string assembled via concatenation: '... ' + variable
      const concatIntoQuery = /['"][^'"]*\s*\+\s*[A-Za-z_]\w*/.test(code);
      if (!concatIntoQuery) return false;
      // Only matters when the file is actually building SOQL
      return /\b(?:SOQL|soql|QueryLocator|executeQuery|Database\.query|Search\.query)\b/.test(code);
    }
  },
  {
    id: 'AvoidHardcodedCredentials',
    severity: 'HIGH',
    message:
      'Hardcoded credential or secret literal detected (password/secret/token/api key). ' +
      'Move it to a protected Custom Metadata Type, Named Credential, or environment secret.',
    test: (code) =>
      /\b(?:password|passwd|secret|client_secret|api[_-]?key|access[_-]?token|token)\s*[=:]\s*['"][^'"]{6,}['"]/i.test(
        code
      )
  },
  {
    id: 'ApexSharingViolations',
    severity: 'HIGH',
    message:
      'Class exposes entry points and performs DML without an explicit sharing declaration. ' +
      'Declare `with sharing` (or `without sharing`) to make the org security model explicit.',
    test: (code) => {
      // Trigger files are excluded: they cannot declare sharing, and their
      // header (`trigger T on Obj (before insert, before update)`) uses the
      // DML event keywords without performing DML.
      if (/\btrigger\s+\w+\s+on\b/.test(code)) return false;
      if (!/\bclass\s+\w+/.test(code)) return false;
      // Explicit sharing declaration present → OK
      if (/\b(?:with|without)\s+sharing\b/.test(code)) return false;
      // Only flag externally-reachable code that also does DML — a plain
      // utility class with no DML is not a sharing risk.
      const doesDml = /\b(?:insert|update|upsert|delete|undelete|Database\.(?:insert|update|upsert|delete))\b/.test(code);
      const exposed = /@AuraEnabled|@RestResource|webservice\b|@InvocableMethod|@future\b|@AuraEnabled\(/.test(code);
      return doesDml && exposed;
    }
  },
  {
    id: 'SystemDebugSecrets',
    severity: 'HIGH',
    message:
      'System.debug() logs a value that looks like a secret or sensitive identifier. ' +
      'Remove the debug statement (or redact the field) before deploying.',
    test: (code) =>
      /System\.debug\s*\([^)]*(?:password|token|secret|ssn|social_security|credit_card|account_number)/i.test(code)
  }
];

/**
 * Analyzes deployment artifacts for high-severity Apex violations.
 * Non-Apex artifacts are ignored (validation rules, flows, layouts, …).
 *
 * @param {Array<{filePath?: string, fullName?: string, metadataType?: string, content?: string}>} artifacts
 * @returns {{ hasHighViolations: boolean, violations: Array<{rule: string, severity: string, message: string, filePath: string}> }}
 */
export function analyzeApexArtifacts(artifacts) {
  const violations = [];
  for (const artifact of artifacts || []) {
    if (!artifact || typeof artifact.content !== 'string' || artifact.content.length === 0) continue;
    const type = artifact.metadataType || '';
    if (type !== 'ApexClass' && type !== 'ApexTrigger') continue;

    for (const rule of HIGH_SEVERITY_RULES) {
      if (rule.test(artifact.content)) {
        violations.push({
          rule: rule.id,
          severity: rule.severity,
          message: rule.message,
          filePath: artifact.filePath || artifact.fullName || 'unknown'
        });
      }
    }
  }
  return { hasHighViolations: violations.length > 0, violations };
}

export const staticAnalyzer = {
  analyze: analyzeApexArtifacts,
  RULES: HIGH_SEVERITY_RULES
};
