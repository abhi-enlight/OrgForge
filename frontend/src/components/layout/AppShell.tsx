'use client';

import React, { useEffect, useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import NameCaptureModal from '@/components/auth/NameCaptureModal';
import OrgReadinessBanner from '@/components/org/OrgReadinessBanner';

/**
 * Client-side application shell for the authenticated area (plan §6.1).
 * Owns the mobile navigation drawer state: the Header's hamburger opens it,
 * the Sidebar renders as a slide-over drawer on small screens and a static
 * sticky sidebar from `md` up.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [isNavOpen, setIsNavOpen] = useState(false);

  useEffect(() => {
    if (!isNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsNavOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isNavOpen]);

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header onOpenMobileNav={() => setIsNavOpen(true)} isMobileNavOpen={isNavOpen} />
      <div className="flex flex-1">
        <Sidebar isOpen={isNavOpen} onClose={() => setIsNavOpen(false)} />
        <main className="flex-1 bg-brand-surface/40 p-6 md:p-8 min-w-0">
          {/* One-time-per-session org readiness check (scenario-3 preflight) —
              surfaces actionable setup items (package, Agentforce+Einstein
              settings, license) right after sign-in. Dismissible per session. */}
          <OrgReadinessBanner />
          {children}
        </main>
      </div>
      {/* One-time name capture for pre-name accounts — shows once, saves to metadata. */}
      <NameCaptureModal />
    </div>
  );
}
