'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, MessagesSquare, Bot, ShieldCheck, Settings, Cpu, LayoutTemplate, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

/**
 * Global sidebar (plan §6.1) — Forge Sidebar slimmed to 6 items. Org
 * connections live inside Settings and the org pill, not a top-level page.
 * Copilot is the primary destination for work; the 10-stage operator
 * workspace (PRD FR-5, ported from Forge) lives at /workspace.
 */
export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { label: 'Copilot', href: '/chat', icon: MessagesSquare },
    { label: 'Templates', href: '/templates', icon: LayoutTemplate },
    { label: 'Agents', href: '/agents', icon: Bot },
    { label: 'Changes & Audit', href: '/changes', icon: ShieldCheck },
    { label: 'Workspace', href: '/workspace', icon: Cpu },
    { label: 'Settings', href: '/settings', icon: Settings },
  ];

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden',
          'transition-[opacity,visibility] duration-200 ease-out',
          'motion-reduce:transition-none',
          isOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        )}
      />

      <aside
        id="mobile-nav"
        aria-label="Primary navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-brand-border p-4 flex flex-col justify-between shrink-0',
          'transform transition-[transform,visibility] duration-300 ease-out motion-reduce:transition-none',
          isOpen ? 'translate-x-0 visible' : '-translate-x-full invisible',
          // Header is 65px + any safe-area inset (notched standalone mode);
          // the drawer offsets match so it never slips under the header.
          'md:translate-x-0 md:visible md:sticky md:top-[calc(65px+env(safe-area-inset-top))] md:h-[calc(100dvh-65px-env(safe-area-inset-top))]'
        )}
      >
        <div className="space-y-6">
          <div className="px-3 flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-slate-400">
              NAVIGATION
            </span>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close navigation menu"
                className="md:hidden p-2 -mr-2 rounded-lg text-slate-500 hover:text-brand-dark hover:bg-brand-surface transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={isOpen ? onClose : undefined}
                  className={cn(
                    'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200',
                    isActive
                      ? 'bg-brand-blue-light text-brand-blue font-semibold border border-brand-blue/20 shadow-sm'
                      : 'text-slate-600 hover:bg-brand-surface hover:text-brand-dark'
                  )}
                >
                  <Icon className={cn('w-4 h-4', isActive ? 'text-brand-blue' : 'text-slate-400')} />
                  <span>{item.label}</span>
                  {item.label === 'Copilot' && (
                    <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-brand-blue bg-brand-blue-light border border-brand-blue/20 rounded-full px-1.5 py-0.5">
                      Chat
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="px-3 pt-4 border-t border-brand-border">
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-slate-400">
            FORGE v1
          </p>
        </div>
      </aside>
    </>
  );
}
