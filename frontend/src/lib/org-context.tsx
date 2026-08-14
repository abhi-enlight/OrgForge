'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from './api';
import { supabase } from './supabase';

export interface OrgSummary {
  id: string;
  name: string;
  orgType: 'production' | 'sandbox' | 'scratch';
  instanceUrl?: string;
}

/** Raw shape of an org row from GET /api/v1/orgs. */
export interface OrgRow {
  id: string;
  alias?: string;
  type?: string;
  instanceUrl?: string;
}

/** Maps a raw API row to the client OrgSummary (unknown type → production). */
export function mapOrgRow(o: OrgRow): OrgSummary {
  return {
    id: o.id,
    name: o.alias || o.id,
    orgType: (['production', 'sandbox', 'scratch'].includes(o.type || '')
      ? o.type
      : 'production') as OrgSummary['orgType'],
    instanceUrl: o.instanceUrl,
  };
}

interface ActiveOrgContextValue {
  org: OrgSummary | null;
  orgs: OrgSummary[];
  setOrgs: (orgs: OrgSummary[]) => void;
  selectOrg: (org: OrgSummary | null) => void;
  /** Force-fetch the org list, update shared state + the session cache. */
  refreshOrgs: () => Promise<OrgSummary[]>;
}

const STORAGE_KEY = 'forge.activeOrg';
// Session-scoped org-list cache — survives full page loads (refresh) in the
// same tab so the app does NOT re-fetch /api/v1/orgs on every load. Dies with
// the tab (a new tab fetches fresh). Tagged with the signing-in user's id so
// a different account in the same tab can never restore another user's list.
const ORG_LIST_CACHE_KEY = 'forge.orgs.list';

interface OrgListCache {
  userId: string | null;
  fetchedAt: number;
  orgs: OrgSummary[];
}

function readOrgListCache(): OrgListCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ORG_LIST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrgListCache;
    return parsed && Array.isArray(parsed.orgs) ? parsed : null;
  } catch {
    return null; // corrupted storage — ignore, fetch fresh
  }
}

function writeOrgListCache(cache: OrgListCache) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ORG_LIST_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable */
  }
}

const ActiveOrgContext = createContext<ActiveOrgContextValue | null>(null);

/**
 * Global active-org context (plan §6.1) — the single "active org" shared by
 * both engines, persisted in localStorage so the Salesforce OAuth redirect
 * round-trip keeps it. Switching orgs clears in-flight chat context with a
 * confirm (EC-25) — handled by callers via the org pill.
 *
 * Owns the /api/v1/orgs fetch too: the list is hydrated from a session-scoped
 * cache on mount and fetched at most once per tab session, so a full page
 * load (refresh) in the same tab restores the org list WITHOUT re-fetching —
 * the Header's per-load fetch is gone. Mutations (Settings connect/disconnect)
 * go through `setOrgs`/`refreshOrgs`, which keep the cache in sync.
 */
export function ActiveOrgProvider({ children }: { children: React.ReactNode }) {
  // Hydrate the org list from the session cache (when present) synchronously
  // so a refresh restores the pill + empty states on first paint. The mount
  // effect below validates ownership and only fetches when the cache is
  // missing or belongs to a different user.
  const [initialCache] = useState<OrgListCache | null>(() => readOrgListCache());
  const [orgs, setOrgsState] = useState<OrgSummary[]>(initialCache?.orgs ?? []);
  // Hydrate the persisted selection lazily (SSR-safe; the shell is client-only
  // behind AuthGate anyway); fall back to the first cached org so a cache hit
  // without an explicit selection still shows a pill.
  const [org, setOrg] = useState<OrgSummary | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as OrgSummary) : null;
      return stored ?? initialCache?.orgs?.[0] ?? null;
    } catch {
      return initialCache?.orgs?.[0] ?? null; // corrupted storage — ignore
    }
  });

  // Stable identities (setters only) so context consumers can safely list
  // them in hook deps without refetch loops.
  const setOrgs = useCallback((next: OrgSummary[]) => {
    setOrgsState(next);
    setOrg((current) => {
      if (current) return current; // keep explicit selection
      return next[0] ?? null; // default to the first org
    });
  }, []);

  // Force-fetch the org list, update shared state, and refresh the session
  // cache. Used by Settings (connection management needs fresh data after
  // connect/disconnect) and by the provider's own mount check.
  const refreshOrgs = useCallback(async (): Promise<OrgSummary[]> => {
    const { orgs: fetched } = await apiFetch<{ orgs: OrgRow[] }>('/api/v1/orgs');
    const mapped = (fetched || []).map(mapOrgRow);
    setOrgs(mapped);
    // Tag the cache with the current user id so a different account signing
    // into the same tab can never reuse another user's org list.
    const { data } = await supabase.auth.getSession();
    writeOrgListCache({
      userId: data.session?.user?.id ?? null,
      fetchedAt: Date.now(),
      orgs: mapped,
    });
    return mapped;
  }, [setOrgs]);

  // One org-list check per tab session: restore the session cache when it
  // belongs to the current user AND has orgs, otherwise fetch fresh. Deferred
  // so no setState runs synchronously inside the effect body (react-hooks
  // rule). An EMPTY cached list is never trusted: it may predate the user's
  // first connect — the Salesforce OAuth round-trip does not invalidate the
  // cache (and sessionStorage survives refreshes), so trusting it would pin
  // the dashboard on the "Connect Salesforce" empty state forever, even after
  // a successful reconnect in the same tab. A same-user cache with orgs is
  // still trusted to keep the mount fetch at one per tab session.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        const userId = data.session?.user?.id ?? null;
        if (initialCache && initialCache.userId === userId && initialCache.orgs.length > 0) {
          return; // cache is ours and non-empty — no fetch
        }
        await refreshOrgs();
      } catch {
        /* unauthenticated or backend down — the no-org empty states handle it */
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [initialCache, refreshOrgs]);

  const selectOrg = useCallback((next: OrgSummary | null) => {
    setOrg(next);
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  return (
    <ActiveOrgContext.Provider value={{ org, orgs, setOrgs, selectOrg, refreshOrgs }}>
      {children}
    </ActiveOrgContext.Provider>
  );
}

export function useActiveOrg(): ActiveOrgContextValue {
  const ctx = useContext(ActiveOrgContext);
  if (!ctx) throw new Error('useActiveOrg must be used within ActiveOrgProvider');
  return ctx;
}
