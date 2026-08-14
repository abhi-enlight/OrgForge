import { Router } from 'express';
import { isMissingTableError, isMissingSchemaError } from '../lib/isMissingTable.js';
import { forgeDb as forgeDbSingleton } from '../lib/supabaseClients.js';

/**
 * The forge.* tables migration 008 (S-2) creates — the unified data model the
 * readiness check must verify (plan §9.1). Extends OrgForge's /health/db table
 * check to the forge schema (plan §10.1, §14.2 Phase 3).
 *
 * NOTE (Pass 42): org_connections is VESTIGIAL here — the copilot resolves
 * credentials from the default-schema public.org_connections (the store the
 * OAuth flow writes). It stays in this list only because 008 still creates it
 * (this gate doubles as "is 008 applied"). See supabase/migrations/README.md.
 */
const ORGFORGE_TABLES = [
  'org_connections',
  'agents',
  'chat_sessions',
  'routing_log',
  'diagnostics',
  'ai_logs',
];

// Shared singleton from lib/supabaseClients.js — forge schema, one connection pool per process.

/**
 * Builds the unified health router (plan §10.1).
 *
 * GET /api/v1/health     → liveness: the process is up (OrgForge contract)
 * GET /api/v1/health/db  → readiness: every forge.* table reachable
 *
 * The DB check mirrors OrgForge's /health/db but scoped to the forge schema.
 * Missing-table errors (migration 008 pending) degrade to a 503 with the exact
 * missing tables; ANY other database error fails loudly through next(err)
 * (repo convention — a dead DB is a real failure, surfaced as a 500).
 *
 * @param {object} [opts]
 * @param {() => object} [opts.forgeDbFactory] - forge-schema supabase client (tests inject a stub)
 */
export function createHealthRouter({ forgeDbFactory = () => forgeDbSingleton } = {}) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  router.get('/db', async (req, res, next) => {
    try {
      const forgeDb = forgeDbFactory();
      const missingTables = [];
      let sawMissingSchema = false;

      for (const table of ORGFORGE_TABLES) {
        const { error } = await forgeDb.from(table).select('id').limit(1);
        if (!error) continue;
        if (!isMissingTableError(error)) {
          throw new Error(`Health check for forge.${table} failed: ${error.message}`);
        }
        missingTables.push(table);
        if (isMissingSchemaError(error)) sawMissingSchema = true;
      }

      if (missingTables.length === 0) {
        return res.json({
          status: 'healthy',
          schema: 'orgforge',
          missingTables: [],
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(503).json({
        status: 'unhealthy',
        schema: 'orgforge',
        missingTables,
        // migrationPending is only claimed when the schema itself is absent
        // (PGRST106) — a partial/missing table in an applied schema is reported
        // as a plain missingTables list, not a migration-state assertion.
        ...(sawMissingSchema
          ? { migrationPending: true, note: 'forge schema absent. Apply supabase/migrations/008_forge_schema.sql (S-2)' }
          : {}),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const healthRouter = createHealthRouter();
