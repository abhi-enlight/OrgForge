'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';

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
 * Tracks the package-install health of the selected org.
 *
 * - Auto-checks when `orgId` becomes non-empty (the backend caches the result
 *   for 10 min, so this is cheap on repeat visits).
 * - `forceRecheck()` bypasses the cache — used by the "I've installed it"
 *   action in the modal.
 * - `dismissModal()` marks the org dismissed for this session; the hook stops
 *   auto-opening afterwards while `status` still reflects reality (the UI
 *   keeps the persistent status chip either way).
 */
export function useOrgPackageHealth(orgId: string | null) {
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
