/**
 * Offline instantiation smoke for the ported Agentforge ConversationManager.
 *
 * Why this exists: the CJS→ESM port (Pass 32, backend/scripts/portAgentforge.mjs)
 * can't be validated by binding analysis alone. The engine's own tests inject
 * a fake ManagerClass and the agents route tests inject listAgents, so the
 * REAL ported modules never execute in the suite. An ESM named import of a
 * name the ported file doesn't actually export resolves successfully with an
 * `undefined` binding — it only explodes at runtime ("undefined is not a
 * function"). This smoke imports the real module and every module-level
 * dependency binding it consumes, and asserts each resolves.
 *
 * Scope: constructor-only + binding checks — deliberately NO init()/
 * handleMessage() (those hit live Salesforce + Gemini; that is the A2
 * live-run's job). The internal bindings ARE covered: aiOrchestrator's five
 * module-scope imports (sfClient default + four named) are each imported here
 * and asserted to be functions.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// The ported module constructs its Gemini client at module scope
// (`const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY)`) —
// set a dummy BEFORE the dynamic import so the module graph evaluates
// deterministically without a real key (same guard the classifier tests use
// for the lazy client). Both names are set: GOOGLE_AI_API_KEY is canonical,
// GEMINI_API_KEY the legacy fallback.
process.env.GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || 'DUMMY_KEY_OFFLINE_SMOKE';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'DUMMY_KEY_OFFLINE_SMOKE';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
process.env.JUDGE_MODEL = process.env.JUDGE_MODEL || 'gemini-2.5-flash';

const SMOKE_KEY = 'smoke|00D000000000001|sess-smoke-1';

let ConversationManager;
let sfClient;
let generateMockData;
let testAgent;
let saveLog;
let fetchActiveLessons;
let analyzeSingleFailure;

before(async () => {
  // Dynamic import AFTER env is set — module-scope code (genAI construction)
  // captures GEMINI_API_KEY at evaluation time.
  const mod = await import('../agentforge/services/aiOrchestrator.js');
  ConversationManager = mod.ConversationManager;
  sfClient = (await import('../agentforge/services/salesforceClient.js')).default;
  // aiOrchestrator's other module-scope imports (all named) — asserting each
  // binding here catches a port that turned a named export into a default (or
  // lost the body entirely, as the `export { }` bug did during the port).
  ({ generateMockData } = await import('../agentforge/services/mockDataGenerator.js'));
  ({ testAgent } = await import('../agentforge/services/agentTester.js'));
  ({ saveLog, fetchActiveLessons } = await import('../agentforge/services/logService.js'));
  ({ analyzeSingleFailure } = await import('../agentforge/services/judgeService.js'));
});

describe('ported agentforge modules — offline instantiation smoke', () => {
  it('exports ConversationManager as a constructable class (named export binding intact)', () => {
    assert.equal(typeof ConversationManager, 'function');
  });

  it('constructs a ConversationManager with no network/env access', () => {
    const m = new ConversationManager(SMOKE_KEY);
    assert.equal(m.sessionId, SMOKE_KEY);
    assert.equal(m.state, 'idle');
    assert.equal(m.deployHistory.length, 0);
    // No Gemini session/model opened at construction — init() does that.
    assert.equal(m.chat, null);
    assert.equal(m.model, null);
    // The engine surface agentEngine relies on.
    assert.equal(typeof m.init, 'function');
    assert.equal(typeof m.handleMessage, 'function');
    assert.equal(typeof m.abort, 'function');
  });

  it('resolves every module-level dependency binding aiOrchestrator imports', () => {
    assert.equal(typeof sfClient.getAgents, 'function'); // default import (agents.js consumer shape)
    assert.equal(typeof sfClient.retrieveAgent, 'function');
    assert.equal(typeof generateMockData, 'function'); // { generateMockData } from mockDataGenerator.js
    assert.equal(typeof testAgent, 'function'); // { testAgent } from agentTester.js
    assert.equal(typeof saveLog, 'function'); // { saveLog, fetchActiveLessons } from logService.js
    assert.equal(typeof fetchActiveLessons, 'function');
    assert.equal(typeof analyzeSingleFailure, 'function'); // { analyzeSingleFailure } from judgeService.js
  });
});
