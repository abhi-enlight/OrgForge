'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS_BUCKETS, bucketForStatus, type ChangeRecordLite, type StatusBucket } from './types';

/**
 * Change-status distribution — a donut over the same 4 buckets the Changes &
 * Audit page uses (deployed / pending / refused / other), drawn as hand-rolled
 * SVG. The center shows the total and the legend carries every count + percent
 * as visible text, so the chart never relies on color or hover alone.
 */
export default function StatusDonut({
  records,
  loading = false,
  className,
}: {
  records: ChangeRecordLite[] | null;
  loading?: boolean;
  className?: string;
}) {
  const counts = useMemo(() => {
    const c = { deployed: 0, pending: 0, refused: 0, other: 0 };
    for (const r of records ?? []) c[bucketForStatus(r.status)] += 1;
    return c;
  }, [records]);

  const total = records?.length ?? 0;

  // Donut geometry.
  const SIZE = 200;
  const R = 70;
  const STROKE = 24;
  const C = 2 * Math.PI * R;
  // 2% of the circle per gap so segments never touch (butt caps).
  const GAP = 0.02;

  // Pure reduce — accumulates the stroke offset without mutating a variable
  // during render (react-hooks/immutability).
  const { segments } = STATUS_BUCKETS.reduce<{
    segments: { key: StatusBucket; label: string; textClass: string; dotClass: string; frac: number; len: number; offset: number }[];
    cursor: number;
  }>(
    (acc, b) => {
      const frac = total > 0 ? counts[b.key] / total : 0;
      const len = Math.max(frac - GAP, 0) * C;
      acc.segments.push({ ...b, frac, len, offset: acc.cursor * C });
      acc.cursor += frac;
      return acc;
    },
    { segments: [], cursor: 0 }
  );

  return (
    <section
      className={cn('rounded-2xl border border-brand-border bg-white shadow-soft overflow-hidden', className)}
      aria-label="Change records by status"
    >
      <div className="px-5 pt-4 pb-3 border-b border-brand-border flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            Change status
          </p>
          <h2 className="mt-1 font-semibold text-brand-dark">Records by status</h2>
        </div>
        <Link href="/changes" className="text-xs font-semibold text-brand-blue hover:underline">
          View all
        </Link>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="flex flex-col items-center gap-4">
            <div className="skeleton-strong h-44 w-44 rounded-full" aria-hidden="true" />
            <div className="skeleton-strong h-3.5 w-3/4 rounded" aria-hidden="true" />
          </div>
        ) : (
          <>
            <div className="relative h-44 w-44 mx-auto">
              <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-full" role="img" aria-label={`${total} change records by status`}>
                <title>Change records by status</title>
                {/* Track */}
                <circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  strokeWidth={STROKE}
                  className="stroke-brand-border"
                />
                {/* Segments (drawn from 12 o'clock, clockwise) */}
                {total > 0 &&
                  segments.map((s) =>
                    s.len > 0 ? (
                      <circle
                        key={s.key}
                        cx={SIZE / 2}
                        cy={SIZE / 2}
                        r={R}
                        fill="none"
                        strokeWidth={STROKE}
                        stroke="currentColor"
                        strokeDasharray={`${s.len} ${C - s.len}`}
                        strokeDashoffset={-s.offset}
                        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                        className={s.textClass}
                      />
                    ) : null
                  )}
              </svg>
              {/* Center total — HTML overlay keeps it crisp at any size */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="font-mono text-3xl font-bold text-brand-dark tabular-nums leading-none">
                  {total}
                </span>
                <span className="mt-1 text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-slate-400">
                  total
                </span>
              </div>
            </div>

            {/* Legend — every value is visible text (never color-only) */}
            <ul className="mt-5 space-y-2">
              {segments.map((s) => (
                <li key={s.key} className="flex items-center gap-2.5 text-sm">
                  <span className={cn('h-2 w-2 rounded-full shrink-0', s.dotClass)} aria-hidden="true" />
                  <span className="text-slate-600 flex-1 min-w-0 truncate">{s.label}</span>
                  <span className="font-mono font-semibold text-brand-dark tabular-nums">{counts[s.key]}</span>
                  <span className="font-mono text-xs text-slate-400 tabular-nums w-10 text-right">
                    {total > 0 ? `${Math.round((counts[s.key] / total) * 100)}%` : '–'}
                  </span>
                </li>
              ))}
            </ul>

            {total === 0 && (
              <p className="mt-4 text-center text-sm text-slate-400">
                No records yet.{' '}
                <Link
                  href="/chat?prompt=Add%20a%20validation%20rule%20to%20Opportunity"
                  className="text-brand-blue font-medium hover:underline"
                >
                  Request a governed change
                </Link>
              </p>
            )}
          </>
        )}
      </div>

      <div className="px-5 py-3 border-t border-brand-border flex items-center justify-between">
        <span className="text-xs text-slate-400">One shared status language with Changes &amp; Audit</span>
        <Link href="/changes" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue hover:underline">
          Audit trail <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </section>
  );
}
