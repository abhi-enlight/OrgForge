/**
 * Unit tests for the ConversationManager's durable context-memory helpers
 * (context-memory pass). Scope: the PURE parts only — transcript extraction /
 * bounding, resume-history building, idempotent resume application, snapshot
 * access. No init()/handleMessage() (those hit live Salesforce + Gemini; the
 * smoke test's scope rules apply).
 */
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';

// The module constructs its Gemini client at module scope — set dummy keys
// BEFORE the dynamic import so the module graph evaluates without a real key
// (same guard the smoke test uses).
process.env.GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || 'DUMMY_KEY_MEMORY_TEST';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'DUMMY_KEY_MEMORY_TEST';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let ConversationManager;
let extractTextTurns;
let normalizeTurnsIntoHistory;
let genAI;
test('module loads ConversationManager (named export intact)', async () => {
  const mod = await import('./services/aiOrchestrator.js');
  ConversationManager = mod.ConversationManager;
  extractTextTurns = mod.extractTextTurns;
  normalizeTurnsIntoHistory = mod.normalizeTurnsIntoHistory;
  genAI = mod.genAI;
  assert.equal(typeof ConversationManager, 'function');
  assert.equal(typeof extractTextTurns, 'function');
  assert.equal(typeof normalizeTurnsIntoHistory, 'function');
});

after(() => mock.restoreAll());

const makeManager = () => new ConversationManager('u1|00D000000000001|sess-1');

test('_syncTranscript extracts bounded text turns, skipping synthetic markers and tool-only turns', async () => {
  const m = makeManager();
  m.chat = {
    _history: [
      { role: 'user', parts: [{ text: 'build an agent' }] },
      { role: 'model', parts: [{ text: 'Plan ready.' }, { text: ' More.' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'x', response: {} } }] }, // no text → skipped
      { role: 'model', parts: [{ functionCall: { name: 'x', args: {} } }] },        // no text → skipped
      // Synthetic compression pair — never persisted as verbatim turns.
      { role: 'user', parts: [{ text: '[CONTEXT SUMMARY — compact record of our conversation so far. Use it to maintain full context.]\n\nsumm' }] },
      { role: 'model', parts: [{ text: 'Understood. I have the full context of what has been built, confirmed, and decided so far. Ready to continue.' }] },
      { role: 'user', parts: [{ text: 'add a field' }] },
      { role: 'model', parts: [{ text: 'Field added.' }] },
    ],
  };
  m._syncTranscript();
  assert.deepEqual(
    m.transcriptTurns.map((t) => t.text),
    ['build an agent', 'Plan ready.  More.', 'add a field', 'Field added.']
  );
  assert.ok(m.transcriptTurns.every((t) => t.role === 'user' || t.role === 'model'));
});

test('_syncTranscript bounds turns to the newest MAX_TRANSCRIPT_TURNS', async () => {
  const m = makeManager();
  const many = Array.from({ length: 60 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'model',
    parts: [{ text: `t${i}` }],
  }));
  m.chat = { _history: many };
  m._syncTranscript();
  assert.ok(m.transcriptTurns.length <= 40, 'turn cap applied');
  assert.equal(m.transcriptTurns[0].text, 't20', 'oldest dropped, newest kept');
  assert.equal(m.transcriptTurns[m.transcriptTurns.length - 1].text, 't59');
});

test('_buildResumeHistory: summary pair + verbatim tail; consecutive same-role turns are MERGED, never dropped', async () => {
  const m = makeManager();
  const history = m._buildResumeHistory({
    summary: 'Built agent X with a Case topic. User confirmed no escalation.',
    turns: [
      { role: 'model', text: 'stray model turn' }, // consecutive after the ack → merged INTO the ack (content preserved)
      { role: 'user', text: 'what objects does it use?' },
      { role: 'model', text: 'Case and a custom object.' },
      { role: 'user', text: 'ok deploy' },
      { role: 'user', text: 'and add guardrails' }, // consecutive user → merged into previous user (content preserved)
      { role: 'model', text: 'Guardrails added.' },
    ],
  });
  assert.equal(history[0].role, 'user');
  assert.ok(history[0].parts[0].text.startsWith('[CONTEXT SUMMARY'), 'summary pair first');
  assert.equal(history[1].role, 'model', 'ack turn second');
  // The stray model turn merged INTO the ack — its content is preserved.
  assert.ok(history[1].parts[0].text.includes('stray model turn'), 'stray model content merged into ack, not dropped');
  const tail = history.slice(2);
  assert.deepEqual(tail.map((t) => t.role), ['user', 'model', 'user', 'model'], 'strict alternation');
  assert.deepEqual(tail.map((t) => t.parts[0].text), [
    'what objects does it use?',
    'Case and a custom object.',
    'ok deploy\nand add guardrails',
    'Guardrails added.',
  ]);
});

