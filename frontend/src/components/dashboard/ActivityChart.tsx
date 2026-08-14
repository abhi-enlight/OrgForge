'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChangeRecordLite } from './types';

const DAYS = 14;

/** One day bucket on the activity axis. */
interface DayBucket {
  label: string;
  fullLabel: string;
  count: number;
  isToday: boolean;
}

/** Buckets change records into the last 14 local days (today included). */
function buildBuckets(records: ChangeRecordLite[] | null): DayBucket[] {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const days: DayBucket[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(todayStart);
    d.setDate(todayStart.getDate() - i);
    days.push({
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      fullLabel: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      count: 0,
      isToday: i === 0,
    });
  }
  for (const r of records ?? []) {
    if (!r.createdAt) continue;
    const t = new Date(r.createdAt).getTime();
    if (Number.isNaN(t)) continue;
    const diffDays = Math.floor((todayStart.getTime() - t) / 86_400_000);
    // Skip future timestamps and anything older than the window.
    if (diffDays >= 0 && diffDays < DAYS) days[DAYS - 1 - diffDays].count += 1;
  }
  return days;
}

/**
 * Change activity — the last 14 days of governed changes as a hand-rolled SVG
 * bar chart (no chart dependency; the panel owns its data-viz). Hovering a
 * bucket shows a guide line, a value tag, and a highlighted day label; the
 * total is always visible as text in the header so the chart never relies on
 * color or hover alone (chart a11y rule).
 */
export default function ActivityChart({
  records,
  loading = false,
  className,
}: {
  records: ChangeRecordLite[] | null;
  loading?: boolean;
  className?: string;
}) {
  const days = useMemo(() => buildBuckets(records), [records]);
  const [hover, setHover] = useState<number | null>(null);

  const total = days.reduce((sum, d) => sum + d.count, 0);
  const max = Math.max(4, ...days.map((d) => d.count));

  // SVG geometry (fixed viewBox — scales cleanly, text included).
  const W = 720;
  const H = 240;
  const PAD_L = 34;
  const PAD_R = 14;
  const PAD_T = 16;
  const PAD_B = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const baseline = PAD_T + plotH;
  const step = plotW / DAYS;
  const barW = Math.min(step * 0.56, 30);
  const yFor = (n: number) => PAD_T + plotH - (n / max) * plotH;

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const xFrac = (e.clientX - rect.left) / rect.width;
    const plotLeft = PAD_L / W;
    const plotRight = 1 - PAD_R / W;
    const inPlot = Math.min(Math.max((xFrac - plotLeft) / (plotRight - plotLeft), 0), 1);
    setHover(Math.min(Math.floor(inPlot * DAYS), DAYS - 1));
  };

  return (
    <section
      className={cn(
        'rounded-2xl border border-brand-border bg-white shadow-soft overflow-hidden',
        className
      )}
      aria-label="Change activity over the last 14 days"
    >
      <div className="px-5 pt-4 pb-3 border-b border-brand-border flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            Governance activity
          </p>
          <h2 className="mt-1 font-semibold text-brand-dark">Change activity</h2>
        </div>
        <div className="flex items-center gap-2">
          {!loading && (
            <span className="rounded-full border border-brand-border bg-brand-surface px-2.5 py-1 text-[11px] font-medium text-slate-500">
              <span className="font-mono font-semibold text-brand-dark tabular-nums">{total}</span>{' '}
              {total === 1 ? 'change' : 'changes'} · 14 days
            </span>
          )}
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="skeleton-strong h-[210px] rounded-xl" aria-hidden="true" />
        ) : (
          <div onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)} className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-auto block"
              role="img"
              aria-label={`Governed changes per day, last 14 days. Total ${total} changes.`}
            >
              <title>Governed changes per day, last 14 days</title>

              {/* Y gridlines + labels */}
              {[0, 0.5, 1].map((f) => {
                const y = yFor(f * max);
                const value = Math.round(f * max);
                return (
                  <g key={f}>
                    <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} className="stroke-brand-border" strokeWidth={1} />
                    <text
                      x={PAD_L - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      className="fill-slate-400 font-mono text-[10px] tabular-nums"
                    >
                      {value}
                    </text>
                  </g>
                );
              })}

              {/* Hover guide */}
              {hover !== null && (
                <g>
                  <line
                    x1={PAD_L + (hover + 0.5) * step}
                    x2={PAD_L + (hover + 0.5) * step}
                    y1={PAD_T}
                    y2={baseline}
                    className="stroke-brand-blue/30"
                    strokeWidth={1.5}
                  />
                </g>
              )}

              {/* Bars */}
              {days.map((d, i) => {
                const x = PAD_L + i * step + (step - barW) / 2;
                const barTop = yFor(d.count);
                const h = Math.max(baseline - barTop, d.count > 0 ? 3 : 2);
                const isHovered = hover === i;
                return (
                  <g key={i}>
                    {d.count > 0 ? (
                      <rect
                        x={x}
                        y={barTop}
                        width={barW}
                        height={h}
                        rx={3}
                        className={cn(
                          'transition-opacity duration-150',
                          d.isToday ? 'fill-brand-blue' : 'fill-brand-blue/70',
                          isHovered ? 'opacity-100' : hover !== null ? 'opacity-40' : 'opacity-100'
                        )}
                      />
                    ) : (
                      <rect
                        x={x}
                        y={baseline - 2}
                        width={barW}
                        height={2}
                        rx={1}
                        className={cn(
                          'fill-brand-border',
                          isHovered ? 'fill-brand-blue/40' : hover !== null ? 'opacity-40' : 'opacity-100'
                        )}
                      />
                    )}
                  </g>
                );
              })}

              {/* Hover value tag */}
              {hover !== null && (
                <g>
                  {(() => {
                    const d = days[hover];
                    const barTop = yFor(d.count);
                    const cx = PAD_L + (hover + 0.5) * step;
                    const tagH = 20;
                    const tagW = 34;
                    const tagY = barTop - tagH - 10 < PAD_T ? barTop + 8 : barTop - tagH - 10;
                    return (
                      <g>
                        <rect
                          x={cx - tagW / 2}
                          y={tagY}
                          width={tagW}
                          height={tagH}
                          rx={6}
                          className="fill-slate-800"
                        />
                        <text
                          x={cx}
                          y={tagY + 14}
                          textAnchor="middle"
                          className="fill-white font-mono text-[11px] font-bold tabular-nums"
                        >
                          {d.count}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              )}

              {/* Day labels */}
              {days.map((d, i) => (
                <text
                  key={i}
                  x={PAD_L + (i + 0.5) * step}
                  y={H - 10}
                  textAnchor="middle"
                  className={cn(
                    'font-mono text-[10px]',
                    hover === i ? 'fill-brand-blue font-bold' : 'fill-slate-400'
                  )}
                >
                  {d.label}
                </text>
              ))}
            </svg>

            {/* Empty-state note — the axes stay so the panel holds its place */}
            {total === 0 && (
              <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-slate-400">
                No governed changes in the last 14 days.{' '}
                <Link
                  href="/chat?prompt=Add%20a%20validation%20rule%20to%20Opportunity"
                  className="text-brand-blue font-medium hover:underline"
                >
                  Request the first one
                </Link>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-brand-border flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {hover !== null
            ? `${days[hover].fullLabel}: ${days[hover].count} change${days[hover].count === 1 ? '' : 's'}`
            : 'Hover a day for the exact count'}
        </span>
        <Link href="/changes" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue hover:underline">
          View audit trail <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </section>
  );
}
