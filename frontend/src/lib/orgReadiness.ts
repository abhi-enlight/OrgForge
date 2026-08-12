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
 *   visit — no remount needed. A check is never duplicated for the SAME org;
 *   a newer org's check supersedes an in-flight one (per-org in-flight guard).
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
  // Per-org in-flight guard: a check is never duplicated for the SAME org
  // (auto vs manual retry racing), but a DIFFERENT org's check supersedes an
  // in-flight one — switching orgs mid-fetch must still auto-check the new org.
  const inFlightOrg = useRef<string | null>(null);

  const runCheck = useCallback(async (targetOrgId: string) => {
    if (inFlightOrg.current === targetOrgId) return; // same org already running
    inFlightOrg.current = targetOrgId;
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
      fetchedFor.current = null;
      setDiag(null);
      setOrgId(targetOrgId);
      setError(err instanceof Error ? err.message : 'Readiness check failed');
      setStatus('done');
    } finally {
      // Only release the guard when this check still owns it — a newer org's
      // check may have taken over.
      if (inFlightOrg.current === targetOrgId) inFlightOrg.current = null;
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
   *  effect-deferral needed). No-op while the same org is in flight. */
  const retry = useCallback(() => {
    if (!org || inFlightOrg.current === org.id) return;
    fetchedFor.current = org.id;
    runCheck(org.id);
  }, [org, runCheck]);

  return { diag, status, error, orgId, retry };
}