test('extractTextTurns: pure helper skips synthetic turns + tool-only parts, bounds the tail', async () => {
  const turns = extractTextTurns([
    { role: 'user', parts: [{ text: 'build an agent' }] },
    { role: 'model', parts: [{ text: 'Plan ready.' }, { text: ' More.' }] },
    { role: 'user', parts: [{ functionResponse: { name: 'x', response: {} } }] }, // no text → skipped
    { role: 'model', parts: [{ functionCall: { name: 'x', args: {} } }] },        // no text → skipped
    { role: 'user', parts: [{ text: '[CONTEXT SUMMARY — compact record of our conversation so far. Use it to maintain full context.]\n\nsumm' }] }, // synthetic → skipped
    { role: 'model', parts: [{ text: 'Understood. I have the full context of what has been built, confirmed, and decided so far. Ready to continue.' }] }, // ack → skipped
    { role: 'user', parts: [{ text: 'add a field' }] },
    { role: 'model', parts: [{ text: 'Field added.' }] },
  ]);
  assert.deepEqual(
    turns.map((t) => t.text),
    ['build an agent', 'Plan ready.  More.', 'add a field', 'Field added.']
  );
  assert.ok(turns.every((t) => t.role === 'user' || t.role === 'model'));

  // 60 alternating turns → capped to the newest 40.
  const many = Array.from({ length: 60 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'model',
    parts: [{ text: `t${i}` }],
  }));
  const bounded = extractTextTurns(many);
  assert.ok(bounded.length <= 40, 'turn cap applied');
  assert.equal(bounded[0].text, 't20', 'oldest dropped, newest kept');
  assert.equal(bounded[bounded.length - 1].text, 't59');
});

test('normalizeTurnsIntoHistory: merges consecutive same-role turns (never drops), drops a leading model turn', async () => {
  // Consecutive same-role turns merge with content preserved.
  const merged = normalizeTurnsIntoHistory([
    { role: 'user', text: 'first' },
    { role: 'user', text: 'second' },
    { role: 'model', text: 'answer' },
  ]);
  assert.deepEqual(merged, [
    { role: 'user', parts: [{ text: 'first\nsecond' }] },
    { role: 'model', parts: [{ text: 'answer' }] },
  ]);
  // A leading model turn (invalid alternation) is removed.
  assert.deepEqual(normalizeTurnsIntoHistory([{ role: 'model', text: 'hello?' }]), []);
  // Empty/whitespace texts are skipped; a lone non-user turn normalizes to
  // 'model' and is then dropped as invalid leading-model alternation.
  assert.deepEqual(normalizeTurnsIntoHistory([{ role: 'user', text: '  ' }, { role: 'tool', text: 'x' }]), []);
  // ...but the same normalized model turn AFTER a user turn is kept.
  assert.deepEqual(normalizeTurnsIntoHistory([{ role: 'user', text: 'hi' }, { role: 'tool', text: 'x' }]), [
    { role: 'user', parts: [{ text: 'hi' }] },
    { role: 'model', parts: [{ text: 'x' }] },
  ]);
});

test('_buildResumeHistory: no summary → plain turns; leading model dropped (invalid alternation)', async () => {
  const m = makeManager();
  const history = m._buildResumeHistory({
    summary: null,
    turns: [{ role: 'model', text: 'hello?' }],
  });
  assert.deepEqual(history, [], 'no valid alternation → empty (fresh chat)');
});

test('applyResumeContext is idempotent and getContextSnapshot mirrors state', async () => {
  const m = makeManager();
  const snapshot = { turns: [{ role: 'user', text: 'earlier' }], summary: 's1' };
  assert.equal(m.applyResumeContext(snapshot), true, 'applied on empty state');
  assert.deepEqual(m.getContextSnapshot(), { turns: [{ role: 'user', text: 'earlier' }], summary: 's1' });
  assert.equal(
    m.applyResumeContext({ turns: [{ role: 'user', text: 'stale' }], summary: 'stale' }),
    false,
    'second apply refused — first snapshot kept'
  );
  assert.deepEqual(m.getContextSnapshot().turns, [{ role: 'user', text: 'earlier' }], 'first snapshot wins');

  const fresh = makeManager();
  assert.equal(fresh.applyResumeContext({ turns: [], summary: null }), false, 'nothing to apply → false');
  assert.deepEqual(fresh.getContextSnapshot(), { turns: [], summary: null });
  assert.equal(fresh.applyResumeContext({ turns: [{ role: 'user', text: 'later' }] }), true, 'non-empty turns apply');
  assert.equal(fresh.getContextSnapshot().turns.length, 1);
});

