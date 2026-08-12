'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';

export interface OrgSummary {
  id: string;
  name: string;
  orgType: 'production' | 'sandbox' | 'scratch';
  instanceUrl?: string;
}

interface ActiveOrgContextValue {
  org: OrgSummary | null;
  orgs: OrgSummary[];
  setOrgs: (orgs: OrgSummary[]) => void;
  selectOrg: (org: OrgSummary | null) => void;
}

const STORAGE_KEY = 'forge.activeOrg';

const ActiveOrgContext = createContext<ActiveOrgContextValue | null>(null);

/**
 * Global active-org context (plan §6.1) — the single "active org" shared by
 * both engines, persisted in localStorage so the Salesforce OAuth redirect
 * round-trip keeps it. Switching orgs clears in-flight chat context with a
 * confirm (EC-25) — handled by callers via the org pill.
 */
export function ActiveOrgProvider({ children }: { children: React.ReactNode }) {
  const [orgs, setOrgsState] = useState<OrgSummary[]>([]);
  // Hydrate the persisted selection lazily (SSR-safe; the shell is client-only
  // behind AuthGate anyway).
  const [org, setOrg] = useState<OrgSummary | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as OrgSummary) : null;
    } catch {
      return null; // corrupted storage — ignore
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
    <ActiveOrgContext.Provider value={{ org, orgs, setOrgs, selectOrg }}>
      {children}
    </ActiveOrgContext.Provider>
  );
}

export function useActiveOrg(): ActiveOrgContextValue {
  const ctx = useContext(ActiveOrgContext);
  if (!ctx) throw new Error('useActiveOrg must be used within ActiveOrgProvider');
  return ctx;
}
