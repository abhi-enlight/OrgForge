import { classifyWithGemini } from './classifier.js';
// The canonical definitions live in overrides.js (zero deps) so the canary
// stub classifier can share them without dragging the Gemini SDK into the web
// client. Imported locally (used by routeIntent) AND re-exported for the
// golden tests + API consumers.
import { applyDeterministicOverrides } from './overrides.js';
export { DETERMINISTIC_OVERRIDES, applyDeterministicOverrides } from './overrides.js';

export const CAPABILITIES = ['agent', 'org_change', 'both', 'clarify'];

/**
 * The one-brain router (plan §7.1). Decision order:
 *
 *   [0] user pinned capability (UI chip)  → bypass classifier entirely
 *   [1] classifier (advisory)
 *   [2] deterministic overrides (authoritative)
 *   [3] low-confidence / unknown          → clarify (never guess, EC-24)
 *
 * @param {string} message - user message
 * @param {object} [opts]
 * @param {(message: string, opts?: object) => Promise<{capability: string, confidence: number, reason: string}>} [opts.classifier]
 * @param {'agent'|'org_change'|'both'|'clarify'} [opts.pinned] - UI chip override
 * @param {number} [opts.minConfidence] - below this → clarify (default 0.6)
 * @returns {Promise<{capability: string, confidence: number, reason: string, overrideSource: 'user_chip'|'model'|'deterministic'|'clarify'}>}
 */
export async function routeIntent(message, opts = {}) {
  const classifier = opts.classifier || classifyWithGemini;
  const minConfidence = opts.minConfidence ?? 0.6;

  // [0] Pinned capability from the UI chip bypasses the model entirely.
  if (opts.pinned && CAPABILITIES.includes(opts.pinned)) {
    return {
      capability: opts.pinned,
      confidence: 1,
      reason: 'User pinned capability via UI chip',
      overrideSource: 'user_chip',
    };
  }

  // [1] Classifier (advisory).
  let model;
  try {
    model = await classifier(String(message || ''), opts);
  } catch (err) {
    console.error('[routeIntent] classifier failed:', err.message);
    // Fail closed: an unreachable model must not silently route to an engine.
    return {
      capability: 'clarify',
      confidence: 0,
      reason: 'Classifier unavailable — asking for clarification',
      overrideSource: 'clarify',
    };
  }

  // [2] Deterministic overrides always win over the model.
  const override = applyDeterministicOverrides(message, model.capability);
  if (override) {
    return {
      capability: override.capability,
      confidence: Math.max(model.confidence, 0.9),
      reason: override.reason,
      overrideSource: 'deterministic',
    };
  }

  // [3] Low confidence or unparseable → clarify, never guess (EC-24, §7.4).
  if (model.capability === 'clarify' || model.confidence < minConfidence) {
    return {
      capability: 'clarify',
      confidence: model.confidence,
      reason: model.capability === 'clarify' ? (model.reason || 'Request is ambiguous or unsafe') : 'Confidence too low to route',
      overrideSource: 'clarify',
    };
  }

  return { ...model, overrideSource: 'model' };
}
