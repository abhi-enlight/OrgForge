'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Plug, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Clear "Reconnect Salesforce" call-to-action for ORG_RECONNECT_REQUIRED
 * failures — the backend rejected the org's stored Salesforce refresh token,
 * so the org must be re-linked through OAuth. Crucially the user's app
 * session is STILL VALID (that's what the ORG_RECONNECT_REQUIRED discriminator
 * exists for), so the fix is one click on /login?step=2 — never a sign-out.
 *
 * Rendered wherever an ORG_RECONNECT_REQUIRED error can surface: the
 * dashboard, the sign-in readiness banner, and Settings → Advanced.
 *
 * @param {object} props
 * @param {string} [props.message] - failure detail (defaults to a generic line)
 * @param {() => void} [props.onRetry] - optional re-run action (e.g. re-run diagnostics)
 * @param {boolean} [props.compact] - smaller padding/text for inline placement
 * @param {string} [props.className]
 */
export default function ReconnectSalesforceNotice({
  message,
  onRetry,
  compact = false,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-2xl border border-brand-warning/30 bg-brand-warning-bg px-5 py-4 animate-slide-up',
        compact && 'rounded-xl px-4 py-3',
        className
      )}
    >
      <AlertTriangle className={cn('w-4 h-4 text-brand-warning shrink-0 mt-0.5', compact && 'w-3.5 h-3.5')} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm text-slate-700', compact && 'text-xs')}>
          <span className="font-semibold text-brand-dark">Salesforce access expired.</span>{' '}
          {message || 'Reconnect this org to restore chat, agents, and org changes.'}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-warning hover:bg-brand-warning/10 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        )}
      </div>
      <Link
        href="/login?step=2"
        className={cn(
          'shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-brand-blue text-white text-xs font-semibold px-3.5 py-2 shadow-glow hover:bg-brand-blue-hover transition-colors',
          compact && 'px-3 py-1.5 rounded-lg'
        )}
      >
        <Plug className="w-3.5 h-3.5" />
        Reconnect Salesforce
      </Link>
    </div>
  );
}