// ─────────────────────────────────────────────────────────────
//  _compressHistoryIfNeeded — END-TO-END with a mocked Flash model
//  genAI.getGenerativeModel is stubbed via node:test mock.method so the
//  compression pass runs its real logic (threshold, guards, keep-tail split,
//  exact-name hints, synthetic-history rebuild) without any Gemini network
//  call. Guard paths assert the flash model is NEVER invoked.
// ─────────────────────────────────────────────────────────────

/** Alternating user/model Gemini turns t0..tN-1 (text only). */
const buildHistory = (n) =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'model',
    parts: [{ text: `t${i}` }],
  }));

const LONG_SUMMARY =
  'Built SupportAgent with Case_Triage topic and Fetch_Case Apex action. ' +
  'User confirmed no escalation. Deployment attempted once, still in progress.';

/**
 * Stubs genAI.getGenerativeModel with a counting fake. Returns a state handle
 * with { calls, prompts, modelOpts } and records the flash summary to return.
 */
const stubFlash = (summary) => {
  const state = { calls: 0, prompts: [], modelOpts: [] };
  mock.method(genAI, 'getGenerativeModel', (opts) => {
    state.calls++;
    state.modelOpts.push(opts);
    return {
      generateContent: async (prompt) => {
        state.prompts.push(prompt);
        return { response: { text: () => summary } };
      },
    };
  });
  return state;
};

/** Manager primed for a POST-confirmation, build-started compression. */
const makeBuildManager = (nTurns = 28) => {
  const m = makeManager();
  m.chat = { _history: buildHistory(nTurns) };
  m.model = {
    startChat: (opts) => {
      m._startChatOpts = opts;
      return { _history: [] }; // replaced chat — enough for the unit scope
    },
  };
  m.agentName = 'SupportAgent';
  m.requirementsConfirmed = true;
  m.deployHistory = [{ attempt: 1 }];
  m.ctx = {
    topics: [{ masterLabel: 'Case Triage', developerName: 'Case_Triage', purpose: 'Triage cases' }],
    actions: [{ masterLabel: 'Fetch Case', developerName: 'Fetch_Case', type: 'apex' }],
    guardrails: ['Never refund without approval'],
    escalation: { flow: 'Omni_Support_Routing' },
    knowledge: { enabled: false, ragId: '' },
    customObjects: [{ objectLabel: 'Case_Override__c' }],
    referencedObjects: new Set(['Case', 'Account']),
  };
  return m;
};

test('_compressHistoryIfNeeded: summary pair + kept verbatim tail; exact-name hints injected; durable state mirrored', async () => {
  const m = makeBuildManager(28);
  const flash = stubFlash(LONG_SUMMARY);

  await m._compressHistoryIfNeeded();

  // Flash was asked to summarize with the configured cheap model.
  assert.equal(flash.calls, 1, 'flash invoked exactly once');
  assert.equal(flash.modelOpts[0].model, process.env.JUDGE_MODEL || 'gemini-3.6-flash');

  // Exact-name hints + agent + deploy count all reach the summarizer.
  const prompt = flash.prompts[0];
  assert.ok(prompt.includes('SupportAgent'), 'agent name hinted');
  assert.ok(prompt.includes('Case_Triage') && prompt.includes('Case Triage'), 'topic developerName + masterLabel hinted');
  assert.ok(prompt.includes('Fetch_Case') && prompt.includes('[apex]'), 'action developerName + type hinted');
  assert.ok(prompt.includes('Case_Override__c'), 'custom object hinted');
  assert.ok(prompt.includes('Never refund without approval'), 'guardrail hinted');
  assert.ok(prompt.includes('Omni_Support_Routing'), 'escalation flow hinted');
  assert.ok(prompt.includes('Deployment attempts so far: 1'), 'deploy count hinted');
  assert.ok(prompt.includes('preserve EXACT developerName'), 'exact-name directive present');

  // The flash input contains ONLY the older turns (t0..t21) — the kept tail
  // (t22..t27) is excluded, so it cannot be distilled.
  assert.ok(prompt.includes('USER: t0') && prompt.includes('ASSISTANT: t21'), 'older turns included');
  assert.ok(!prompt.includes('t22'), 'kept tail excluded from the summary input');

  // New chat = summary pair + the 6-turn verbatim tail.
  const history = m._startChatOpts.history;
  assert.equal(history.length, 8, 'summary + ack + 6 kept turns');
  assert.deepEqual(history.map((h) => h.role), ['user', 'model', 'user', 'model', 'user', 'model', 'user', 'model']);
  assert.ok(history[0].parts[0].text.startsWith('[CONTEXT SUMMARY'), 'summary turn first');
  assert.ok(history[1].parts[0].text.startsWith('Understood.'), 'ack turn second');
  assert.deepEqual(history.slice(2).map((h) => h.parts[0].text), ['t22', 't23', 't24', 't25', 't26', 't27'], 'kept tail verbatim');

  // Durable memory mirrors the compressed state: summary + kept tail.
  assert.equal(m.contextSummary, LONG_SUMMARY);
  assert.deepEqual(m.transcriptTurns.map((t) => t.text), ['t22', 't23', 't24', 't25', 't26', 't27']);
  assert.equal(m.compressionCount, 1);
});

