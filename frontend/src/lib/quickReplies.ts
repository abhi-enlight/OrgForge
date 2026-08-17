/**
 * Extracts context-aware, dynamic quick replies from an assistant message.
 * Replaces static 'Yes / No / You decide' with tailored response pills.
 */

export interface QuickReplyOption {
  label: string;
  value: string;
  isPrimary?: boolean;
}

/**
 * Clean up text for a compact pill label (max ~35 chars).
 */
function formatPillLabel(raw: string): string {
  let s = raw.trim();
  // Remove leading markdown formatting or numbers
  s = s.replace(/^[\d+.)\-•*]+\s*/, '');
  s = s.replace(/^\*+|\*+$/g, '');
  s = s.replace(/^["'`]|["'`]$/g, '');
  // Capitalize first letter
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > 40) {
    s = s.slice(0, 37).trim() + '…';
  }
  return s;
}

export function extractQuickReplies(content: string): QuickReplyOption[] {
  if (!content || typeof content !== 'string') return [];

  const trimmed = content.trim();

  // Find the last question in the message
  const questionMatches = trimmed.match(/([^.!?\n]+(?:\?|\b(?:which|what|choose|select)\b[^.!?\n]+)\?*)/gi);
  const lastQuestion = questionMatches ? questionMatches[questionMatches.length - 1].trim() : '';

  // ── 1. Plan Approval / Build Confirmation ─────────────────────────────────
  if (
    /does this (?:plan|architecture|design) look good/i.test(trimmed) ||
    /should i start building/i.test(trimmed) ||
    /ready to (?:build|proceed|deploy)/i.test(trimmed) ||
    /should i proceed with/i.test(trimmed)
  ) {
    return [
      { label: 'Looks good, start building', value: 'Looks good, proceed with building this agent.', isPrimary: true },
      { label: 'Make adjustments', value: 'I would like to make some adjustments to the plan.' },
      { label: 'You decide', value: 'You decide the best configuration.' },
    ];
  }

  // ── 2. "A or B" Choice Questions ──────────────────────────────────────────
  // e.g. "Would you like to make any modifications, or test it first in a workflow?"
  // e.g. "Should I connect to Case, Order, or create a new Custom Object?"
  const orMatch = lastQuestion.match(/would you like (?:to )?([^,?]+?)(?:,\s*or|\s+or)\s+([^?]+)\?/i) ||
                  lastQuestion.match(/(?:do you want|should (?:we|i)) (?:to )?([^,?]+?)(?:,\s*or|\s+or)\s+([^?]+)\?/i);

  if (orMatch) {
    const opt1 = formatPillLabel(orMatch[1]);
    const opt2 = formatPillLabel(orMatch[2]);

    if (opt1.length > 2 && opt2.length > 2 && opt1.toLowerCase() !== opt2.toLowerCase()) {
      return [
        { label: opt1, value: opt1, isPrimary: true },
        { label: opt2, value: opt2 },
        { label: 'You decide', value: 'You decide what is best.' },
      ];
    }
  }

  // ── 3. Numbered or Bulleted Option Lists in Message ───────────────────────
  // Look for options like "1. Cases", "2. Leads", "3. Custom Object"
  const listMatches = trimmed.match(/(?:^|\n)\s*(?:[1-4][.)]|\*|•|-)\s*(?:\*\*)?([A-Z0-9][^\n:*?]+)(?:\*\*)?(?::|\n|$)/gm);
  if (listMatches && listMatches.length >= 2 && listMatches.length <= 5) {
    const options: QuickReplyOption[] = [];
    for (const match of listMatches) {
      const clean = formatPillLabel(match);
      if (clean.length > 2 && clean.length < 35 && !options.some(o => o.label.toLowerCase() === clean.toLowerCase())) {
        options.push({ label: clean, value: clean, isPrimary: options.length === 0 });
      }
    }
    if (options.length >= 2) {
      options.push({ label: 'You decide', value: 'You decide the best option.' });
      return options;
    }
  }

  // ── 4. Human Escalation Questions ─────────────────────────────────────────
  if (/escalat(?:e|ion)/i.test(lastQuestion)) {
    return [
      { label: 'Yes, configure human escalation', value: 'Yes, configure human escalation via Omni-Channel.', isPrimary: true },
      { label: 'No escalation needed', value: 'No human escalation needed, handle everything autonomously.' },
      { label: 'You decide', value: 'You decide whether escalation is needed.' },
    ];
  }

  // ── 5. Salesforce Object Questions ────────────────────────────────────────
  if (/which (?:salesforce )?object/i.test(lastQuestion) || /connect to/i.test(lastQuestion)) {
    return [
      { label: 'Case object', value: 'Connect to standard Case object.', isPrimary: true },
      { label: 'Lead / Account object', value: 'Connect to Lead and Account objects.' },
      { label: 'Create new Custom Object', value: 'Create a new Custom Object for this agent.' },
      { label: 'You decide', value: 'You decide the best data model.' },
    ];
  }

  // ── 6. Verification / Test Scenarios ──────────────────────────────────────
  if (/test (?:it|this|scenario)|verify/i.test(lastQuestion)) {
    return [
      { label: 'Run a test inquiry', value: 'Run a test inquiry with sample data.', isPrimary: true },
      { label: 'Check agent instructions', value: 'Show me the configured agent instructions.' },
      { label: 'Looks good', value: 'Everything looks good, thank you.' },
    ];
  }

  // ── 7. Binary "Do you / Should I / Can I" Questions ───────────────────────
  if (
    /^(?:do you|should (?:i|we)|would you|can (?:i|we)|is there|are you)\b/i.test(lastQuestion) ||
    /\?\s*$/.test(trimmed)
  ) {
    // Extract the action phrase if possible
    const actionMatch = lastQuestion.match(/(?:do you want|would you like|should i|can i) (?:to )?([^?]+)\?/i);
    if (actionMatch && actionMatch[1].length > 3 && actionMatch[1].length < 30) {
      const action = formatPillLabel(actionMatch[1]);
      return [
        { label: `Yes, ${action.toLowerCase()}`, value: `Yes, ${action.toLowerCase()}.`, isPrimary: true },
        { label: 'No, skip this', value: `No, skip ${action.toLowerCase()}.` },
        { label: 'You decide', value: 'You decide the best approach.' },
      ];
    }

    return [
      { label: 'Yes, proceed', value: 'Yes, proceed with this.', isPrimary: true },
      { label: 'No, adjust', value: 'No, I want to make adjustments.' },
      { label: 'You decide', value: 'You decide what is best.' },
    ];
  }

  return [];
}
