/**
 * Deterministic hard overrides (plan §7.1) — single source of truth for BOTH
 * the real router (`routeIntent.js`) and the canary stub classifier
 * (`stubClassifier.js`). Kept dependency-free so the stub (and the web client
 * that imports it) never drags in the Gemini SDK.
 *
 * These rules are applied AFTER the model and always win: high-risk /
 * high-signal org-change phrasings that a model might misroute into the agent
 * engine:
 *   "refund" / "delete field" / "validation rule" / "permission set" → org_change
 * Each rule is a regex + a plain-English reason for the routing log (§7.4).
 */
export const DETERMINISTIC_OVERRIDES = [
  { pattern: /\bvalidation rule\b/i, capability: 'org_change', reason: 'validation rule is org metadata' },
  { pattern: /\bdelete\b[^.!?]{0,25}\bfields?\b/i, capability: 'org_change', reason: 'field deletion is governed metadata change' },
  { pattern: /\bpermission sets?\b/i, capability: 'org_change', reason: 'permission sets are org access metadata' },
  // "refund" as an ACTION to perform (org automation/OWD). Negative lookbehind
  // excludes guardrail phrasing like "refuses refund requests" — that is agent
  // behavior config, not an org change.
  { pattern: /(?<!refus\w*\s)refund\b/i, capability: 'org_change', reason: 'refund flows touch org automation/OWD' },
];

/**
 * Applies deterministic overrides to a model classification.
 *
 * @param {string} message - the raw user prompt
 * @param {string} modelCapability - classifier output (advisory)
 * @returns {{capability: string, reason: string}|null} the override, or null
 */
export function applyDeterministicOverrides(message, modelCapability) {
  if (typeof message !== 'string' || !message) return null;
  for (const rule of DETERMINISTIC_OVERRIDES) {
    if (rule.pattern.test(message)) {
      // Overrides fix MISSED org-change signals. They never fire when the model
      // already routes to org_change (agreed) or both (which already covers the
      // org-change component — overriding would discard the agent half, EC-23).
      if (modelCapability !== 'both' && rule.capability !== modelCapability) {
        return { capability: rule.capability, reason: rule.reason };
      }
    }
  }
  return null;
}
