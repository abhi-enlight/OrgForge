/**
 * Server-side diagnostics cache (plan §12.4.7, EC-21).
 *
 * Replaces Agentforge's localStorage 24h cache with a server-side store:
 *   - Result persisted to `orgforge.diagnostics` (user_id, org_id, state,
 *     detail, checked_at) — table created by migration 008 (S-2).
 *   - 24h TTL, refreshed on read when stale.
 *   - In-memory promise dedup per (user, org): concurrent requests share ONE
 *     pre-flight run (same pattern as the frontend's activeCheckPromise).
 *   - `forceRecheck` bypasses the cache (POST /recheck).
 *   - Table-missing is non-fatal: we run the check and serve it uncached, so
 *     the API degrades gracefully before migration 008 is applied.
 *
 * The db client MUST be scoped to the `orgforge` schema (supabase-js option
 * `db: { schema: 'orgforge' }`).
 */
export const DIAGNOSTICS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Missing-table errors (migration 008 not applied) degrade gracefully. */
function isMissingTableError(err) {
  const msg = err?.message || (typeof err === 'string' ? err : '');
  return /could not find the table|does not exist|PGRST106|invalid schema/i.test(msg);
}

const inFlight = new Map();

function cacheKey(userId, orgId) {
  return `${userId}|${orgId}`;
}

/**
 * EC-14 package half (auto re-check): a diagnostics RUN whose verdict detects
 * the unified ECA package as NOT installed must never be pinned for 24h — a
 * package-missing state is actionable and time-sensitive (the user will
 * install the package), so the cache is left EMPTY and every subsequent read
 * re-runs the pre-flight until the package is present (Agentforge's
 * invalidateAndRecheck behavior: the banner self-heals after install; no
 * manual Re-check needed). The run result is still returned to the caller so
 * the banner shows attention immediately.
 *
 * Note: checkPackageInstalled returns false on a transient tooling error too,
 * so an uncertain package check also re-checks next read — re-checking is the
 * right response to uncertainty.
 */
function isPackageMissing(result) {
  return result?.checks?.package?.installed === false;
}

/** Deletes any cached row — used when a run detects a package-missing verdict. */
async function clearCached(db, userId, orgId) {
  const { error } = await db
    .from('diagnostics')
    .delete()
    .eq('user_id', userId)
    .eq('org_id', orgId);
  if (error) {
    if (isMissingTableError(error)) return; // pre-migration: nothing to clear
    throw new Error(`Diagnostics cache clear failed: ${error.message}`);
  }
}

/**
 * @param {object} opts
 * @param {object} opts.db - supabase client scoped to the forge schema
 * @param {() => Promise<object>} opts.run - executes the pre-flight check
 * @param {string} opts.userId
 * @param {string} opts.orgId
 * @param {boolean} [opts.forceRecheck]
 * @returns {Promise<object>} diagnostics result
 */
