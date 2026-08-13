'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Bot,
  RefreshCw,
  ArrowRight,
  Sparkles,
  Database,
  Search,
  FileCode2,
  Copy,
  Check,
  X,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch, getErrorMessage, HEAVY_REQUEST_TIMEOUT_MS } from '@/lib/api';
import { useActiveOrg } from '@/lib/org-context';
import { useOrgReadiness, agentsUnavailableHint } from '@/lib/orgReadiness';
import { cn } from '@/lib/utils';
import { EASE_REVEAL } from '@/lib/motion';

interface AgentInfo {
  id?: string;
  developerName?: string;
  masterLabel?: string;
  name?: string;
}

/**
 * Right-side detail drawer (PRD FR-5 "detail drawer with YAML"). Fetches the
 * generated .agent YAML from GET /api/v1/agents/:developerName/yaml on open
 * (the backend retrieves the AiAuthoringBundle via Metadata API — can take
 * tens of seconds, hence the heavy timeout). Editing stays in chat (§6.0:
 * no duplicated forms); the drawer is a read affordance.
 */
function AgentYamlDrawer({
  agent,
  orgId,
  onClose,
}: {
  agent: AgentInfo;
  orgId: string;
  onClose: () => void;
}) {
  const name = agent.name || agent.masterLabel || agent.developerName || 'Unnamed agent';
  const devName = agent.developerName || agent.id || '';
  const reduceMotion = useReducedMotion();
  const [yaml, setYaml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const mounted = React.useRef(true);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadYaml = async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await apiFetch<{ developerName: string; yaml: string }>(
        `/api/v1/agents/${encodeURIComponent(devName)}/yaml?orgId=${encodeURIComponent(orgId)}`,
        undefined,
        HEAVY_REQUEST_TIMEOUT_MS
      );
      if (mounted.current) setYaml(body.yaml);
    } catch (err) {
      if (!mounted.current) return;
      setYaml(null);
      setError(getErrorMessage(err, 'Could not load the agent YAML.'));
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  // Fetch once on open — deferred so state settles after mount
  // (react-hooks/set-state-in-effect). The parent keys the drawer by agent id,
  // so opening another agent remounts and refetches.
  useEffect(() => {
    const timer = setTimeout(() => {
      loadYaml();
    }, 0);
    return () => {
      mounted.current = false;
      if (copyTimer.current) clearTimeout(copyTimer.current);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes; scroll locks while open (same contract as ui/Modal).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const copyYaml = async () => {
    if (!yaml) return;
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the pre block is still selectable */
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} configuration`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* Backdrop — click to close */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <motion.div
        className="absolute inset-y-0 right-0 w-full sm:w-[560px] bg-white shadow-2xl flex flex-col"
        initial={reduceMotion ? false : { x: '100%' }}
        animate={{ x: 0 }}
        exit={reduceMotion ? undefined : { x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
      >
        {/* Header */}
        <div className="flex items-start gap-3.5 px-6 pt-6 pb-4 border-b border-brand-border">
          <span className="w-11 h-11 rounded-xl bg-brand-blue-light flex items-center justify-center shrink-0">
            <Bot className="w-5.5 h-5.5 text-brand-blue" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-brand-dark tracking-tight truncate">{name}</h2>
            <p className="text-xs text-slate-400 font-mono truncate">
              {devName} · .agent · AiAuthoringBundle
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close agent details"
            className="p-2 -mr-1 rounded-lg text-slate-500 hover:text-brand-dark hover:bg-brand-surface transition-colors cursor-pointer"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Body — YAML */}
        <div className="flex-1 min-h-0 px-6 py-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-slate-400">
              Generated configuration
            </span>
            {yaml && (
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-brand-blue bg-brand-blue-light border border-brand-blue/20 rounded-full px-2 py-0.5">
                {yaml.split('\n').length} LINES
              </span>
            )}
          </div>

          {loading ? (
            <div className="rounded-xl border border-brand-border bg-brand-surface/40 p-4 space-y-2.5">
              {[92, 76, 84, 58, 88, 64].map((w, i) => (
                <div key={i} className="h-3.5 rounded bg-brand-surface animate-pulse" style={{ width: `${w}%` }} />
              ))}
              <p className="pt-1 text-xs text-slate-400">
                Retrieving the AiAuthoringBundle from Salesforce… this can take a moment.
              </p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-brand-refused shrink-0 mt-0.5" />
                <p className="text-sm text-slate-700">{error}</p>
              </div>
              <button
                type="button"
                onClick={loadYaml}
                className="text-sm font-semibold text-brand-blue hover:underline cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : (
            <pre className="rounded-xl border border-brand-border bg-[#0a0f1e] text-slate-100 p-4 overflow-auto max-h-[58vh] text-[12.5px] leading-relaxed font-mono whitespace-pre">
              {yaml}
            </pre>
          )}
        </div>

        {/* Footer — copy + edit in chat (editing flows through the Copilot) */}
        <div className="px-6 py-4 border-t border-brand-border flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={copyYaml}
            disabled={!yaml}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-brand-border text-sm font-medium text-slate-600 hover:bg-brand-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-brand-pass" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy YAML'}
          </button>
          <Link
            href={`/chat?prompt=${encodeURIComponent(`Edit the ${name} agent (${devName}) — show me its current .agent configuration and propose the changes.`)}`}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-blue text-white text-sm font-semibold shadow-glow hover:bg-brand-blue-hover transition-colors"
          >
            <Sparkles className="w-4 h-4" /> Edit in chat
          </Link>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Agents (plan §6.4) — a quiet, read-only library of the org's live
 * Agentforce agents over GET /api/v1/agents. Editing happens in chat: every
 * card deep-links into the Copilot with a pre-filled prompt (§6.0: "no
 * duplicated forms"). No org → the page collapses to one connect CTA.
 */
export default function AgentsPage() {
  const { org, setOrgs } = useActiveOrg();
  const reduceMotion = useReducedMotion();
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  // Shared org readiness (same provider as the sign-in banner, chat chip, and
  // dashboard tile — the flags are org-attributed by the provider): a compact
  // summary row under the header explains why agent building is unavailable,
  // or lets the user retry a failed check in place.
  const readiness = useOrgReadiness();
  const agentsUnavailable = readiness.agentsUnavailable;
  const readinessFailed = readiness.checkFailed;

  const loadOrgs = async () => {
    try {
      const { orgs: fetched } = await apiFetch<{ orgs: Array<{ id: string; alias?: string; type?: string; instanceUrl?: string }> }>(
        '/api/v1/orgs'
      );
      setOrgs(
        (fetched || []).map((o) => ({
          id: o.id,
          name: o.alias || o.id,
          orgType: (['production', 'sandbox', 'scratch'].includes(o.type || '')
            ? o.type
            : 'production') as 'production' | 'sandbox' | 'scratch',
          instanceUrl: o.instanceUrl,
        }))
      );
    } catch {
      /* backend unreachable — the no-org empty state handles it */
    }
  };

  const loadAgents = async (opts: { refresh?: boolean } = {}) => {
    if (!org) return;
    try {
      const { agents: a } = await apiFetch<{ agents: AgentInfo[] }>(
        `/api/v1/agents?orgId=${encodeURIComponent(org.id)}${opts.refresh ? '&refresh=1' : ''}`
      );
      setAgents(Array.isArray(a) ? a : []);
      setError(null);
    } catch (err) {
      setAgents(null);
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Deferred so state settles after mount (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      loadOrgs();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!org) {
      // No org — stop the loader after mount settles (deferred, not sync).
      const timer = setTimeout(() => setLoading(false), 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setLoading(true);
      loadAgents();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  const refresh = async () => {
    setRefreshing(true);
    await loadAgents({ refresh: true }); // bypass the forge.agents cache
    setRefreshing(false);
  };

  // ── No org → the page collapses to one CTA (same rule as the dashboard) ──
  if (!loading && !org) {
    return (
      <div className="max-w-3xl mx-auto pt-16 md:pt-24 flex flex-col items-center text-center animate-fade-in">
        <div className="w-14 h-14 rounded-2xl bg-brand-blue-light flex items-center justify-center mb-6 shadow-glow">
          <Database className="w-7 h-7 text-brand-blue" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-brand-dark tracking-tight">
          Connect Salesforce to see your agents
        </h1>
        <p className="mt-3 text-slate-500 max-w-md">
          Your deployed Agentforce agents will show up here once an org is connected —
          read-only, with edits in chat.
        </p>
        <Link
          href="/login?step=2"
          className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-blue text-white font-semibold shadow-glow hover:bg-brand-blue-hover transition-[background-color,transform] hover:scale-[1.02]"
        >
          Connect Salesforce <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  const filtered = (agents || []).filter((a) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${a.name ?? ''} ${a.developerName ?? ''}`.toLowerCase().includes(q);
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Header row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-brand-dark tracking-tight">Agents</h1>
          <p className="mt-1 text-slate-500">
            Your deployed Agentforce agents{org ? ` in ${org.name}` : ''} — read-only here, edits happen in chat.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-brand-border bg-white text-sm font-medium text-slate-600 hover:bg-brand-surface transition-colors cursor-pointer"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} /> Refresh
          </button>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-blue text-white text-sm font-semibold shadow-glow hover:bg-brand-blue-hover transition-colors"
          >
            <Sparkles className="w-4 h-4" /> Ask OrgForge
          </Link>
        </div>
      </div>

      {/* Readiness summary row — only shows when agents can't run (cause-aware
          copy shared with the dashboard tile) or availability is unknown. */}
      {agentsUnavailable && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 animate-slide-up">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-sm text-slate-700 flex-1">
            Agent building is unavailable in this org.{' '}
            <span className="text-slate-600">{agentsUnavailableHint(readiness.diag)}.</span>
          </p>
          <Link
            href="/settings"
            className="shrink-0 text-sm font-semibold text-brand-blue hover:underline"
          >
            Fix in Settings
          </Link>
        </div>
      )}
      {readinessFailed && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-border bg-white px-4 py-3 shadow-soft animate-slide-up">
          <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0" />
          <p className="text-sm text-slate-500 flex-1">
            Couldn&apos;t check whether agent building is available in this org.
          </p>
          <button
            type="button"
            onClick={readiness.retry}
            className="shrink-0 text-sm font-semibold text-brand-blue hover:underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Search — quiet filter, hidden when the list is empty */}
      {agents !== null && agents.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter agents…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-brand-border bg-white text-sm text-brand-dark placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue/50 transition-shadow"
          />
        </div>
      )}

      {/* Error banner — one inline banner, one action (§6.0.5) */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-warning/30 bg-brand-warning-bg px-5 py-4 animate-slide-up">
          <RefreshCw className="w-4 h-4 text-brand-warning shrink-0" />
          <p className="text-sm text-slate-700 flex-1">Couldn&apos;t load your agents — {error}</p>
          <button
            type="button"
            onClick={refresh}
            className="text-sm font-semibold text-brand-warning hover:underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* List — one shared loading flag drives all skeleton cards, so the
          shimmer appears and resolves in sync (same .skeleton-strong sweep
          as the dashboard stat tiles). */}
      {loading ? (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          role="status"
          aria-label="Loading agents"
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-2xl border border-brand-border bg-white p-5 shadow-soft">
              <div className="flex items-center gap-3 mb-4">
                <div className="skeleton-strong w-10 h-10 rounded-xl" aria-hidden="true" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton-strong h-3.5 w-2/3 rounded" aria-hidden="true" />
                  <div className="skeleton-strong h-3 w-1/2 rounded" aria-hidden="true" />
                </div>
              </div>
              <div className="skeleton-strong h-3 w-full rounded" aria-hidden="true" />
            </div>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((agent, index) => {
            const name = agent.name || agent.masterLabel || agent.developerName || 'Unnamed agent';
            const devName = agent.developerName || agent.id || '';
            return (
              // Card is clickable for mouse users; the explicit "View YAML"
              // button is the keyboard-accessible entry point (no role=button
              // on the card — nesting it inside would wrap another button +
              // a link in interactive semantics, and a card-level onKeyDown
              // would swallow Enter on those inner controls).
              <motion.div
                key={agent.id || devName || name}
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.04, ease: EASE_REVEAL }}
                onClick={() => setSelectedAgent(agent)}
                className="group rounded-2xl border border-brand-border bg-white p-5 shadow-soft hover:shadow-card-hover hover:border-brand-blue/30 transition-[box-shadow,border-color] duration-200 cursor-pointer"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-10 h-10 rounded-xl bg-brand-blue-light flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5 text-brand-blue" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-brand-dark truncate">{name}</p>
                    <p className="text-xs text-slate-400 font-mono truncate">{devName}</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-pass/10 px-2.5 py-1 text-xs font-medium text-brand-pass shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-pass" /> in org
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Edits happen in chat</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAgent(agent);
                      }}
                      className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-brand-blue transition-colors cursor-pointer"
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                      View YAML
                      <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                    </button>
                    <Link
                      href={`/chat?prompt=${encodeURIComponent(`Show me how the agent ${devName || name} is configured`)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                    >
                      Open in chat
                      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : error ? null : (
        // No empty-state under an error banner — the banner already explains
        // the failure (an empty list here would contradict it).
        <div className="rounded-2xl border border-brand-border bg-white px-5 py-12 text-center shadow-soft">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-surface mb-4">
            <Bot className="w-6 h-6 text-slate-400" />
          </span>
          <p className="text-sm text-slate-500">
            {query.trim()
              ? `No agents match “${query}”.`
              : 'No agents found in this org yet.'}{' '}
            <Link href="/chat" className="text-brand-blue font-medium hover:underline">
              Build your first one in chat
            </Link>
          </p>
        </div>
      )}

      {/* YAML detail drawer — one agent at a time (keyed remount refetches) */}
      <AnimatePresence>
        {selectedAgent && org && (
          <AgentYamlDrawer
            key={selectedAgent.id || selectedAgent.developerName || selectedAgent.name || 'agent'}
            agent={selectedAgent}
            orgId={org.id}
            onClose={() => setSelectedAgent(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
