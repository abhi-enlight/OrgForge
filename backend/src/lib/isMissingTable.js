/**
 * Distinguishes a "table missing" error (migration 008 not applied yet) from
 * a real database failure, so writes can degrade gracefully during the S-2
 * rollout and fail loudly afterwards.
 *
 * Matches the shapes the unified stack actually sees:
 *   - supabase-js / PostgREST: "Could not find the table 'forge.x' in schema
 *     cache", PGRST106 "Invalid schema: orgforge"
 *   - raw pg: 'relation "forge.routing_log" does not exist'
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isMissingTableError(err) {
  const msg = err?.message || (typeof err === 'string' ? err : '');
  return /could not find the table|does not exist|PGRST106|invalid schema/i.test(msg);
}

/**
 * Narrower classifier: the whole `forge` schema is absent (PGRST106 /
 * "Invalid schema: orgforge") — i.e. migration 008 has not been applied yet.
 * Used by GET /api/v1/health/db to report the S-2 migration as pending.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isMissingSchemaError(err) {
  const msg = err?.message || (typeof err === 'string' ? err : '');
  return /PGRST106|invalid schema/i.test(msg);
}
