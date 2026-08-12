import React from 'react';
import type { Metadata } from 'next';
import AppShell from '@/components/layout/AppShell';
import AuthGate from '@/components/auth/AuthGate';
import { ActiveOrgProvider } from '@/lib/org-context';

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
      <AuthGate>
        <AppShell>{children}</AppShell>
      </AuthGate>
    </ActiveOrgProvider>
  );
}
