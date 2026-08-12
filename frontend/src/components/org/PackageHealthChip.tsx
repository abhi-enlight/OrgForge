'use client';

import React from 'react';
import { PackageOpen, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PackageHealthStatus } from '@/lib/orgHealth';

interface PackageHealthChipProps {
  status: PackageHealthStatus;
  onRecheck: () => void;
  onShowModal: () => void;
}

const CONFIG: Record<PackageHealthStatus, { label: string; cls: string; icon: React.ElementType; action?: 'recheck' | 'modal' }> = {
  installed: {
    label: 'Connector OK',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: ShieldCheck,
  },
  missing: {
    label: 'Connector Not Installed',
    cls: 'bg-amber-50 text-amber-700 border-amber-300',
    icon: PackageOpen,
    action: 'modal',
  },
  error: {
    label: 'Connector Status Unknown',
    cls: 'bg-red-50 text-red-600 border-red-200',
    icon: AlertTriangle,
    action: 'recheck',
  },
  checking: {
    label: 'Checking Connector…',
    cls: 'bg-slate-100 text-slate-500 border-slate-200',
    icon: Loader2,
  },
  idle: {
    label: 'Connector',
    cls: 'bg-slate-100 text-slate-500 border-slate-200',
    icon: ShieldCheck,
    action: 'recheck',
  },
};

/**
 * Persistent connector-status chip for the workspace header. Always visible
 * once an org is selected; the install popup is the transient signal, this
 * chip is the durable one (per the session-dismiss behavior).
 */
export default function PackageHealthChip({ status, onRecheck, onShowModal }: PackageHealthChipProps) {
  // Defensive: an unexpected status value must never crash the workspace
  // header — fall back to the idle presentation instead of reading an
  // undefined CONFIG entry.
  const cfg = CONFIG[status] ?? CONFIG.idle;
  const Icon = cfg.icon;

  const handleClick = () => {
    if (status === 'checking') return;
    if (cfg.action === 'modal') onShowModal();
    else if (cfg.action === 'recheck') onRecheck();
  };

  return (
    <button
      onClick={handleClick}
      title={status === 'checking' ? undefined : 'Click to re-check'}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-[background-color,border-color,color,box-shadow,transform]',
        cfg.cls,
        cfg.action && status !== 'checking' && 'hover:shadow-sm active:scale-95 cursor-pointer'
      )}
    >
      <Icon className={cn('w-3.5 h-3.5', status === 'checking' && 'animate-spin')} />
      {cfg.label}
    </button>
  );
}
