/**
 * Unified SSE event envelope (plan §10.2).
 *
 * `type` keeps Agentforge's vocabulary (its chat page already handles these);
 * `capability` and `card` are ADDITIVE so the existing renderer doesn't break.
 * OrgForge's pipeline endpoints keep their own JSON/SSE shapes — this envelope
 * is for the Copilot chat stream.
 */

/** Event types — Agentforge vocabulary, extended. */
export const SSE_TYPES = [
  'message',
  'status',
  'action',
  'error',
  'build_widget',
  'stream_chunk',
  'deploy',
  'deploy_success',
  'deploy_warning',
  'deploy_error',
];

/** Inline card types rendered inside the chat (plan §6.3). */
export const SSE_CARDS = [
  'blast_radius',
  'refusal_gates',
  'artifact',
  'dry_run',
  'deploy',
  'record',
  'build_progress',
];

export const SSE_CAPABILITIES = ['agent', 'org_change'];

/**
 * Builds a validated envelope. Unknown `type` is rejected (fail loudly in dev,
 * sanitized in prod); unknown `card`/`capability` are dropped (additive-only).
 *
 * @param {object} input
 * @param {string} input.type - one of SSE_TYPES
 * @param {'agent'|'org_change'} [input.capability]
 * @param {string} [input.content]
 * @param {string} [input.summary]
 * @param {Array<{component?: string, problem?: string}>} [input.errors]
 * @param {string} [input.card] - one of SSE_CARDS
 * @param {object} [input.extra] - any additive fields pass through untouched
 * @returns {object} the envelope
 */
export function createSseEnvelope({ type, capability, content, summary, errors, card, ...extra } = {}) {
  if (!SSE_TYPES.includes(type)) {
    throw new Error(`Invalid SSE type "${type}" — must be one of ${SSE_TYPES.join(', ')}`);
  }

  const envelope = { type };

  if (SSE_CAPABILITIES.includes(capability)) envelope.capability = capability;
  if (typeof content === 'string' && content.length > 0) envelope.content = content;
  if (typeof summary === 'string' && summary.length > 0) envelope.summary = summary;

  if (Array.isArray(errors) && errors.length > 0) {
    envelope.errors = errors.map((e) => ({
      ...(e?.component ? { component: String(e.component) } : {}),
      ...(e?.problem ? { problem: String(e.problem) } : {}),
    }));
  }

  if (SSE_CARDS.includes(card)) envelope.card = card;

  // Additive passthrough — never strips future fields.
  return { ...envelope, ...extra };
}

/**
 * Serializes an envelope into a wire-format SSE frame.
 * @param {object} envelope
 * @returns {string} `data: {...}\n\n`
 */
export function serializeSseFrame(envelope) {
  return `data: ${JSON.stringify(envelope)}\n\n`;
}

/**
 * Parses a raw `data:` payload into an envelope (used by tests / adapters).
 * Returns null on malformed JSON.
 */
export function parseSseFrame(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
