#!/usr/bin/env node
/**
 * verifySchema.mjs — Forge schema verifier (migration 008 / S-2).
 *
 * Extends OrgForge's `backend/scripts/verifySchema.mjs` convention to the
 * unified `forge` schema. Verifies ALL SIX forge.* tables exist and carry the
 * required columns from `supabase/migrations/008_forge_schema.sql`, scoped to
 * the forge schema (same client pattern as `backend/src/routes/health.js`).
 *
 * Exit codes:  0 = all six tables healthy (exist + all required columns)
 *              1 = any table missing, permission-denied, or column-gap
 *
 * Run from the repo root or api/:
 *   node backend/scripts/verifySchema.mjs
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (api/.env or root .env)
 *
 * Pre-migration expectation: reports all six MISSING (forge schema absent) —
 * that is the correct signal to run S-2, not a script failure.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load api/.env first, then the repo-root .env (dotenv never overrides
// existing env vars, so the more specific file wins).
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * The six forge.* tables migration 008 creates + their required columns.
 *
 * NOTE (Pass 42): forge.org_connections is VESTIGIAL — the copilot resolves
 * credentials from the default-schema public.org_connections (the store the
 * OAuth flow writes). It stays in the verification set only because 008 still
 * creates it (this verifier doubles as "is 008 applied").
 * See supabase/migrations/README.md.
 */
export const FORGE_TABLES = {
  org_connections: [
    'id', 'user_id', 'org_id', 'org_type', 'alias', 'instance_url',
    'encrypted_tokens', 'capabilities', 'context_indexed_at',
    'legacy_agentforge_user_id', 'disconnected_at', 'created_at', 'updated_at',
  ],
  agents: [
    'id', 'user_id', 'org_id', 'developer_name', 'label', 'description',
    'status', 'yaml_ref', 'last_deployed_at', 'created_at', 'updated_at',
  ],
  chat_sessions: [
    'id', 'session_id', 'user_id', 'org_id', 'capability_segments',
    'compressed_history', 'created_at', 'updated_at',
  ],
  routing_log: [
    'id', 'user_id', 'prompt_hash', 'capability', 'confidence',
    'override_source', 'created_at',
  ],
  diagnostics: [
    'id', 'user_id', 'org_id', 'state', 'detail', 'checked_at',
  ],
  ai_logs: [
    'id', 'user_id', 'org_id', 'session_id', 'capability', 'prompt',
    'ai_response', 'tool_calls', 'salesforce_error', 'status', 'error_code',
    'latency_ms', 'model_version', 'intent_id', 'dry_run_errors',
    'ai_repair_attempts', 'created_at',
  ],
};

// Error classification — mirrors `api/src/lib/isMissingTable.js` (S-2
// semantics: missing table degrades, ANY other error fails loudly).
const MISSING_TABLE_RE = /could not find the .* table|does not exist|PGRST106|invalid schema/i;
const MISSING_COLUMN_RE = /could not find the '([^']+)' column/i;
const PERMISSION_RE = /PGRST101|permission denied/i;

/**
 * Verifies every table in `tables` exists with its required columns.
 *
 * @param {object} opts
 * @param {object} opts.db - supabase client scoped to the forge schema
 * @param {Record<string,string[]>} [opts.tables] - { table: [required columns] }
 * @returns {Promise<{ok: boolean, results: Array<object>}>} per-table verdicts
 *   ({ table, ok, missing?, permission?, missingColumns?, errorMessage? }) —
 *   throws on any non-classifiable DB error (fail-loud, repo convention).
 */
