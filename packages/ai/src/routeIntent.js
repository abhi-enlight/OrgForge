import { classifyWithGemini } from './classifier.js';
// The canonical definitions live in overrides.js (zero deps) so the canary
// stub classifier can share them without dragging the Gemini SDK into the web
// client. Imported locally (used by routeIntent) AND re-exported for the
// golden tests + API consumers.
import { applyDeterministicOverrides } from './overrides.js';
export { DETERMINISTIC_OVERRIDES, applyDeterministicOverrides } from './overrides.js';
// The rule-based classifier (same lexicon the canary chip previews) is the
// deterministic tie-breaker for flaky / unavailable model classifications.
// It is dependency-free (no Gemini SDK), so importing it here is safe for
// every consumer of this module.
import { classifyWithStub } from './stubClassifier.js';

export const CAPABILITIES = ['agent', 'org_change', 'both', 'clarify'];

/**
 * Deterministic rule-based tie-break: run the rule lexicon when the model
 * asks to clarify (or is unavailable / low-confidence). The rules never guess
 * (EC-24) — they only answer on unambiguous phrasing ("Build a Case Triage
 * Agent…" → agent), so a flaky model clarification can't stall an obvious
 * request, and a genuinely ambiguous one still clarifies.
 *
 * @param {string} message - the raw user prompt
 * @returns {{capability: 'agent'|'org_change'|'both', confidence: number, reason: string}|null} null when the rules are also unsure
 */
function ruleBasedFallback(message) {
  const fallback = classifyWithStub(String(message || ''));
  return fallback.capability === 'clarify' ? null : fallback;
}

/**
 * The one-brain router (plan §7.1). Decision order:
 *
 *   [0] user pinned capability (UI chip)  → bypass classifier entirely
 *   [1] classifier (advisory)
 *   [2] deterministic overrides (authoritative)
 *   [3] low-confidence / unknown          → deterministic rule tie-break
 *   [4] still unknown                     → clarify (never guess, EC-24)
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
    // An unreachable model must never silently route an AMBIGUOUS request, but
    // it also must not stall an UNAMBIGUOUS one: fall back to the deterministic
    // rules (the same lexicon the chip previews). Rules unsure → fail closed.
    const fallback = ruleBasedFallback(message);
    if (fallback) {
      return {
        capability: fallback.capability,
        confidence: Math.max(fallback.confidence, minConfidence),
        reason: `Classifier unavailable (${err.message}); ${fallback.reason}`,
        overrideSource: 'deterministic',
      };
    }
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

  // [3] Low confidence or unparseable → deterministic rule tie-break. Gemini
  // can flakily answer "clarify" for an obviously agent/org request (e.g.
  // "Build a Case Triage Agent…"); the rule lexicon only fires on unambiguous
  // phrasing, so this fixes flaky clarifications without ever guessing.
  if (model.capability === 'clarify' || model.confidence < minConfidence) {
    const fallback = ruleBasedFallback(message);
    if (fallback) {
      return {
        capability: fallback.capability,
        confidence: Math.max(fallback.confidence, model.confidence),
        reason: `${fallback.reason} (model ${model.capability === 'clarify' ? 'asked to clarify' : 'was low-confidence'}; deterministic rules resolved it)`,
        overrideSource: 'deterministic',
      };
    }
    // [4] Still unknown → clarify, never guess (EC-24, §7.4).
    return {
      capability: 'clarify',
      confidence: model.confidence,
      reason: model.capability === 'clarify' ? (model.reason || 'Request is ambiguous or unsafe') : 'Confidence too low to route',
      overrideSource: 'clarify',
    };
  }

  return { ...model, overrideSource: 'model' };
}
