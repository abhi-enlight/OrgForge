import React from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'pass' | 'refused' | 'warning' | 'info' | 'muted';
  size?: 'sm' | 'md';
  isMono?: boolean;
  dot?: boolean;
  className?: string;
}

export default function Badge({
  children,
  variant = 'info',
  size = 'md',
  isMono = false,
  dot = true,
  className,
}: BadgeProps) {
  const variants = {
    pass: 'bg-gradient-to-r from-emerald-500/10 to-teal-500/5 text-emerald-800 border-emerald-300/80 shadow-sm',
    refused: 'bg-gradient-to-r from-rose-500/10 to-red-500/5 text-rose-800 border-rose-300/80 shadow-sm',
    warning: 'bg-gradient-to-r from-amber-500/10 to-orange-500/5 text-amber-900 border-amber-300/80 shadow-sm',
    info: 'bg-gradient-to-r from-blue-500/10 to-indigo-500/5 text-brand-blue border-blue-300/80 shadow-sm',
    muted: 'bg-slate-100 text-slate-600 border-slate-200',
  };

  const dotColors = {
    pass: 'bg-emerald-500',
    refused: 'bg-rose-500',
    warning: 'bg-amber-500',
    info: 'bg-brand-blue',
    muted: 'bg-slate-400',
  };

  const sizes = {
    sm: 'px-2.5 py-0.5 text-[10px]',
    md: 'px-3 py-1 text-xs',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-semibold rounded-full border border-solid backdrop-blur-sm',
        variants[variant],
        sizes[size],
        isMono && 'font-mono uppercase tracking-[0.14em]',
        className
      )}
    >
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColors[variant])} />
      )}
      <span>{children}</span>
    </span>
  );
}