export async function runVerification({ db, tables = FORGE_TABLES }) {
  if (Object.keys(tables).length === 0) {
    throw new Error('verifySchema: no tables configured');
  }

  const results = [];

  for (const [table, requiredColumns] of Object.entries(tables)) {
    // 1. Existence probe (same shape as /health/db's check).
    const { error: existsError } = await db.from(table).select('id').limit(1);

    if (existsError) {
      if (MISSING_TABLE_RE.test(existsError.message)) {
        results.push({ table, ok: false, missing: true, errorMessage: existsError.message });
        continue;
      }
      if (PERMISSION_RE.test(existsError.message)) {
        results.push({ table, ok: false, permission: true, errorMessage: existsError.message });
        continue;
      }
      // Table exists but has no id (migration applied with a different
      // shape) — report it as a column gap, not a hard failure.
      if (MISSING_COLUMN_RE.test(existsError.message)) {
        results.push({ table, ok: false, missingColumns: ['id'], errorMessage: existsError.message });
        continue;
      }
      throw new Error(`verifySchema: forge.${table} existence check failed: ${existsError.message}`);
    }

    // 2. Column presence. PGRST204 names ONE missing column per request, so
    //    drop the reported column and retry until the select succeeds — this
    //    surfaces ALL gaps in a single run instead of one per invocation.
    const missingColumns = [];
    let cols = requiredColumns.join(',');
    let colsError = null;
    for (;;) {
      const { error } = await db.from(table).select(cols).limit(1);
      if (!error) break;
      if (PERMISSION_RE.test(error.message)) {
        colsError = error;
        break;
      }
      const missing = MISSING_COLUMN_RE.exec(error.message)?.[1];
      if (!missing) {
        colsError = error;
        break;
      }
      missingColumns.push(missing);
      cols = cols
        .split(',')
        .filter((c) => c !== missing)
        .join(',');
    }

    if (colsError) {
      if (PERMISSION_RE.test(colsError.message)) {
        results.push({ table, ok: false, permission: true, errorMessage: colsError.message });
        continue;
      }
      throw new Error(`verifySchema: forge.${table} column check failed: ${colsError.message}`);
    }
    if (missingColumns.length > 0) {
      results.push({ table, ok: false, missingColumns, errorMessage: `missing: ${missingColumns.join(', ')}` });
      continue;
    }

    results.push({ table, ok: true, checked: requiredColumns.length, expected: requiredColumns.length });
  }

  return { ok: results.every((r) => r.ok), results };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in api/.env');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'forge' }, // same forge-scoped client as the API (migration 008 / S-2)
  });

  console.log('🔍 Verifying Forge Supabase schema (forge.* — migration 008, S-2)...\n');

  const { ok, results } = await runVerification({ db });

  for (const r of results) {
    if (r.ok) {
      console.log(`✅ forge.${r.table} — ${r.checked}/${r.expected} required columns present`);
    } else if (r.permission) {
      console.error(
        `❌ forge.${r.table} — PERMISSION DENIED (${r.errorMessage}). If the table exists, grants are missing: GRANT USAGE,SELECT,INSERT,UPDATE,DELETE ON forge.* TO anon, authenticated, service_role`
      );
    } else if (r.missingColumns?.length) {
      console.error(`❌ forge.${r.table} — missing column(s): ${r.missingColumns.join(', ')} (${r.errorMessage})`);
    } else {
      console.error(`❌ forge.${r.table} — MISSING (${r.errorMessage})`);
    }
  }

  const tableCount = results.length;
  const issueCount = results.filter((r) => !r.ok).length;
  const allMissing = issueCount === tableCount;

  console.log('\n--- Schema Verification Result ---');
  if (ok) {
    console.log(`🎉 All ${tableCount} forge.* tables exist with all required columns — schema is ready!`);
    process.exit(0);
  }
  console.error(`⚠️  ${issueCount} of ${tableCount} forge.* tables have issues.`);
  if (allMissing) {
    console.error('   → forge schema absent: apply supabase/migrations/008_forge_schema.sql via Supabase MCP (S-2), then re-run.');
  } else {
    console.error('   → missing tables: re-apply 008 (it is idempotent) · permission: add grants · missing columns: check the migration version.');
  }
  process.exit(1);
}

// CLI entry — runs only when executed directly (importable for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error during schema verification:', err);
    process.exit(1);
  });
}
