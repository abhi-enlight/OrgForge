import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterErrorLogs, runSelfImprovement } from './selfImprovement.js';

function createFakeDb({ logs = [], lessons = [], missingTable = false, dbError = null } = {}) {
  const state = {
    logs: [...logs],
    lessons: [...lessons],
    insertedLessons: [],
    updatedLessons: [],
  };

  const db = {
    state,
    from(table) {
      if (table === 'ai_logs') {
        return {
          select() {
            return {
              gte: async (col, val) => {
                if (missingTable) {
                  return { data: null, error: { message: "Could not find the table 'forge.ai_logs' in schema cache", code: 'PGRST205' } };
                }
                if (dbError) {
                  return { data: null, error: dbError };
                }
                const filtered = state.logs.filter(l => !val || l.created_at >= val);
                return { data: filtered, error: null };
              },
            };
          },
        };
      }

      if (table === 'ai_lessons') {
        return {
          select() {
            return {
              eq: async (col, val) => {
                if (missingTable) {
                  return { data: null, error: { message: "Could not find the table 'forge.ai_lessons' in schema cache", code: 'PGRST205' } };
                }
                const active = state.lessons.filter(l => l.active === val);
                return { data: active, error: null };
              },
            };
          },
          insert: async (payload) => {
            const row = { id: `lesson-${state.lessons.length + 1}`, ...payload };
            state.lessons.push(row);
            state.insertedLessons.push(row);
            return { data: [row], error: null };
          },
          update(updates) {
            return {
              eq: async (col, val) => {
                const target = state.lessons.find(l => l[col] === val);
                if (target) {
                  Object.assign(target, updates);
                  state.updatedLessons.push({ id: val, updates });
                }
                return { data: target, error: null };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return db;
}

test('clusterErrorLogs: deduplicates identical error signatures and captures both capabilities', () => {
  const logs = [
    { capability: 'agent', salesforce_error: 'The user license does not allow the permission', status: 'FAILED' },
    { capability: 'agent', salesforce_error: 'The user license does not allow the permission', status: 'FAILED' },
    { capability: 'org_change', dry_run_errors: [{ problem: 'Field Status__c does not exist' }], status: 'FAILED' },
    { capability: 'agent', error_code: 'TOPIC_SYNTAX_ERROR', status: 'FAILED' },
  ];

  const clustered = clusterErrorLogs(logs);
  assert.equal(clustered.length, 3, 'dedupes identical SF error log');
  assert.equal(clustered[0].capability, 'agent');
  assert.match(clustered[0].error, /The user license does not allow/);
  assert.equal(clustered[1].capability, 'org_change');
  assert.match(clustered[1].error, /Field Status__c does not exist/);
  assert.equal(clustered[2].error, 'Error Code: TOPIC_SYNTAX_ERROR');
});

test('runSelfImprovement: skips gracefully when ai_logs table is missing (migration pending)', async () => {
  const db = createFakeDb({ missingTable: true });
  const result = await runSelfImprovement({ db });
  assert.equal(result.missingTable, true);
  assert.equal(result.synthesizedCount, 0);
});

test('runSelfImprovement: returns no_failures when all logs are successful', async () => {
  const db = createFakeDb({
    logs: [
      { id: 1, capability: 'agent', status: 'SUCCESS', created_at: new Date().toISOString() },
      { id: 2, capability: 'org_change', status: 'SUCCESS', created_at: new Date().toISOString() },
    ],
  });

  const result = await runSelfImprovement({ db });
  assert.equal(result.success, true);
  assert.equal(result.synthesizedCount, 0);
  assert.equal(result.reason, 'no_failures');
});

test('runSelfImprovement: synthesizes new lessons and inserts into ai_lessons', async () => {
  const db = createFakeDb({
    logs: [
      {
        id: 1,
        capability: 'agent',
        status: 'FAILED',
        salesforce_error: 'Case object cannot be given Modify All permission for Einstein Agent User',
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        capability: 'org_change',
        status: 'FAILED',
        dry_run_errors: [{ problem: 'Unsupported custom field type conversion attempted from Text to Picklist' }],
        created_at: new Date().toISOString(),
      },
    ],
    lessons: [
      { id: 'l-1', lesson_text: 'Always use __c for custom objects', active: true },
    ],
  });

  let capturedPrompt = '';
  const fakeAi = {
    generateContent: async (prompt, sysPrompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        newLessons: [
          'Never grant Modify All on Case to Einstein Agent User; use custom object proxy.',
          'Never convert existing Salesforce custom field types via Metadata API.',
        ],
      });
    },
  };

  const result = await runSelfImprovement({ db, ai: fakeAi });
  assert.equal(result.success, true);
  assert.equal(result.synthesizedCount, 2);
  assert.match(capturedPrompt, /Always use __c for custom objects/, 'includes existing active rules in prompt for deduplication');
  assert.equal(db.state.insertedLessons.length, 2);
  assert.equal(db.state.insertedLessons[0].lesson_text, 'Never grant Modify All on Case to Einstein Agent User; use custom object proxy.');
});

test('runSelfImprovement: prunes oldest active lessons when count exceeds maxActiveLessons', async () => {
  const existing = Array.from({ length: 5 }, (_, i) => ({
    id: `old-${i}`,
    lesson_text: `Existing rule ${i}`,
    active: true,
  }));

  const db = createFakeDb({
    logs: [
      {
        id: 1,
        capability: 'agent',
        status: 'FAILED',
        salesforce_error: 'Some build failure',
        created_at: new Date().toISOString(),
      },
    ],
    lessons: existing,
  });

  const fakeAi = {
    generateContent: async () => JSON.stringify({
      newLessons: ['New rule A', 'New rule B'],
    }),
  };

  // maxActiveLessons = 5: with 5 existing + 2 new = 7, 2 oldest should be deactivated
  const result = await runSelfImprovement({ db, ai: fakeAi, maxActiveLessons: 5 });
  assert.equal(result.synthesizedCount, 2);
  assert.equal(db.state.updatedLessons.length, 2);
  assert.equal(db.state.updatedLessons[0].id, 'old-0');
  assert.equal(db.state.updatedLessons[1].id, 'old-1');
});
