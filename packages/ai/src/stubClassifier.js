import { applyDeterministicOverrides } from './overrides.js';

/**
 * Stub rule-based classifier (plan §14.2 Phase 1: "stub classifier (rule-based
 * only) — UX in place, zero AI risk").
 *
 * A purely deterministic, zero-dependency classifier that mirrors the real
 * router's hard overrides (§7.1) plus a tight lexicon of unambiguous
 * agent / org-change phrases. It powers the canary frontend's capability chip
 * as a LIVE ROUTING PREVIEW: free, offline, instant — with no Gemini call and
 * no API key. The server's real router (`routeIntent`) stays authoritative on
 * send; this stub only informs the user what routing *would* happen.
 *
 * Deliberate conservatism (EC-24: never guess):
 *  - Nothing matched → `clarify`.
 *  - Ambiguous terms are excluded rather than guessed ("flow" alone can be an
 *    agent-attached flow or org automation; "tab" needs a change verb).
 *  - Mixed signals → `both` (EC-23: never discard one half of a request).
 *
 * Return shape matches `routeIntent`'s result so the chip renders the same
 * vocabulary; `overrideSource: 'stub'` marks it as the rule-based preview.
 *
 * @param {string} message - the user's message text
 * @returns {{capability: 'agent'|'org_change'|'both'|'clarify', confidence: number, reason: string, overrideSource: 'stub'}}
 */
export function classifyWithStub(message) {
  if (typeof message !== 'string' || !message.trim()) {
    return { capability: 'clarify', confidence: 0, reason: 'No message to route', overrideSource: 'stub' };
  }
  const text = message.trim();

  // Agent signals. `agentAction` requires a build/deploy/update verb near the
  // word so a bare mention ("…in the agent") never counts as a request to
  // build one — that is exactly what the overrides are for.
  const agentAction =
    /\b(?:(?:re)?(?:build|deploy|test|update|list|show|view|create|make|edit|change|improve))\b[^.!?]{0,30}\bagents?\b/i.test(text) ||
    /\bagents?\b[^.!?]{0,30}\b(deploy|test|list|show|view|update)\b/i.test(text) ||
    /\b(add|create|update|remove)\b[^.!?]{0,20}\b(guardrails?|topics?)\b/i.test(text) ||
    /\bagentforce\b/i.test(text);
  // Bare mentions also count (guardrails/topics are agent-domain vocabulary,
  // per the classifier prompt §7.2) — but only when no override fired, since
  // the overrides exist to beat misleading wording (golden-set cases).
  const agentMention = /\bagents?\b|\bguardrails?\b|\btopics?\b/i.test(text);

  // Org-change signals: the deterministic overrides first (they always win),
  // then unambiguous org-metadata nouns.
  const orgOverride = applyDeterministicOverrides(text, 'agent');
  const orgPhrase =
    /\b(custom\s+)?fields?\b/i.test(text) ||
    /\b(custom\s+)?objects?\b/i.test(text) ||
    /\bapex\b/i.test(text) ||
    /\brecord types?\b/i.test(text) ||
    /\blayouts?\b/i.test(text) ||
    /\blist views?\b/i.test(text) ||
    /\breport types?\b/i.test(text) ||
    /\bsharing rules?\b/i.test(text) ||
    /\bowd\b/i.test(text) ||
    /\bprofiles?\b/i.test(text) ||
    /\bpicklists?\b/i.test(text) ||
    /\b(add|create|make|rename|remove|delete)\b[^.!?]{0,12}\btabs?\b/i.test(text);
  const hasOrg = Boolean(orgOverride) || orgPhrase;

  // A bare "agent" mention only counts when no override fired — the overrides
  // exist precisely to beat misleading "agent" wording (golden-set cases).
  const hasAgent = agentAction || (agentMention && !orgOverride);

  if (hasAgent && hasOrg) {
    return {
      capability: 'both',
      confidence: 0.8,
      reason: 'Agent + org-change signals both present — will run sequentially (EC-23)',
      overrideSource: 'stub',
    };
  }
  if (hasAgent) {
    return { capability: 'agent', confidence: 0.9, reason: 'Agent phrase matched the rule-based lexicon', overrideSource: 'stub' };
  }
  if (hasOrg) {
    return {
      capability: 'org_change',
      confidence: orgOverride ? 1 : 0.9,
      reason: orgOverride ? orgOverride.reason : 'Org-change metadata phrase matched the rule-based lexicon',
      overrideSource: 'stub',
    };
  }
  return { capability: 'clarify', confidence: 0, reason: 'No rule matched — will ask to clarify', overrideSource: 'stub' };
}
