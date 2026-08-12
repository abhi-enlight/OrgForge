import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHealthRouter } from './health.js';
import { isMissingSchemaError } from '../lib/isMissingTable.js';

/** Fake forge-schema client: `.from(table).select('id').limit(1)` → {error}. */
function fakeDb(errorForTable) {
  return {
    from(table) {
      return {
        select() {
          return {
            limit: async () => ({ error: errorForTable(table) }),
          };
        },
      };
    },
  };
}

/** Mounts the router on a throwaway express app and returns fetch-able server. */
async function mount(forgeDbFactory) {
  const app = express();
  const router = createHealthRouter({ forgeDbFactory });
  app.use('/api/v1/health', router);
  app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Internal server error' });
  });
  const server = app.listen(0);
  const port = server.address().port;
  return { server, base: `http://127.0.0.1:${port}/api/v1/health` };
}

test('GET /api/v1/health (liveness) returns 200 status ok', async () => {
  const { server, base } = await mount(() => fakeDb(() => null));
  try {
    const res = await fetch(base);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  } finally {
    server.close();
  }
});

test('GET /api/v1/health/db: all forge tables reachable → healthy 200', async () => {
  const { server, base } = await mount(() => fakeDb(() => null));
  try {
    const res = await fetch(`${base}/db`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'healthy');
    assert.equal(body.schema, 'forge');
    assert.deepEqual(body.missingTables, []);
  } finally {
    server.close();
  }
});

test('GET /api/v1/health/db: some tables missing → 503 with the exact list', async () => {
  const { server, base } = await mount(() =>
    fakeDb((table) =>
      table === 'routing_log' || table === 'agents'
        ? { message: `Could not find the table 'forge.${table}' in schema cache` }
        : null
    )
  );
  try {
    const res = await fetch(`${base}/db`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.status, 'unhealthy');
    assert.deepEqual(body.missingTables.sort(), ['agents', 'routing_log']);
    // Schema present → no migration-state claim (only the missing list).
    assert.equal(body.migrationPending, undefined);
  } finally {
    server.close();
  }
});

test('GET /api/v1/health/db: forge schema absent (PGRST106) → 503 + pending note', async () => {
  const { server, base } = await mount(() =>
    fakeDb(() => ({ message: 'PGRST106', details: 'The schema must be one of the following: public' }))
  );
  try {
    const res = await fetch(`${base}/db`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.missingTables.length, 6, 'every forge table reports missing without the schema');
    assert.equal(body.migrationPending, true);
    assert.match(body.note, /008_forge_schema\.sql/, 'note names the pending migration');
  } finally {
    server.close();
  }
});

test('GET /api/v1/health/db: real DB failure → 500 (fail-loud, not a table-missing degrade)', async () => {
  const { server, base } = await mount(() =>
    fakeDb(() => ({ message: 'Connection refused (postgres down)' }))
  );
  try {
    const res = await fetch(`${base}/db`);
    assert.equal(res.status, 500);
  } finally {
    server.close();
  }
});

test('isMissingSchemaError: PGRST106 / "invalid schema" only, not single-table misses', () => {
  assert.equal(isMissingSchemaError({ message: 'PGRST106', details: 'invalid schema' }), true);
  assert.equal(isMissingSchemaError({ message: 'Invalid schema: forge' }), true);
  assert.equal(isMissingSchemaError({ message: "Could not find the table 'forge.routing_log' in schema cache" }), false);
  assert.equal(isMissingSchemaError({ message: 'Connection refused' }), false);
  assert.equal(isMissingSchemaError(null), false);
});
