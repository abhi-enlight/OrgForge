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
 * Conversation-continuation fallback (the "classifier forgets the context"
 * fix). When the model AND the rule lexicon are both unsure about a SHORT
 * message, but the conversation has an established capability, continue it
 * instead of re-asking — a user answering the agent's clarifying questions
 * ("create new", "no escalation") is not a new ambiguous request. EC-24's
 * never-guess still applies: this fires only where we would otherwise
 * `clarify`, and only for terse follow-ups — a long standalone request with
 * no match still clarifies, and a confident model verdict is never overridden.
 *
 * @param {string} message - the raw user prompt
 * @param {{lastCapability?: 'agent'|'org_change'|'both'|null}} [context] - what
 *   the session was already doing (computed server-side from the spine)
 * @returns {object|null} a route decision, or null when there is no established
 *   capability to continue
 */
function contextFollowUpFallback(message, context) {
  const lastCapability = context?.lastCapability;
  if (!lastCapability || lastCapability === 'clarify' || !CAPABILITIES.includes(lastCapability)) return null;
  const trimmed = String(message || '').trim();
  if (!trimmed || trimmed.length > 120) return null;
  return {
    capability: lastCapability,
    confidence: 0.7,
    reason: 'Conversation follow-up — continuing the established capability',
    overrideSource: 'context',
  };
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
 * @param {{digest?: string, lastCapability?: 'agent'|'org_change'|'both'|null}} [opts.context]
 *   - what already happened in this session (server passes the spine digest +
 *   the last non-clarify capability). Feeds the classifier AND the
 *   conversation-continuation fallback.
 * @returns {Promise<{capability: string, confidence: number, reason: string, overrideSource: 'user_chip'|'model'|'deterministic'|'context'|'clarify'}>}
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

  // [1] Classifier (advisory) — with the session context so a terse follow-up
  // (an answer to the assistant's question) routes by conversation, not by the
  // message in isolation.
  let model;
  try {
    model = await classifier(String(message || ''), { ...opts, context: opts.context?.digest || '' });
  } catch (err) {
    console.error('[routeIntent] classifier failed:', err.message);
    // An unreachable model must never silently route an AMBIGUOUS request, but
    // it also must not stall an UNAMBIGUOUS one: fall back to the deterministic
    // rules (the same lexicon the chip previews). Rules unsure → continue the
    // established conversation when there is one, else fail closed.
    const fallback = ruleBasedFallback(message);
    if (fallback) {
      return {
        capability: fallback.capability,
        confidence: Math.max(fallback.confidence, minConfidence),
        reason: `Classifier unavailable (${err.message}); ${fallback.reason}`,
        overrideSource: 'deterministic',
      };
    }
    const cont = contextFollowUpFallback(message, opts.context);
    if (cont) return cont;
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
    // [3.5] Conversation continuation: the model and the rules are both unsure,
    // but the session was already doing something (e.g. the user is answering
    // the agent's clarifying questions) — continue it instead of re-asking.
    const cont = contextFollowUpFallback(message, opts.context);
    if (cont) return cont;
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
