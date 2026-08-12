import React from 'react';
import type { Metadata } from 'next';
import AppShell from '@/components/layout/AppShell';
import AuthGate from '@/components/auth/AuthGate';
import { ActiveOrgProvider } from '@/lib/org-context';
import { OrgReadinessProvider } from '@/lib/orgReadiness';

// Auth-gated area: keep these routes out of search indexes.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ActiveOrgProvider>
      {/* Shared org readiness — one fetch + one retry for the banner, chat
          chip, and dashboard tile. Inside ActiveOrgProvider (it consumes the
          active org), outside AuthGate (no session needed to render children). */}
      <OrgReadinessProvider>
        <AuthGate>
          <AppShell>{children}</AppShell>
        </AuthGate>
      </OrgReadinessProvider>
    </ActiveOrgProvider>
  );
}