test('_compressHistoryIfNeeded: second compression folds the previous summary in (continuity)', async () => {
  // Compression #2 needs to clear the cooldown: threshold 28 + 1 × cooldown 10.
  const m = makeBuildManager(38);
  const PREV_SUMMARY =
    'Earlier: user wants a Case triage agent with priority routing, no escalation, guardrails confirmed.';
  m.contextSummary = PREV_SUMMARY; // compression #1 already happened
  m.compressionCount = 1;
  const flash = stubFlash(LONG_SUMMARY);

  await m._compressHistoryIfNeeded();

  const prompt = flash.prompts[0];
  assert.ok(prompt.includes('PREVIOUS SUMMARY'), 'previous summary explicitly labeled for continuity');
  assert.ok(prompt.includes(PREV_SUMMARY), 'previous summary text folded into the prompt');
  assert.equal(m.contextSummary, LONG_SUMMARY, 'contextSummary replaced by the newer summary');
  assert.equal(m.compressionCount, 2);
});

test('_compressHistoryIfNeeded guards: never compress below threshold / mid-deploy / pre-build / empty older set', async () => {
  // 1) Below threshold.
  const below = makeBuildManager(20);
  const f1 = stubFlash(LONG_SUMMARY);
  await below._compressHistoryIfNeeded();
  assert.equal(f1.calls, 0, 'no flash call below threshold');
  assert.equal(below._startChatOpts, undefined, 'chat untouched');

  // 2) Mid-deploy — the most critical in-flight state.
  const deploying = makeBuildManager(28);
  deploying.state = 'deploying';
  const f2 = stubFlash(LONG_SUMMARY);
  await deploying._compressHistoryIfNeeded();
  assert.equal(f2.calls, 0, 'no flash call while deploying');
  assert.equal(deploying._startChatOpts, undefined, 'chat untouched mid-deploy');

  // 3) Requirements confirmed but build not started — decisions live ONLY in
  // the transcript, protect them.
  const preBuild = makeBuildManager(28);
  preBuild.ctx = { topics: [], actions: [] };
  const f3 = stubFlash(LONG_SUMMARY);
  await preBuild._compressHistoryIfNeeded();
  assert.equal(f3.calls, 0, 'no flash call in the confirmed-but-unbuilt window');

  // 4) History over threshold but fewer real text turns than the keep tail
  // (function-turn-heavy loop) → nothing to distill.
  const toolHeavy = makeManager();
  toolHeavy.chat = {
    _history: [
      { role: 'user', parts: [{ text: 'go' }] },
      ...Array.from({ length: 26 }, (_, i) =>
        i % 2 === 0
          ? { role: 'model', parts: [{ functionCall: { name: 'create_topic', args: {} } }] }
          : { role: 'user', parts: [{ functionResponse: { name: 'create_topic', response: {} } }] }
      ),
      { role: 'model', parts: [{ text: 'done' }] },
    ],
  };
  toolHeavy.model = { startChat: (opts) => { toolHeavy._startChatOpts = opts; return { _history: [] }; } };
  const f4 = stubFlash(LONG_SUMMARY);
  await toolHeavy._compressHistoryIfNeeded();
  assert.equal(f4.calls, 0, 'no flash call when only 2 real turns exist');
  assert.equal(toolHeavy._startChatOpts, undefined, 'chat untouched');
});
