'use client';

import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { XCircle, AlertTriangle, CheckCircle2, Info, X, ChevronDown, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE_OUT } from '@/lib/motion';

export interface ErrorBannerDetail {
  title: string;
  message: string;
  meta?: string;
}

interface ErrorBannerProps {
  variant?: 'error' | 'warning' | 'success' | 'info';
  title: string;
  message?: string;
  /** Structured failure rows (e.g. MDAPI component failures) shown in an expandable list. */
  details?: ErrorBannerDetail[];
  /** Raw failure strings shown in a <pre>-style block when no structured details are given. */
  rawDetails?: string[];
  onRetry?: () => void;
  onDismiss?: () => void;
  retryLabel?: string;
  className?: string;
  /** Small inline variant — no shadow, tighter padding. */
  compact?: boolean;
}

const STYLES = {
  error: {
    container: 'bg-rose-50/90 border-rose-300 text-rose-900 shadow-refused',
    iconWrap: 'bg-rose-100 border-rose-200 text-rose-600',
    icon: <XCircle className="w-5 h-5" />,
    title: 'text-rose-900',
    detailBox: 'bg-white/80 border-rose-200',
  },
  warning: {
    container: 'bg-amber-50/90 border-amber-300 text-amber-900 shadow-soft',
    iconWrap: 'bg-amber-100 border-amber-200 text-amber-600',
    icon: <AlertTriangle className="w-5 h-5" />,
    title: 'text-amber-900',
    detailBox: 'bg-white/80 border-amber-200',
  },
  success: {
    container: 'bg-emerald-50/90 border-emerald-300 text-emerald-900 shadow-pass',
    iconWrap: 'bg-emerald-100 border-emerald-200 text-emerald-600',
    icon: <CheckCircle2 className="w-5 h-5" />,
    title: 'text-emerald-900',
    detailBox: 'bg-white/80 border-emerald-200',
  },
  info: {
    container: 'bg-blue-50/90 border-blue-300 text-slate-800 shadow-soft',
    iconWrap: 'bg-blue-100 border-blue-200 text-brand-blue',
    icon: <Info className="w-5 h-5" />,
    title: 'text-brand-dark',
    detailBox: 'bg-white/80 border-blue-200',
  },
} as const;

export default function ErrorBanner({
  variant = 'error',
  title,
  message,
  details,
  rawDetails,
  onRetry,
  onDismiss,
  retryLabel = 'Try Again',
  className,
  compact = false,
}: ErrorBannerProps) {
  const reduceMotion = useReducedMotion();
  const [isExpanded, setIsExpanded] = useState(false);

  const style = STYLES[variant];
  const hasDetails =
    (Array.isArray(details) && details.length > 0) ||
    (Array.isArray(rawDetails) && rawDetails.length > 0);

  return (
    <motion.div
      role="alert"
      initial={reduceMotion ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className={cn(
        'rounded-xl border p-4 space-y-3',
        style.container,
        !compact && 'shadow-sm',
        compact && 'p-3',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'shrink-0 rounded-lg border flex items-center justify-center',
            style.iconWrap,
            compact ? 'w-7 h-7' : 'w-8 h-8'
          )}
        >
          {style.icon}
        </span>

        <div className="flex-1 min-w-0 space-y-1">
          <p className={cn('font-bold leading-tight', compact ? 'text-xs' : 'text-sm', style.title)}>
            {title}
          </p>
          {message && (
            <p className={cn('text-slate-600 leading-relaxed', compact ? 'text-[11px]' : 'text-xs')}>
              {message}
            </p>
          )}
        </div>

        {(onDismiss || onRetry || hasDetails) && (
          <div className="flex items-center gap-1 shrink-0">
            {onRetry && (
              <button
                onClick={onRetry}
                className={cn(
                  'inline-flex items-center gap-1.5 font-semibold rounded-lg border transition-colors cursor-pointer',
                  compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs',
                  variant === 'error'
                    ? 'bg-white text-rose-700 border-rose-300 hover:bg-rose-100'
                    : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-100'
                )}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {retryLabel}
              </button>
            )}
            {onDismiss && (
              <button
                onClick={onDismiss}
                aria-label="Dismiss"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/70 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {hasDetails && (
        <div className="pl-11">
          <button
            onClick={() => setIsExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
            aria-expanded={isExpanded}
          >
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', isExpanded && 'rotate-180')} />
            {isExpanded ? 'Hide details' : `View details (${details?.length ?? rawDetails?.length ?? 0})`}
          </button>

          {isExpanded && (
            <motion.div
              initial={reduceMotion ? false : { gridTemplateRows: '0fr', opacity: 0 }}
              animate={{ gridTemplateRows: '1fr', opacity: 1 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="grid"
            >
              <div className="min-h-0 overflow-hidden">
                <div className={cn('mt-2 rounded-lg border space-y-2 max-h-64 overflow-y-auto p-2', style.detailBox)}>
                  {Array.isArray(details) &&
                    details.map((d, i) => (
                      <div key={i} className="p-2 rounded-md bg-white border border-slate-200 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono font-bold text-brand-dark break-all">
                            {d.title}
                          </span>
                          {d.meta && (
                            <span className="text-[10px] font-mono text-slate-500 shrink-0">{d.meta}</span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed break-words">{d.message}</p>
                      </div>
                    ))}
                  {Array.isArray(rawDetails) &&
                    rawDetails.map((line, i) => (
                      <pre
                        key={i}
                        className="text-[11px] font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-2 whitespace-pre-wrap break-words leading-relaxed"
                      >
                        {line}
                      </pre>
                    ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </motion.div>
  );
}