export async function getDiagnostics({ db, run, userId, orgId, forceRecheck = false }) {
  const key = cacheKey(userId, orgId);

  // 1. In-memory dedup: one run at a time per (user, org). The in-flight slot
  //    MUST be reserved synchronously (before any await) so two concurrent
  //    calls can't both pass the has() check and start separate runs.
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = (async () => {
    // 2. Cache hit (fresh, not forced).
    if (!forceRecheck) {
      const cached = await readCached(db, userId, orgId);
      if (cached) return cached;
    }

    // 3. Run once, then persist. S-2 semantics: a missing table (migration
    //    008 not applied) degrades to an uncached run; ANY other cache error
    //    fails loudly — a real DB bug must surface, not be swallowed.
    const result = await run();
    if (isPackageMissing(result)) {
      // EC-14 (package half): never pin a package-missing verdict. Clear any
      // stale row so the next read re-runs the pre-flight (the banner
      // self-heals after install, no manual Re-check); the result is still
      // returned so the banner shows attention immediately. clearCached
      // swallows missing-table errors internally (pre-migration no-op).
      await clearCached(db, userId, orgId);
      return result;
    }
    try {
      await writeCached(db, userId, orgId, result);
    } catch (err) {
      if (isMissingTableError(err)) {
        console.warn('[diagnostics] cache write skipped (migration 008 not applied?):', err.message);
      } else {
        throw err;
      }
    }
    return result;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

async function readCached(db, userId, orgId) {
  try {
    const { data, error } = await db
      .from('diagnostics')
      .select('state, detail, checked_at')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) {
      // Missing table (pre-migration) → run uncached; any other error fails
      // loudly (same S-2 semantics as the write path).
      if (isMissingTableError(error)) return null;
      throw new Error(`Diagnostics cache read failed: ${error.message}`);
    }
    if (!data || !data.checked_at) return null;

    // EC-14: a cached package-missing verdict (e.g. written before the
    // never-pin rule shipped) is treated as stale — re-check rather than
    // serve a wrong 24h verdict.
    if (isPackageMissing(data.detail)) return null;

    const age = Date.now() - new Date(data.checked_at).getTime();
    if (age > DIAGNOSTICS_TTL_MS) return null;

    return { ...(data.detail || {}), cached: true, cachedAt: data.checked_at };
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

async function writeCached(db, userId, orgId, result) {
  const { error } = await db.from('diagnostics').upsert(
    {
      user_id: userId,
      org_id: orgId,
      state: result.state,
      detail: result,
      checked_at: new Date().toISOString(),
    },
    { onConflict: 'user_id, org_id' }
  );
  // Wrap in a real Error (supabase-js returns raw error objects) so callers
  // and the express error handler get a proper message/stack.
  if (error) throw new Error(`Diagnostics cache write failed: ${error.message}`);
}

/**
 * Invalidates the server-side diagnostics cache for one (user, org) — the
 * `invalidateAndRecheck` half of EC-14.
 *
 * Called when auth breaks (token refresh 401/403): a revoked/expired access
 * token makes the cached result wrong, so the stale row is deleted and the
 * next `getDiagnostics` read re-runs the pre-flight instead of serving a
 * 24h-old "ok" for the rest of the day. Also drops the in-memory dedup slot
 * for the key: a run started BEFORE the invalidation was computed under the
 * old (broken) token, so a subsequent read must not join it.
 *
 * S-2 semantics (same as the read/write paths): a missing table (migration
 * 008 not applied) degrades to a warn + no-op; ANY other DB error fails
 * loudly so a real bug surfaces.
 *
 * @param {object} opts
 * @param {object} opts.db - supabase client scoped to the forge schema
 * @param {string} opts.userId
 * @param {string} opts.orgId
 * @returns {Promise<{ok: boolean, degraded?: boolean}>}
 */
export async function invalidateDiagnostics({ db, userId, orgId }) {
  try {
    const { error } = await db
      .from('diagnostics')
      .delete()
      .eq('user_id', userId)
      .eq('org_id', orgId);

    if (error) {
      if (isMissingTableError(error)) {
        console.warn('[diagnostics] cache invalidation skipped (migration 008 not applied?):', error.message);
        return { ok: true, degraded: true };
      }
      throw new Error(`Diagnostics cache invalidation failed: ${error.message}`);
    }

    // Drop the in-flight dedup slot: the next read starts a FRESH run rather
    // than joining one launched under the stale token.
    inFlight.delete(cacheKey(userId, orgId));
    return { ok: true };
  } catch (err) {
    if (isMissingTableError(err)) {
      console.warn('[diagnostics] cache invalidation skipped (migration 008 not applied?):', err.message);
      return { ok: true, degraded: true };
    }
    throw err;
  }
}

/** Test hook: clears the in-flight dedup map. */
export function _clearDiagnosticsDedup() {
  inFlight.clear();
}
