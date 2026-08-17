import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractQuickReplies } from './quickReplies.js';

describe('extractQuickReplies', () => {
  it('extracts "A or B" choices dynamically', () => {
    const msg = 'Would you like to make any modifications to this agent, or test it first to see how it performs in one of these workflows?';
    const replies = extractQuickReplies(msg);
    assert.equal(replies.length, 3);
    assert.match(replies[0].label, /make any modifications/i);
    assert.match(replies[1].label, /test it first/i);
    assert.equal(replies[2].label, 'You decide');
  });

  it('extracts plan approval replies', () => {
    const msg = 'Does this robust plan look good? Should I add or change anything before I start building?';
    const replies = extractQuickReplies(msg);
    assert.equal(replies.length, 3);
    assert.equal(replies[0].label, 'Looks good, start building');
    assert.equal(replies[1].label, 'Make adjustments');
    assert.equal(replies[2].label, 'You decide');
  });

  it('extracts escalation questions', () => {
    const msg = 'Do you want to configure human escalation for unresolved cases?';
    const replies = extractQuickReplies(msg);
    assert.equal(replies.length, 3);
    assert.match(replies[0].label, /configure human escalation/i);
    assert.match(replies[1].label, /No escalation/i);
  });

  it('extracts object connection questions', () => {
    const msg = 'Which Salesforce object should this agent connect to?';
    const replies = extractQuickReplies(msg);
    assert.equal(replies.length, 4);
    assert.equal(replies[0].label, 'Case object');
  });

  it('extracts numbered options from message body', () => {
    const msg = `Please choose one of the following integration modes:
1. REST API
2. Webhook Event
3. Batch Sync
Which one should we use?`;
    const replies = extractQuickReplies(msg);
    assert.ok(replies.length >= 3);
    assert.match(replies[0].label, /REST API/i);
    assert.match(replies[1].label, /Webhook Event/i);
  });
});
