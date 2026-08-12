'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
 * Cause-aware copy for "agents unavailable" states. capability.agents is
 * 'attention' for ANY blocker — naming the actual one (connector package vs
 * Agentforce/Einstein settings vs license) keeps every surface honest, with a
 * neutral pointer to Settings as the fallback. Shared by the dashboard's
 * Agents tile and the Agents page readiness row.
 */
export function agentsUnavailableHint(diag: ReadinessDiag | null): string {
  const c = diag?.checks;
  if (c?.package?.installed === false) return 'Connector package missing — install it to build agents';
  if (c?.settings?.agentforceEnabled === false) return 'Enable Agentforce Agent and Einstein in Setup → Agentforce';
  if (c?.license?.supported === false) return 'Einstein Agent license needed — see Settings';
  return 'Agent building needs setup — see Settings';
}

interface OrgReadinessContextValue {
  diag: ReadinessDiag | null;
  status: 'idle' | 'loading' | 'done';
  error: string | null;
  /** The org the current diag/error belongs to — consumers render only when
   *  this matches the active org id (no cross-org flash). */
  orgId: string | null;
  /** Re-run the check for the active org — refreshes EVERY consumer at once. */
  retry: () => void;
  /** Org-attributed: whether the ACTIVE org's agents capability is attention
   *  (a blocker exists — package, settings, license, provisioning). */
  agentsUnavailable: boolean;
  /** Org-attributed: whether the check for the ACTIVE org failed — retryable. */
  checkFailed: boolean;
}

const OrgReadinessContext = createContext<OrgReadinessContextValue | null>(null);

/**
 * Shared org-readiness provider — the single source of truth for what the
 * active org can actually run, consumed by the once-per-session sign-in
 * banner, the chat page's capability chip, and the dashboard's Agents tile.
 *
 * Because the fetch + state live here (one provider mounted in the `(app)`
 * layout), all consumers share ONE instance: one auto-check per org per
 * session, and one `retry()` that refreshes every surface at once — no more
 * per-page fetch duplication or per-instance retry divergence.
 *
 * - Fetches GET /api/v1/diagnostics once per org. The server caches results
 *   for 24h, so repeat sessions are cheap — and a Settings → Run diagnostics
 *   re-check invalidates that cache, so a retry here picks up the corrected
 *   state.
 * - StrictMode-safe: the once-per-org mark is applied when the deferred fetch
 *   actually fires, so a cancelled dev double-mount (setup → cleanup →
 *   setup) can never starve the fetch.
 * - FAILED fetches unmark the org, so `retry()` can re-run without waiting
 *   for anything. A check is never duplicated for the SAME org; a newer
 *   org's check supersedes an in-flight one (per-org in-flight guard).
 */
export function OrgReadinessProvider({ children }: { children: React.ReactNode }) {
  const { org } = useActiveOrg();
  const [diag, setDiag] = useState<ReadinessDiag | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
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

  // Derived flags — ONE source of truth for every consumer (chat chip,
  // dashboard tile, agents page row). Org-attributed here so a stale result
  // for a previous org can never render anywhere, and the consumers never
  // re-implement the gates and drift.
  const agentsUnavailable = orgId === org?.id && diag?.capability?.agents === 'attention';
  const checkFailed = orgId === org?.id && error != null;

  // Stable context value — consumers re-render only when actual state changes.
  const value = useMemo(
    () => ({ diag, status, error, orgId, retry, agentsUnavailable, checkFailed }),
    [diag, status, error, orgId, retry, agentsUnavailable, checkFailed]
  );

  return (
    <OrgReadinessContext.Provider value={value}>{children}</OrgReadinessContext.Provider>
  );
}

/**
 * Read the shared org readiness. MUST be used within OrgReadinessProvider
 * (mounted once in the `(app)` layout) — all callers therefore see the SAME
 * fetch result, and calling `retry()` refreshes every consumer at once.
 */
export function useOrgReadiness(): OrgReadinessContextValue {
  const ctx = useContext(OrgReadinessContext);
  if (!ctx) throw new Error('useOrgReadiness must be used within OrgReadinessProvider');
  return ctx;
}
