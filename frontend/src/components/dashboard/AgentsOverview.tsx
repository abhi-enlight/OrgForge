'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, Bot, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentStatusTone, type AgentLite } from './types';

const DOT_CLASSES = {
  ok: 'bg-brand-pass',
  warn: 'bg-brand-warning',
  muted: 'bg-slate-300',
} as const;

/**
 * Deployed agents — a read-only snapshot of the org's Agentforce agents
 * (same inventory route as the Agents page). One row per agent with a status
 * dot and the developer name in mono; the "Needs setup" state deep-links to
 * Settings, and the footer CTA opens chat to build the next agent.
 */
export default function AgentsOverview({
  agents,
  loading = false,
  agentsUnavailable = false,
  hint,
  className,
}: {
  agents: AgentLite[] | null;
  loading?: boolean;
  agentsUnavailable?: boolean;
  /** Cause-aware copy for the unavailable state (from the shared preflight). */
  hint?: string;
  className?: string;
}) {
  const list = agents ?? [];

  return (
    <section
      className={cn('rounded-2xl border border-brand-border bg-white shadow-soft overflow-hidden', className)}
      aria-label="Deployed agents"
    >
      <div className="px-5 pt-4 pb-3 border-b border-brand-border flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            Agents
          </p>
          <h2 className="mt-1 font-semibold text-brand-dark flex items-center gap-2">
            Deployed agents
            {!loading && agents !== null && (
              <span className="rounded-full bg-brand-blue-light px-2 py-0.5 font-mono text-[11px] font-bold text-brand-blue tabular-nums">
                {list.length}
              </span>
            )}
          </h2>
        </div>
        <Link href="/agents" className="text-xs font-semibold text-brand-blue hover:underline shrink-0">
          View all
        </Link>
      </div>

      <div className="divide-y divide-brand-border">
        {loading ? (
          <div className="p-5 space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="skeleton-strong h-8 w-8 rounded-lg" aria-hidden="true" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton-strong h-3 w-2/3 rounded" aria-hidden="true" />
                  <div className="skeleton-strong h-2.5 w-1/2 rounded" aria-hidden="true" />
                </div>
              </div>
            ))}
          </div>
        ) : agentsUnavailable ? (
          <div className="px-5 py-4 flex items-start gap-3">
            <span className="w-8 h-8 rounded-lg bg-brand-warning/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-brand-warning" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-700">Agent building needs setup</p>
              <p className="mt-0.5 text-xs text-slate-400 leading-relaxed">{hint}</p>
            </div>
            <Link href="/settings" className="shrink-0 text-xs font-semibold text-brand-warning hover:underline">
              Fix in Settings
            </Link>
          </div>
        ) : agents !== null && list.length > 0 ? (
          list.slice(0, 4).map((a, i) => {
            const tone = agentStatusTone(a.status);
            const name = a.name || a.developerName || 'Unnamed agent';
            return (
              <Link
                key={a.id || `${a.developerName}-${i}`}
                href="/agents"
                className="px-5 py-3 flex items-center gap-3 hover:bg-brand-surface/60 transition-colors group"
              >
                <span className="w-8 h-8 rounded-lg bg-brand-blue-light flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-brand-blue" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-dark truncate group-hover:text-brand-blue transition-colors">
                    {name}
                  </p>
                  {a.developerName && (
                    <p className="text-xs font-mono text-slate-400 truncate">{a.developerName}</p>
                  )}
                </div>
                <span className="inline-flex items-center gap-1.5 shrink-0">
                  <span className={cn('w-1.5 h-1.5 rounded-full', DOT_CLASSES[tone])} aria-hidden="true" />
                  <span className="text-xs text-slate-400 capitalize">{a.status || 'unknown'}</span>
                </span>
              </Link>
            );
          })
        ) : agents !== null ? (
          <div className="px-5 py-8 text-center">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-brand-surface mb-3">
              <Bot className="w-5 h-5 text-slate-400" />
            </span>
            <p className="text-sm text-slate-500">No agents deployed yet.</p>
            <p className="mt-1 text-xs text-slate-400">Ask Forge to build the first one from chat.</p>
          </div>
        ) : null}
      </div>

      {!loading && agentsUnavailable === false && agents !== null && list.length > 0 && (
        <div className="px-5 py-3 border-t border-brand-border">
          <Link
            href="/chat?prompt=Build%20a%20Customer%20Support%20Agent"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-blue hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Build another agent in chat
          </Link>
        </div>
      )}

      <div className="px-5 py-3 border-t border-brand-border flex items-center justify-between">
        <span className="text-xs text-slate-400">Read-only snapshot · edits happen in chat</span>
        <Link href="/agents" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue hover:underline">
          Agent library <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </section>
  );
}
