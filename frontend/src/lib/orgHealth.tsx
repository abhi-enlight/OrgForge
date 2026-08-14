'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import { useActiveOrg } from './org-context';

export type PackageHealthStatus = 'installed' | 'missing' | 'error' | 'checking' | 'idle';

export interface PackageHealth {
  orgId: string;
  orgType?: string;
  status: 'installed' | 'missing' | 'error';
  ecaPresent?: boolean;
  installUrl?: string;
  copyLink?: string;
  packageId?: string;
  packageVersionId?: string;
  checkedAt?: string;
  reason?: string;
}

export interface OrgPackageHealthState {
  status: PackageHealthStatus;
  health: PackageHealth | null;
  showModal: boolean;
  forceRecheck: () => void;
  dismissModal: () => void;
  reopenModal: () => void;
}

/**
 * Session-scoped "dismissed" set per org — the install popup shows at most
 * once per org per browser session. Reloads (same tab) preserve it via
 * sessionStorage; new tabs/sessions get a fresh chance to see the popup.
 */
const DISMISS_KEY = 'orgforge:pkg-health-dismissed';

function getDismissed(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '{}');
  } catch {
    return {};
  }
}

function setDismissed(orgId: string, dismissed: boolean) {
  if (typeof window === 'undefined') return;
  const map = getDismissed();
  if (dismissed) map[orgId] = true;
  else delete map[orgId];
  try {
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    /* private mode — ignore */
  }
}

/**
 * Core package-install health state machine for ONE org id. Used both by the
 * shared OrgPackageHealthProvider (active org — chat page) and the standalone
 * useOrgPackageHealthFor (workspace's selected org, which may differ from the
 * active one).
 *
 * - Auto-checks when `orgId` becomes non-empty (the backend caches the result
 *   for 10 min, so this is cheap on repeat visits).
 * - `forceRecheck()` bypasses the cache — used by the "I've installed it"
 *   action in the modal.
 * - `dismissModal()` marks the org dismissed for this session; the hook stops
 *   auto-opening afterwards while `status` still reflects reality (the UI
 *   keeps the persistent status chip either way).
 */
function usePackageHealthState(orgId: string | null): OrgPackageHealthState {
  const [status, setStatus] = useState<PackageHealthStatus>('idle');
  const [health, setHealth] = useState<PackageHealth | null>(null);
  // Tracks WHICH org the current dismissal belongs to — without this, dismissing
  // org A would wrongly suppress the popup for a later-selected org B.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);
  // Monotonic counter — the request that STARTED last owns the result.
  const checkSeq = useRef(0);

  const check = useCallback(async (id: string, force = false) => {
    if (inFlight.current === id && !force) return; // dedupe concurrent checks
    inFlight.current = id;
    // Monotonic request sequence: whichever request STARTED last owns the
    // result. Guards against BOTH a stale response from a previously-selected
    // org AND a same-org overlap (e.g. a force re-check racing the auto-check)
    // where the earlier request's completion must not clobber the newer one.
    const requestId = ++checkSeq.current;
    try {
      const data = await apiFetch<PackageHealth>(
        `/api/v1/orgs/${encodeURIComponent(id)}/package-health${force ? '?force=1' : ''}`
      );
      if (checkSeq.current !== requestId) return; // superseded — drop stale result
      // Runtime guard: only accept a known status. A proxy/other route that
      // returns a 200 without `status` (or a future unknown status) must not
      // crash the header chip (CONFIG[status] would be undefined).
      if (
        typeof data.status === 'string' &&
        ['installed', 'missing', 'error'].includes(data.status)
      ) {
        setHealth(data);
        setStatus(data.status);
        // A fresh "installed" result clears any earlier dismissal so the chip
        // reflects the good state; the popup simply won't re-open for 'installed'.
        if (data.status === 'installed') setDismissed(id, false);
      } else {
        setHealth(null);
        setStatus('error');
      }
    } catch {
      if (checkSeq.current !== requestId) return;
      setStatus('error');
      setHealth(null);
    } finally {
      // Only release the dedupe marker when no newer request has taken over.
      if (checkSeq.current === requestId) inFlight.current = null;
    }
  }, []);

  // Auto-check when the selected org changes. Deferred with a timeout so no
  // setState runs synchronously inside the effect body (react-hooks rule —
  // same pattern as the workspace's redirect-notice effect).
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      // Per-org dismissal: only suppress the popup when the CURRENT org was
      // the one dismissed. Re-derive from sessionStorage on every org switch.
      const wasDismissed = Boolean(getDismissed()[orgId]);
      setDismissedFor(wasDismissed ? orgId : null);
      setStatus('checking');
      check(orgId);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orgId, check]);

  const forceRecheck = useCallback(() => {
    if (!orgId) return;
    setDismissed(orgId, false);
    setDismissedFor(null);
    // Event-handler context — safe to set 'checking' synchronously here.
    setStatus('checking');
    check(orgId, true);
  }, [orgId, check]);

  const dismissModal = useCallback(() => {
    if (!orgId) return;
    setDismissed(orgId, true);
    setDismissedFor(orgId);
  }, [orgId]);

  // Re-open the popup on demand (chip click) even after a session dismissal.
  // Only meaningful while the status is still 'missing'.
  const reopenModal = useCallback(() => {
    if (!orgId) return;
    setDismissed(orgId, false);
    setDismissedFor(null);
  }, [orgId]);

  // Whether the popup should be showing right now: missing + the CURRENT org
  // is not the one that was dismissed this session.
  const showModal =
    orgId != null && status === 'missing' && dismissedFor !== orgId;

  return { status, health, showModal, forceRecheck, dismissModal, reopenModal };
}

/**
 * Shared package-install health for the ACTIVE org — the provider lives in
 * the `(app)` layout (next to OrgReadinessProvider) so every consumer shares
 * ONE check per org per page session instead of re-fetching on every page
 * mount. The chat page's access gate consumes this via `useOrgPackageHealth()`
 * — navigating to chat no longer re-runs the org check or flashes the
 * "Checking org setup…" gate.
 *
 * Server-side the result is Redis-cached for 10 min, so a fresh page load is
 * cheap; `forceRecheck()` bypasses that cache for "I've installed it" flows.
 */
export function OrgPackageHealthProvider({ children }: { children: React.ReactNode }) {
  const { org } = useActiveOrg();
  const state = usePackageHealthState(org?.id ?? null);

  return <OrgPackageHealthContext.Provider value={state}>{children}</OrgPackageHealthContext.Provider>;
}

const OrgPackageHealthContext = createContext<OrgPackageHealthState | null>(null);

/**
 * Read the shared package-install health for the ACTIVE org. MUST be used
 * within OrgPackageHealthProvider (mounted in the `(app)` layout) — all
 * callers therefore see the SAME check result, and `forceRecheck()` refreshes
 * every consumer at once.
 */
export function useOrgPackageHealth(): OrgPackageHealthState {
  const ctx = useContext(OrgPackageHealthContext);
  if (!ctx) throw new Error('useOrgPackageHealth must be used within OrgPackageHealthProvider');
  return ctx;
}

/**
 * Standalone package-install health for an ARBITRARY org id — for surfaces
 * that track an org other than the active one (the legacy workspace's own
 * org selector). Prefer the shared `useOrgPackageHealth()` (provider) when
 * the org in question IS the active org.
 */
export function useOrgPackageHealthFor(orgId: string | null): OrgPackageHealthState {
  return usePackageHealthState(orgId);
}
