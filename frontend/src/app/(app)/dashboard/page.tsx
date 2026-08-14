'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bot, ShieldCheck, ScrollText, ArrowRight, Sparkles, RefreshCw, Database, PackageOpen, ExternalLink } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { apiFetch, ApiError, ORG_RECONNECT_REQUIRED } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import ReconnectSalesforceNotice from '@/components/org/ReconnectSalesforceNotice';
import { useActiveOrg } from '@/lib/org-context';
import { useOrgReadiness, agentsUnavailableHint } from '@/lib/orgReadiness';
import { ToastProvider, useToast } from '@/components/providers/ToastProvider';
import { cn } from '@/lib/utils';
import { EASE_REVEAL } from '@/lib/motion';
import ActivityChart from '@/components/dashboard/ActivityChart';
import StatusDonut from '@/components/dashboard/StatusDonut';
import OrgHealthPanel from '@/components/dashboard/OrgHealthPanel';
import AgentsOverview from '@/components/dashboard/AgentsOverview';

interface ChangeRecord {
  id?: string;
  title?: string;
  summary?: string;
  intent?: string;
  status?: string;
  createdAt?: string;
  kind?: string;
}

interface AgentSummary {
  id?: string;
  name?: string;
  developerName?: string;
  status?: string;
  description?: string;
}

/** Formats an ISO timestamp as a compact relative label. */
function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Greeting alternatives — the dashboard rotates through these so the header
 * isn't the same "Welcome back" every visit. Picked by day of year, so it
 * changes daily but is stable within a session (no flicker on re-render).
 */
const GREETINGS = [
  'Welcome back',
  'Good to see you',
  'Hello again',
];

function greetingForToday(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86_400_000);
  return GREETINGS[dayOfYear % GREETINGS.length];
}

/**
 * Dashboard (plan §6.2) — the calm home. One hero action (Ask Forge), three
 * clickable stat tiles, one attention banner (only when something is wrong),
 * and one unified activity feed. Empty states collapse the page to a single
 * CTA per the "not too much" rule (§6.0).
 */
export default function DashboardPage() {
  // Toast provider — same self-wrap convention as the workspace page, so a
  // refresh/retry gets a transient confirmation without the user having to
  // spot a spinner on the way out.
  return (
    <ToastProvider>
      <DashboardContent />
    </ToastProvider>
  );
}

