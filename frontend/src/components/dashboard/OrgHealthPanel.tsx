'use client';

import { AlertTriangle, CheckCircle2, Minus, RefreshCw, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { ReadinessDiag } from '@/lib/orgReadiness';

interface CheckRow {
  key: string;
  label: string;
  /** true = passing, false = needs setup, undefined = not evaluated yet. */
  ok: boolean | undefined;
  reason?: string;
}

/** Compact relative label for the "checked {n} ago" footer. */
function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Org health — the four preflight checks (connector package, Agentforce
 * settings, Einstein license, agent-user provisioning) as a compact
 * bullet-style panel: a segmented progress bar up top and one row per check,
 * all values as visible text (chart a11y rule: never color-only). The same
 * diagnostics drive the chat capability chip and the sign-in banner, so this
 * panel is honest by construction — it can only show what the org preflight
 * actually reported.
 */
export default function OrgHealthPanel({
  diag,
  status,
  orgName,
  onRetry,
  className,
}: {
  diag: ReadinessDiag | null;
  status: 'idle' | 'loading' | 'done';
  orgName?: string;
  onRetry: () => void;
  className?: string;
}) {
  const checks: CheckRow[] = [
    { key: 'package', label: 'Connector package', ok: diag?.checks?.package?.installed, reason: diag?.checks?.package?.reason },
    { key: 'settings', label: 'Agentforce settings', ok: diag?.checks?.settings?.agentforceEnabled ?? undefined, reason: diag?.checks?.settings?.reason },
    { key: 'license', label: 'Einstein license', ok: diag?.checks?.license?.supported, reason: diag?.checks?.license?.reason },
    { key: 'provisioning', label: 'Agent user provisioning', ok: diag?.checks?.provisioning?.ok, reason: diag?.checks?.provisioning?.reason },
  ];

  const evaluated = checks.filter((c) => c.ok !== undefined);
  const passed = evaluated.filter((c) => c.ok === true).length;

  return (
    <section
      className={cn('rounded-2xl border border-brand-border bg-white shadow-soft overflow-hidden', className)}
      aria-label="Org health checks"
    >
      <div className="px-5 pt-4 pb-3 border-b border-brand-border">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Org health
            </p>
            <h2 className="mt-1 font-semibold text-brand-dark">
              {orgName ? `${orgName} readiness` : 'Org readiness'}
            </h2>
          </div>
          {status === 'done' && (
            <div className="text-right shrink-0">
              <p className="font-mono text-sm font-bold text-brand-dark tabular-nums">
                {passed}
                <span className="text-slate-400 font-medium"> / {evaluated.length || 4}</span>
              </p>
              <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-slate-400">
                passing
              </p>
            </div>
          )}
        </div>

        {/* Segmented progress — one segment per check, tinted by its state */}
        {status === 'done' && (
          <div className="mt-3 flex gap-1" role="img" aria-label={`${passed} of ${evaluated.length || 4} health checks passing`}>
            {checks.map((c) => (
              <span
                key={c.key}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors duration-300',
                  c.ok === true ? 'bg-brand-pass' : c.ok === false ? 'bg-brand-warning' : 'bg-brand-border'
                )}
              />
            ))}
          </div>
        )}
      </div>

      <div className="divide-y divide-brand-border">
        {status === 'loading' ? (
          <div className="p-5 space-y-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="skeleton-strong h-8 w-8 rounded-lg" aria-hidden="true" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton-strong h-3 w-1/2 rounded" aria-hidden="true" />
                  <div className="skeleton-strong h-2.5 w-1/3 rounded" aria-hidden="true" />
                </div>
              </div>
            ))}
          </div>
        ) : status === 'done' && diag ? (
          checks.map((c) => (
            <div key={c.key} className="px-5 py-3 flex items-start gap-3">
              {c.ok === true ? (
                <CheckCircle2 className="w-4 h-4 text-brand-pass mt-0.5 shrink-0" />
              ) : c.ok === false ? (
                <AlertTriangle className="w-4 h-4 text-brand-warning mt-0.5 shrink-0" />
              ) : (
                <Minus className="w-4 h-4 text-slate-300 mt-0.5 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-700">{c.label}</p>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      c.ok === true
                        ? 'bg-brand-pass/10 text-brand-pass'
                        : c.ok === false
                          ? 'bg-brand-warning/10 text-brand-warning'
                          : 'bg-brand-surface text-slate-400'
                    )}
                  >
                    {c.ok === true ? 'OK' : c.ok === false ? 'Needs setup' : 'Not checked'}
                  </span>
                </div>
                {c.ok === false && c.reason && (
                  <p className="mt-0.5 text-xs text-slate-400 leading-relaxed">{c.reason}</p>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="px-5 py-6 text-center">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-brand-surface mb-3">
              <ShieldCheck className="w-5 h-5 text-slate-400" />
            </span>
            <p className="text-sm text-slate-500">Health checks haven&apos;t run for this org yet.</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue hover:underline cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Run checks
            </button>
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-brand-border flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {diag?.checkedAt ? `Checked ${timeAgo(diag.checkedAt)}` : 'Preflight diagnostics'}
        </span>
        <Link href="/settings" className="text-xs font-semibold text-brand-blue hover:underline">
          Full diagnostics
        </Link>
      </div>
    </section>
  );
}
