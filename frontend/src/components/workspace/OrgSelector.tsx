'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Database, ChevronDown, LogOut, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface Org {
  id: string;
  alias: string;
  type: string;
  instanceUrl: string;
}

interface OrgSelectorProps {
  orgId: string;
  orgs: Org[];
  onSelectOrg?: (id: string) => void;
}

export default function OrgSelector({ orgId, orgs, onSelectOrg }: OrgSelectorProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeOrg = orgs.find((o) => o.id === orgId) || orgs[0];

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  const handleSelectOrg = (id: string) => {
    setIsOpen(false);
    onSelectOrg?.(id);
    router.push(`/workspace?orgId=${encodeURIComponent(id)}`);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <div ref={rootRef} className="relative inline-block text-left w-full sm:w-auto">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="p-3 bg-white rounded-xl border border-brand-border flex items-center justify-between gap-4 shadow-soft hover:border-slate-300 transition-colors w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center text-brand-blue shrink-0">
            <Database className="w-4 h-4" />
          </div>
          <div className="text-left min-w-0">
            <span className="block text-xs font-bold text-brand-dark truncate">
              {activeOrg?.alias || 'No Org'}
            </span>
            <span className="block text-[10px] font-mono text-slate-600">
              {activeOrg ? activeOrg.type.toUpperCase() : 'CONNECT ONE TO BEGIN'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
            CONNECTED
          </span>
          <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform duration-200', isOpen && 'rotate-180')} />
        </div>
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute right-0 mt-2 w-72 rounded-xl bg-white border border-brand-border shadow-lift py-1 z-50 animate-scale-in origin-top-right"
        >
          <div className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            Connected Environments
          </div>

          {orgs.map((org) => {
            const isActive = org.id === activeOrg?.id;
            return (
              <button
                key={org.id}
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelectOrg(org.id)}
                className="w-full px-3 py-2 text-left flex items-center justify-between text-xs hover:bg-brand-surface transition-colors focus:outline-none focus-visible:bg-brand-surface cursor-pointer"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Database className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate font-medium text-slate-800">{org.alias}</span>
                </span>
                {isActive && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
              </button>
            );
          })}

          <div className="border-t border-slate-100 my-1" />

          <button
            onClick={handleSignOut}
            className="w-full px-3 py-2 text-left text-red-600 hover:bg-red-50 flex items-center gap-2 text-xs font-medium transition-colors focus:outline-none focus-visible:bg-red-50 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