function DashboardContent() {
  const router = useRouter();
  const { org } = useActiveOrg();
  const reduceMotion = useReducedMotion();
  const toast = useToast();
  // Org readiness (SHARED via the provider — chat chip + sign-in banner + the
  // Agents tile all read the same result): when the preflight says agents are
  // unavailable, the Agents tile flips to an amber "Needs setup" state and
  // deep-links to Settings instead of a chat run that would fail.
  const readiness = useOrgReadiness();
  const agentsUnavailable = readiness.agentsUnavailable;
  const [firstName, setFirstName] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [records, setRecords] = useState<ChangeRecord[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  // ORG_RECONNECT_REQUIRED from the agents fetch — the org's Salesforce
  // refresh token was rejected, so the fix is a Reconnect Salesforce CTA
  // (the app session itself is fine).
  const [agentsReconnect, setAgentsReconnect] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Either the shared readiness check OR the agents fetch reported
  // ORG_RECONNECT_REQUIRED → one clear Reconnect Salesforce row (never two).
  const needsReconnect = readiness.reconnectRequired || agentsReconnect;

  // The user's first name (from auth user_metadata set at signup or by the
  // one-time NameCaptureModal) personalizes the greeting. Re-reads on the
  // USER_UPDATED event so the name shows immediately after it's saved.
  useEffect(() => {
    const applyName = (fullName: unknown) => {
      const name = typeof fullName === 'string' ? fullName.trim() : '';
      setFirstName(name ? name.split(/\s+/)[0] : null);
    };
    (async () => {
      const { data } = await supabase.auth.getUser();
      applyName(data.user?.user_metadata?.full_name);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'USER_UPDATED') applyName(session?.user?.user_metadata?.full_name);
    });
    return () => subscription.unsubscribe();
  }, []);
  // One shared signal drives the shimmer on all three stat tiles — they
  // appear, animate, and resolve together so the reload reads as one motion.
  // `loading` covers the initial fetch, `refreshing` a manual recheck.
  const statsLoading = loading || refreshing;

  // Resolves to null when there was no org to load agents from; otherwise
  // reports whether the agents fetch succeeded (with count / error) plus the
  // org actually used, so the recheck handler can confirm the refresh with a
  // toast that names the org (the closure `org` may be stale mid-refresh).
  const load = async (): Promise<{ agentsOk: boolean; count: number; error?: string; orgName?: string } | null> => {
    // The org list lives in the shared ActiveOrgProvider (fetched once per
    // tab session) — `org` below is the active org from context, so the
    // agents tile loads without re-fetching /api/v1/orgs on every visit.
    // Agents (read-only count over the unified inventory route, §10.1).
    let agentsResult: { agentsOk: boolean; count: number; error?: string; orgName?: string } | null = null;
    if (org) {
      agentsResult = { agentsOk: false, count: 0, orgName: org.name };
      try {
        const { agents: a } = await apiFetch<{ agents: AgentSummary[] }>(
          `/api/v1/agents?orgId=${encodeURIComponent(org.id)}`
        );
        const list = Array.isArray(a) ? a : [];
        setAgents(list);
        setAgentsError(null);
        setAgentsReconnect(false);
        agentsResult = { agentsOk: true, count: list.length, orgName: org.name };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load agents';
        setAgents(null);
        setAgentsError(message);
        setAgentsReconnect(err instanceof ApiError && err.code === ORG_RECONNECT_REQUIRED);
        agentsResult = { agentsOk: false, count: 0, error: message };
      }
    } else {
      setAgents(null);
    }

    // Change records (governance trail; best-effort).
    try {
      const { records: r } = await apiFetch<{ records: ChangeRecord[] }>('/api/v1/change-records');
      setRecords(Array.isArray(r) ? r : []);
    } catch {
      setRecords(null);
    }
    setLoading(false);
    return agentsResult;
  };

  useEffect(() => {
    // Deferred so state settles after mount (react-hooks/set-state-in-effect).
    // Keyed on org?.id: on the first visit the shared provider may still be
    // fetching the org list, so this re-runs once the org arrives (and on
    // org switch) instead of relying on a mount-time closure.
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  const askForge = (prompt: string) => router.push(`/chat?prompt=${encodeURIComponent(prompt)}`);
  const recheck = async () => {
    setRefreshing(true);
    const result = await load();
    if (result) {
      // Transient confirmation — auto-dismisses, so a routine refresh stays
      // quiet on this "calm home" (§6.0) instead of a permanent UI box.
      if (result.agentsOk) {
        toast.success(
          'Agents refreshed',
          `${result.count} agent${result.count === 1 ? '' : 's'} in ${result.orgName || 'your org'}.`
        );
      } else {
        toast.error('Could not refresh agents', result.error ?? 'Check your connection and retry.');
      }
    } else {
      // No org after a manual recheck (empty state) — say so instead of
      // leaving the user guessing whether the reload did anything.
      toast.info('Still no org connected', 'Connect Salesforce to start loading your agents.');
    }
    setRefreshing(false);
  };

  // ── Empty state: no org → the whole dashboard collapses to one CTA (§12.2) ──
  if (!loading && !org) {
    return (
      <div className="max-w-3xl mx-auto pt-16 md:pt-24 flex flex-col items-center text-center animate-fade-in">
        <div className="w-14 h-14 rounded-2xl bg-brand-blue-light flex items-center justify-center mb-6 shadow-glow">
          <Database className="w-7 h-7 text-brand-blue" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-brand-dark tracking-tight">
          Connect Salesforce to get started
        </h1>
        <p className="mt-3 text-slate-500 max-w-md">
          Forge builds and deploys AI agents, and makes governed org changes. Connect your org.
          Everything else runs in the background.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            href="/login?step=2"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-blue text-white font-semibold shadow-glow hover:bg-brand-blue-hover transition-[background-color,transform] hover:scale-[1.02]"
          >
            Connect Salesforce <ArrowRight className="w-4 h-4" />
          </Link>
          <button
            type="button"
            onClick={recheck}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-brand-border bg-white text-slate-600 font-medium hover:bg-brand-surface transition-colors cursor-pointer disabled:opacity-70 disabled:cursor-wait"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} /> Recheck after connecting
          </button>
        </div>
      </div>
    );
  }

  const statTiles = [
    {
      label: 'Agents',
      value: agents ? agents.length : '–',
      loading: statsLoading,
      loadingHint: 'Fetching live agent count…',
      hint: agentsUnavailable
        ? agentsUnavailableHint(readiness.diag)
        : agents && agents.length > 0
          ? 'fetched live from your org'
          : 'deployed via Copilot',
      icon: Bot,
      // When the org's preflight says agents can't run, the tile points at
      // the fix (Settings → diagnostics) instead of a chat run that would
      // fail at runtime.
      action: agentsUnavailable
        ? () => router.push('/settings')
        : () => askForge('List my agents'),
      accent: 'from-brand-blue/10 to-transparent',
      accentBar: 'from-brand-blue to-brand-blue/0',
      iconColor: 'text-brand-blue',
      unavailable: agentsUnavailable,
    },
    {
      label: 'Open changes',
      value: records ? records.filter((r) => ['pending', 'awaiting_approval', 'draft'].includes(String(r.status || '').toLowerCase())).length : '–',
      loading: statsLoading,
      loadingHint: 'Fetching open changes…',
      hint: 'governed org changes',
      icon: ShieldCheck,
      action: () => askForge('What changes are pending?'),
      accent: 'from-brand-warning/10 to-transparent',
      accentBar: 'from-brand-warning to-brand-warning/0',
      iconColor: 'text-brand-warning',
      unavailable: false,
    },
    {
      label: 'Audit trail',
      value: records ? records.length : '–',
      loading: statsLoading,
      loadingHint: 'Fetching audit trail…',
      hint: records && records.length > 0 ? timeAgo(records[0]?.createdAt) : 'signed change records',
      icon: ScrollText,
      action: () => askForge('Show recent changes'),
      accent: 'from-brand-pass/10 to-transparent',
      accentBar: 'from-brand-pass to-brand-pass/0',
      iconColor: 'text-brand-pass',
      unavailable: false,
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in">
      {/* Hero row — one primary action (§6.0) */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-brand-dark tracking-tight">
            {greetingForToday()}
            {firstName ? `, ${firstName}` : org ? `, ${org.name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-1 text-slate-500">Build agents and make org changes from one place.</p>
        </div>
        <button
          type="button"
          onClick={() => askForge('')}
          className="group inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-brand-blue text-white font-semibold shadow-glow hover:bg-brand-blue-hover transition-[background-color,transform] hover:scale-[1.02]"
        >
          <Sparkles className="w-4 h-4" />
          Ask Forge
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      {/* Salesforce reconnect row — the org's stored refresh token was
          rejected (ORG_RECONNECT_REQUIRED from the readiness check or the
          agents fetch). The app session is still valid, so the fix is a
          one-click re-link — never a sign-out. Shown above the tiles so the
          broken org can't be missed. */}
      {needsReconnect && (
        <ReconnectSalesforceNotice
          message={
            readiness.reconnectRequired
              ? readiness.error || undefined
              : agentsError || undefined
          }
          onRetry={readiness.reconnectRequired ? readiness.retry : recheck}
        />
      )}

      {/* Three stat tiles — clickable, deep-link into chat (§6.2) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statTiles.map((tile, index) => {
          const Icon = tile.icon;
          return (
            <motion.button
              key={tile.label}
              type="button"
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.04, ease: EASE_REVEAL }}
              onClick={tile.action}
              aria-busy={tile.loading}
              className="group relative overflow-hidden text-left rounded-2xl border border-brand-border bg-white p-5 shadow-soft hover:shadow-card-hover hover:border-brand-blue/30 transition-[box-shadow,border-color] duration-200 cursor-pointer"
            >
              {/* Top accent hairline — a quiet color-coded signal per KPI */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-80',
                  tile.accentBar
                )}
              />
              <div className={cn('flex items-center justify-between mb-4')}>
                <span className={cn(
                  'w-9 h-9 rounded-xl bg-gradient-to-br flex items-center justify-center',
                  tile.unavailable ? 'from-amber-100/80 to-transparent' : tile.accent
                )}>
                  <Icon className={cn('w-4.5 h-4.5', tile.unavailable ? 'text-amber-600' : tile.iconColor)} />
                </span>
                <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-brand-blue transition-colors" />
              </div>
              {tile.loading ? (
                // min-h-8 mirrors text-2xl's 2rem line-height so the shimmer
                // swaps in without the tile jumping taller when the value lands.
                <span className="min-h-8 inline-flex items-center">
                  <span className="skeleton-strong h-7 w-16 rounded-md" aria-hidden="true" />
                </span>
              ) : (
                <p className="font-mono text-3xl font-bold text-brand-dark tabular-nums tracking-tight">
                  {tile.value}
                </p>
              )}
              <p className="text-sm font-medium text-slate-600 mt-0.5 flex items-center gap-2">
                {tile.label}
                {tile.unavailable && !tile.loading && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Needs setup
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {tile.loading ? tile.loadingHint : tile.hint}
              </p>
            </motion.button>
          );
        })}
      </div>

      {/* Package-health status row — when the OrgForge Connector package is
          missing, link straight to the Salesforce package installer. The
          Agents tile itself is a button (can't nest a link), so the row
          carries the install action; it shows whenever the shared preflight
          reports the connector absent. */}
      {readiness.diag?.checks?.package?.installed === false && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-warning/30 bg-brand-warning-bg px-5 py-4 animate-slide-up">
          <PackageOpen className="w-4 h-4 text-brand-warning shrink-0" />
          <p className="text-sm text-slate-700 flex-1">
            The OrgForge Connector package isn&apos;t installed in {org?.name || 'this org'}. Chat and org
            changes stay locked until it&apos;s installed.
          </p>
          {readiness.diag.installUrl && (
            <a
              href={readiness.diag.installUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue hover:underline"
            >
              Get install link
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <Link
            href="/settings"
            className="shrink-0 text-sm font-semibold text-brand-warning hover:underline"
          >
            Settings
          </Link>
        </div>
      )}

      {/* Attention banner — only when something is wrong (§6.0.5). The
          reconnect case is already surfaced by the notice above, so this
          stays for genuine non-reconnect agents failures. */}
      {agentsError && !agentsReconnect && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-warning/30 bg-brand-warning-bg px-5 py-4 animate-slide-up">
          <RefreshCw className="w-4 h-4 text-brand-warning shrink-0" />
          <p className="text-sm text-slate-700 flex-1">
            Couldn&apos;t load your agents: {agentsError}
          </p>
          <button
            type="button"
            onClick={recheck}
            disabled={refreshing}
            className="text-sm font-semibold text-brand-warning hover:underline disabled:opacity-60 disabled:cursor-wait cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Data-viz row — real data, hand-rolled SVG charts (§6.2) */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.12, ease: EASE_REVEAL }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-6"
      >
        <ActivityChart records={records} loading={loading} className="lg:col-span-2" />
        <StatusDonut records={records} loading={loading} />
      </motion.div>

      {/* Operational row — org health posture + deployed agents */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.18, ease: EASE_REVEAL }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
      >
        <OrgHealthPanel
          // Attribution-guard: only render the diag when it belongs to the
          // active org (no cross-org flash while switching).
          diag={readiness.orgId === org?.id ? readiness.diag : null}
          status={readiness.status}
          orgName={org?.name}
          onRetry={readiness.retry}
        />
        <AgentsOverview
          agents={agents}
          loading={statsLoading}
          agentsUnavailable={agentsUnavailable}
          hint={agentsUnavailable ? agentsUnavailableHint(readiness.diag) : undefined}
        />
      </motion.div>

      {/* Activity feed — one shared visual language for both engines (§6.2) */}
      <section className="rounded-2xl border border-brand-border bg-white shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Governance trail
            </p>
            <h2 className="mt-1 font-semibold text-brand-dark">Recent activity</h2>
          </div>
          <Link href="/changes" className="text-sm font-medium text-brand-blue hover:underline">
            View all
          </Link>
        </div>

        {loading ? (
          <div
            className="divide-y divide-brand-border"
            role="status"
            aria-label="Loading recent activity"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-5 py-4 flex items-center gap-4">
                <div className="skeleton-strong w-9 h-9 rounded-xl" aria-hidden="true" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton-strong h-3.5 w-1/3 rounded" aria-hidden="true" />
                  <div className="skeleton-strong h-3 w-1/2 rounded" aria-hidden="true" />
                </div>
              </div>
            ))}
          </div>
        ) : records && records.length > 0 ? (
          <ul className="divide-y divide-brand-border">
            {records.slice(0, 6).map((record, i) => (
              <li key={record.id || i} className="px-5 py-4 flex items-center gap-4 hover:bg-brand-surface/50 transition-colors">
                <span className="w-9 h-9 rounded-xl bg-brand-blue-light flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4 text-brand-blue" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-dark truncate">
                    {record.title || record.summary || record.intent || 'Change record'}
                  </p>
                  <p className="text-xs text-slate-400">{record.status || 'recorded'}</p>
                </div>
                <span className="text-xs text-slate-400 shrink-0">{timeAgo(record.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-slate-500">
              No governed changes yet.{' '}
              <button
                type="button"
                onClick={() => askForge('Add a validation rule to Opportunity')}
                className="text-brand-blue font-medium hover:underline cursor-pointer"
              >
                Request a governed change
              </button>
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
