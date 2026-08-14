'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Menu, ChevronDown, LogOut, User, Zap, Cloud, FlaskConical } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useActiveOrg, type OrgSummary } from '@/lib/org-context';
import { ForgeLogo } from '@/components/brand/ForgeLogo';
import { cn } from '@/lib/utils';

interface HeaderProps {
  onOpenMobileNav: () => void;
  isMobileNavOpen: boolean;
}

const ORG_TYPE_LABEL: Record<OrgSummary['orgType'], string> = {
  production: 'Production',
  sandbox: 'Sandbox',
  scratch: 'Scratch',
};

const ORG_TYPE_ICON = { production: Zap, sandbox: Cloud, scratch: FlaskConical };

/**
 * Top bar (plan §6.1): FORGE wordmark, live org pill (type-aware, global
 * switcher — switching orgs confirms first, EC-25), avatar menu with sign-out.
 * The org list comes from the shared ActiveOrgProvider (fetched once per tab
 * session, not on every page load) — this component only renders it.
 */
export default function Header({ onOpenMobileNav, isMobileNavOpen }: HeaderProps) {
  const router = useRouter();
  const { org, orgs, selectOrg } = useActiveOrg();
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const orgMenuRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  // Close menus on outside click.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) setOrgMenuOpen(false);
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const switchOrg = (next: OrgSummary) => {
    setOrgMenuOpen(false);
    // EC-25: switching orgs clears in-flight chat context — confirm first.
    if (org && org.id !== next.id && window.confirm(`Switch active org to ${next.name}?`)) {
      selectOrg(next);
    } else if (!org) {
      selectOrg(next);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const TypeIcon = org ? ORG_TYPE_ICON[org.orgType] : Zap;

  return (
    <header className="sticky top-0 z-30 min-h-[65px] pt-safe bg-white/90 backdrop-blur border-b border-brand-border flex items-center gap-2 sm:gap-3 px-4 md:px-6">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Toggle navigation menu"
        aria-expanded={isMobileNavOpen}
        className="md:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-brand-surface transition-colors cursor-pointer"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Logo → the app's main route; the wordmark hides below `sm` so the
          header (hamburger + logo + org pill + avatar) fits narrow phones.
          The tile mark carries the brand on its own. */}
      <ForgeLogo href="/dashboard" size="md" className="min-w-0" wordmarkClassName="hidden sm:inline" />

      <div className="flex-1 min-w-0" />

      {/* Org pill + switcher */}
      <div className="relative" ref={orgMenuRef}>
        <button
          type="button"
          onClick={() => setOrgMenuOpen((v) => !v)}
          className={cn(
            'flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-full border text-sm font-medium transition-[box-shadow,border-color,background-color,color] duration-200 cursor-pointer',
            // min-w-0 lets the pill shrink to the truncated org name on narrow
            // screens instead of forcing the header to overflow.
            'min-w-0',
            org
              ? 'bg-white border-brand-border hover:border-brand-blue/40 hover:shadow-soft text-slate-700'
              : 'bg-brand-blue-light border-brand-blue/20 text-brand-blue'
          )}
        >
          <TypeIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="max-w-[120px] sm:max-w-[180px] truncate">{org ? org.name : 'Connect an org'}</span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        </button>

        {orgMenuOpen && (
          <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white border border-brand-border shadow-lift p-1.5 z-50 animate-scale-in origin-top-right">
            <p className="px-3 pt-1.5 pb-1 text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-slate-400">
              Active org
            </p>
            {orgs.length === 0 ? (
              <div className="px-3 py-2.5 text-sm text-slate-500">
                No orgs connected yet.{' '}
                <Link href="/login?step=2" className="text-brand-blue font-medium hover:underline">
                  Connect Salesforce
                </Link>
              </div>
            ) : (
              orgs.map((o) => {
                const Icon = ORG_TYPE_ICON[o.orgType];
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => switchOrg(o)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors cursor-pointer',
                      org?.id === o.id
                        ? 'bg-brand-blue-light text-brand-blue font-semibold'
                        : 'text-slate-600 hover:bg-brand-surface'
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{o.name}</span>
                    <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      {ORG_TYPE_LABEL[o.orgType]}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Avatar menu */}
      <div className="relative" ref={avatarRef}>
        <button
          type="button"
          onClick={() => setAvatarOpen((v) => !v)}
          aria-label="Account menu"
          className="w-9 h-9 rounded-full bg-brand-dark text-white flex items-center justify-center text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer"
        >
          {(email || '?').slice(0, 1).toUpperCase()}
        </button>

        {avatarOpen && (
          <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-white border border-brand-border shadow-lift p-1.5 z-50 animate-scale-in origin-top-right">
            <div className="px-3 py-2 flex items-center gap-2.5 border-b border-brand-border mb-1">
              <span className="w-8 h-8 rounded-full bg-brand-blue-light text-brand-blue flex items-center justify-center text-xs font-bold">
                {(email || '?').slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-dark truncate">{email || 'Signed in'}</p>
                <p className="text-[11px] text-slate-400 flex items-center gap-1">
                  <User className="w-3 h-3" /> Forge
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-brand-refused-bg hover:text-brand-refused transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
