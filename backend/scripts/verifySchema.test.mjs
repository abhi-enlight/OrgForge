import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runVerification, FORGE_TABLES } from './verifySchema.mjs';

const SAMPLE_TABLES = { agents: ['id', 'user_id', 'org_id', 'developer_name'] };

/**
 * Fake forge-scoped supabase client.
 * @param {object} [opts]
 * @param {string[]} [opts.missing] - table names that report a missing-table error
 * @param {string[]} [opts.permission] - table names that report permission denied
 * @param {Record<string,string>} [opts.hardError] - { table: message } → unclassifiable error
 * @param {Record<string,string[]>} [opts.missingColumns] - { table: [PGRST204 msgs] } —
 *   returned in order on the column probe (one per call, then success), mirroring how
 *   PostgREST reports one missing column at a time
 * @param {boolean} [opts.idGap] - report a PGRST204 on the existence probe (table exists, no id)
 */
function makeFakeDb({
  missing = [],
  permission = [],
  hardError = {},
  missingColumns = {},
  idGap = false,
} = {}) {
  const columnCall = {};
  return {
    from: (table) => ({
      select: (cols) => ({
        limit: async () => {
          if (missing.includes(table)) {
            return { data: null, error: { code: 'PGRST106', message: `Could not find the '${table}' table in the schema cache` } };
          }
          if (permission.includes(table)) {
            return { data: null, error: { code: 'PGRST101', message: `permission denied for table forge.${table}` } };
          }
          if (hardError[table]) {
            return { data: null, error: { code: '500', message: hardError[table] } };
          }
          if (cols === 'id') {
            if (idGap) {
              return { data: null, error: { code: 'PGRST204', message: `Could not find the 'id' column of '${table}' in the schema cache` } };
            }
            return { data: [{}], error: null };
          }
          const list = missingColumns[table];
          if (Array.isArray(list) && list.length > 0) {
            const idx = columnCall[table] ?? 0;
            columnCall[table] = idx + 1;
            if (idx < list.length) {
              return { data: null, error: { code: 'PGRST204', message: list[idx] } };
            }
          }
          return { data: [{}], error: null };
        },
      }),
    }),
  };
}

test('all tables present with all required columns → ok, per-table verdicts', async () => {
  const db = makeFakeDb();
  const res = await runVerification({ db, tables: SAMPLE_TABLES });

  assert.equal(res.ok, true);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].table, 'agents');
  assert.equal(res.results[0].ok, true);
  assert.equal(res.results[0].checked, 4);
  assert.equal(res.results[0].expected, 4);
});

test('full six-table set passes when every table exists (FORGE_TABLES shapes)', async () => {
  const db = makeFakeDb();
  const res = await runVerification({ db });
  assert.equal(res.ok, true);
  assert.equal(res.results.length, 6, 'all six forge.* tables are verified');
});

test('missing table → classified missing, not ok, other tables still checked', async () => {
  const db = makeFakeDb({ missing: ['diagnostics'] });
  const res = await runVerification({ db });

  assert.equal(res.ok, false);
  const diag = res.results.find((r) => r.table === 'diagnostics');
  assert.equal(diag.missing, true);
  assert.match(diag.errorMessage, /could not find the 'diagnostics' table/i);
  assert.equal(res.results.filter((r) => r.ok).length, 5, 'the other five tables still verify');
});

test('missing column → parsed from PGRST204 message, reported as column gap', async () => {
  const db = makeFakeDb({
    missingColumns: { agents: ["Could not find the 'yaml_ref' column of 'agents' in the schema cache"] },
  });
  const res = await runVerification({ db, tables: SAMPLE_TABLES });

  assert.equal(res.ok, false);
  assert.deepEqual(res.results[0].missingColumns, ['yaml_ref']);
});

test('ALL missing columns reported in one run (retry loop drops each reported column)', async () => {
  const db = makeFakeDb({
    missingColumns: {
      agents: [
        "Could not find the 'yaml_ref' column of 'agents' in the schema cache",
        "Could not find the 'description' column of 'agents' in the schema cache",
      ],
    },
  });
  const res = await runVerification({ db, tables: SAMPLE_TABLES });

  assert.equal(res.ok, false);
  assert.deepEqual(res.results[0].missingColumns, ['yaml_ref', 'description']);
});

test('table exists but has no id (existence probe PGRST204) → column gap, not hard error', async () => {
  const db = makeFakeDb({ idGap: true });
  const res = await runVerification({ db, tables: SAMPLE_TABLES });

  assert.equal(res.ok, false);
  assert.deepEqual(res.results[0].missingColumns, ['id']);
});

test('permission denied (grants missing) → classified permission, not ok', async () => {
  const db = makeFakeDb({ permission: ['ai_logs'] });
  const res = await runVerification({ db });

  assert.equal(res.ok, false);
  const row = res.results.find((r) => r.table === 'ai_logs');
  assert.equal(row.permission, true);
  assert.match(row.errorMessage, /permission denied/i);
});

test('unclassifiable DB error fails loudly (does not silently pass)', async () => {
  const db = makeFakeDb({ hardError: { agents: 'connection refused' } });
  await assert.rejects(() => runVerification({ db, tables: SAMPLE_TABLES }), /connection refused/);
});

test('empty tables config is rejected (no vacuous pass)', async () => {
  const db = makeFakeDb();
  await assert.rejects(() => runVerification({ db, tables: {} }), /no tables configured/);
});

test('FORGE_TABLES exposes all six migration-008 tables with non-empty column lists', () => {
  const names = Object.keys(FORGE_TABLES);
  assert.deepEqual(names.sort(), ['agents', 'ai_logs', 'chat_sessions', 'diagnostics', 'org_connections', 'routing_log']);
  for (const cols of Object.values(FORGE_TABLES)) {
    assert.ok(Array.isArray(cols) && cols.length > 0, 'each table lists required columns');
    assert.ok(cols.includes('id'), 'every forge table has an id column (existence probe)');
  }
});
