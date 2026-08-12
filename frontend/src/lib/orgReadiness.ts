'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useActiveOrg } from '@/lib/org-context';

/**
 * Diagnostics preflight result — GET /api/v1/diagnostics?orgId=... (the same
 * shape Settings → Advanced renders). The preflight also self-heals: when the
 * license + package are present it provisions the Einstein Agent User and
 * assigns permission sets automatically.
 */
export interface ReadinessDiag {
  state: 'ok' | 'attention' | 'error';
  capability?: {
    agents?: 'ok' | 'attention';
    org_change?: 'ok' | 'attention';
  };
  checks?: {
    package?: { installed?: boolean; reason?: string };
    license?: { supported?: boolean; reason?: string };
    settings?: { agentforceEnabled?: boolean | null; reason?: string };
    provisioning?: { ok?: boolean; reason?: string };
  };
  checkedAt?: string;
}

/**
 * Shared org-readiness hook (preflight diagnostics) — the single source of
 * truth for what the active org can actually run. Consumed by the
 * once-per-session sign-in banner AND the chat page's capability chip so both
 * always agree on the same data.
 *
 * - Fetches GET /api/v1/diagnostics once per org per mounted instance. The
 *   server caches results for 24h, so repeat mounts are cheap — and a
 *   Settings → Run diagnostics re-check invalidates that cache, so a fresh
 *   chat mount picks up the corrected state.
 * - StrictMode-safe: the once-per-org mark is applied when the deferred fetch
 *   actually fires, so a cancelled dev double-mount (setup → cleanup →
 *   setup) can never starve the fetch.
 * - Responses are attributed to the org they were fetched for; consumers
 *   render only when `orgId` matches the active org (no cross-org flash).
 * - FAILED fetches unmark the org, so `retry()` can re-run within the same
 *   visit — no remount needed. An in-flight check is never duplicated.
 */
export function useOrgReadiness() {
  const { org } = useActiveOrg();
  const [diag, setDiag] = useState<ReadinessDiag | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  // The org the current diag/error belongs to.
  const [orgId, setOrgId] = useState<string | null>(null);
  // The org whose fetch is currently marked as done/running. Cleared on
  // failure so a retry can re-run without waiting for a remount.
  const fetchedFor = useRef<string | null>(null);
  // Prevents the auto-check and a manual retry from racing the same org.
  const inFlight = useRef(false);

  const runCheck = useCallback(async (targetOrgId: string) => {
    if (inFlight.current) return; // a check is already running — skip
    inFlight.current = true;
    setStatus('loading');
    setError(null);
    try {
      const result = await apiFetch<ReadinessDiag>(
        `/api/v1/diagnostics?orgId=${encodeURIComponent(targetOrgId)}`
      );
      if (fetchedFor.current !== targetOrgId) return; // superseded by a newer org
      setDiag(result);
      setOrgId(targetOrgId);
      setStatus('done');
    } catch (err) {
      if (fetchedFor.current !== targetOrgId) return; // superseded by a newer org
      // Unmark this org so retry() can re-run it in-place. The failure is
      // still attributed to the org (orgId set) so consumers can offer retry.
      if (fetchedFor.current === targetOrgId) fetchedFor.current = null;
      setDiag(null);
      setOrgId(targetOrgId);
      setError(err instanceof Error ? err.message : 'Readiness check failed');
      setStatus('done');
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!org) {
      // Deferred so no setState runs synchronously inside the effect body
      // (react-hooks/set-state-in-effect — same pattern as the workspace).
      const timer = setTimeout(() => {
        setStatus('idle');
        setDiag(null);
        setOrgId(null);
      }, 0);
      return () => clearTimeout(timer);
    }
    if (fetchedFor.current === org.id) return; // already fetched this org

    const timer = setTimeout(() => {
      // Mark when the fetch actually fires (not in the effect body) so a
      // StrictMode setup/cleanup/setup cycle re-arms instead of starving.
      fetchedFor.current = org.id;
      runCheck(org.id);
    }, 0);
    return () => clearTimeout(timer);
  }, [org, runCheck]);

  /** Re-run the check for the active org — event-handler context (no
   *  effect-deferral needed). No-op while a check is in flight. */
  const retry = useCallback(() => {
    if (!org || inFlight.current) return;
    fetchedFor.current = org.id;
    runCheck(org.id);
  }, [org, runCheck]);

  return { diag, status, error, orgId, retry };
}
