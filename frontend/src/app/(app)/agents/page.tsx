'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
  AlertTriangle,
  ExternalLink,
  LayoutGrid,
  List,
  Cpu,
  Layers,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { apiFetch, getErrorMessage, HEAVY_REQUEST_TIMEOUT_MS } from '@/lib/api';
import { useActiveOrg } from '@/lib/org-context';
import { useOrgReadiness, agentsUnavailableHint } from '@/lib/orgReadiness';
import { useOrgPackageHealth } from '@/lib/orgHealth';
import { cn } from '@/lib/utils';
import { EASE_REVEAL } from '@/lib/motion';
import PackageRequiredGate from '@/components/org/PackageRequiredGate';

interface AgentInfo {
  id?: string;
  developerName?: string;
  masterLabel?: string;
  name?: string;
}

/**
 * Formats snake_case developer names or raw identifiers into clean, human-readable titles
 * while preserving numbers and abbreviations (e.g. Contract_Renewal_Specialist_1 -> Contract Renewal Specialist 1).
 */
function formatAgentTitle(rawName: string): string {
  if (!rawName) return 'Unnamed Agent';
  if (rawName.includes('_')) {
    return rawName
      .split('_')
      .filter(Boolean)
      .map((part) => (part.length > 1 ? part.charAt(0).toUpperCase() + part.slice(1) : part.toUpperCase()))
      .join(' ');
  }
  return rawName;
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
  const displayTitle = formatAgentTitle(name);
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
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} configuration`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <motion.div
        className="relative z-10 w-full sm:w-[600px] md:w-[640px] bg-white shadow-2xl flex flex-col h-full border-l border-brand-border"
        initial={reduceMotion ? false : { x: '100%' }}
        animate={{ x: 0 }}
        exit={reduceMotion ? undefined : { x: '100%' }}
        transition={{ type: 'spring', damping: 32, stiffness: 340 }}
      >
        {/* Header */}
        <div className="flex items-start gap-4 px-6 pt-6 pb-4 border-b border-brand-border bg-gradient-to-b from-slate-50/70 to-white">
          <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-blue-light to-blue-100/60 border border-brand-blue/20 flex items-center justify-center shrink-0 text-brand-blue shadow-xs">
            <Bot className="w-6 h-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-brand-dark tracking-tight truncate">{displayTitle}</h2>
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200/60">
                .agent
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 font-mono truncate">
              {devName} · AiAuthoringBundle
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close agent details"
            className="p-2 -mr-1 rounded-xl text-slate-400 hover:text-brand-dark hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — YAML */}
        <div className="flex-1 min-h-0 px-6 py-5 overflow-y-auto bg-slate-50/40">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-brand-blue" />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                AiAuthoringBundle Specification
              </span>
            </div>
            {yaml && (
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-blue bg-brand-blue-light border border-brand-blue/20 rounded-full px-2.5 py-0.5">
                {yaml.split('\n').length} lines
              </span>
            )}
          </div>

          {loading ? (
            <div className="rounded-2xl border border-brand-border bg-white p-6 shadow-xs space-y-3">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-4 h-4 text-brand-blue animate-spin shrink-0" />
                <p className="text-sm font-medium text-slate-700">Retrieving .agent metadata from Salesforce...</p>
              </div>
              <div className="pt-2 space-y-2.5">
                {[95, 78, 86, 62, 90, 70, 80].map((w, i) => (
                  <div key={i} className="h-3 rounded-md bg-slate-100 animate-pulse" style={{ width: `${w}%` }} />
                ))}
              </div>
              <p className="pt-2 text-xs text-slate-400">
                Metadata API AiAuthoringBundle retrieval can take a few seconds on first fetch.
              </p>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-5 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-rose-900">Failed to load agent configuration</p>
                  <p className="mt-1 text-xs text-rose-700 leading-relaxed">{error}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={loadYaml}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-100/80 hover:bg-rose-200/80 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry fetch
              </button>
            </div>
          ) : (
            <div className="relative rounded-2xl border border-slate-800 bg-[#0d1117] text-slate-100 shadow-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-900/90 border-b border-slate-800 text-xs text-slate-400 font-mono">
                <span>{devName}.agent</span>
                <span>YAML</span>
              </div>
              <pre className="p-4 overflow-auto max-h-[62vh] text-[12.5px] leading-relaxed font-mono whitespace-pre text-emerald-400/90 selection:bg-brand-blue/30 selection:text-white">
                {yaml}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-brand-border bg-white flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={copyYaml}
            disabled={!yaml}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-brand-border text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied to clipboard' : 'Copy YAML'}
          </button>
          <Link
            href={`/chat?prompt=${encodeURIComponent(`Edit the ${name} agent (${devName}). Show me its current .agent configuration and propose the changes.`)}`}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-blue text-white text-xs font-semibold shadow-glow hover:bg-brand-blue-hover transition-colors"
          >
            <Sparkles className="w-4 h-4" /> Edit in chat
          </Link>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Agents Page — a clean, modern, read-only library of the connected org's live
 * Agentforce agents over GET /api/v1/agents. Editing happens in chat.
 */
export default function AgentsPage() {
  const { org } = useActiveOrg();
  const pkg = useOrgPackageHealth();
  const reduceMotion = useReducedMotion();
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedAgent, setSelectedAgent] = useState<AgentInfo | null>(null);
  const [copiedDevName, setCopiedDevName] = useState<string | null>(null);

  const readiness = useOrgReadiness();
  const agentsUnavailable = readiness.agentsUnavailable;
  const readinessFailed = readiness.checkFailed;

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
    if (!org) {
      const timer = setTimeout(() => setLoading(false), 0);
      return () => clearTimeout(timer);
    }
    if (pkg.status !== 'installed') return;
    const timer = setTimeout(() => {
      setLoading(true);
      loadAgents();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id, pkg.status]);

  const refresh = async () => {
    setRefreshing(true);
    await loadAgents({ refresh: true });
    setRefreshing(false);
  };

  const copyDevName = async (e: React.MouseEvent, devName: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(devName);
      setCopiedDevName(devName);
      setTimeout(() => setCopiedDevName(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => {
    const list = agents || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => {
      const n = (a.name ?? '').toLowerCase();
      const d = (a.developerName ?? '').toLowerCase();
      const l = (a.masterLabel ?? '').toLowerCase();
      return n.includes(q) || d.includes(q) || l.includes(q);
    });
  }, [agents, query]);

  // ── No org connected ──
  if (!loading && !org) {
    return (
      <div className="max-w-3xl mx-auto pt-16 md:pt-24 flex flex-col items-center text-center animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-blue-light to-blue-100/60 flex items-center justify-center mb-6 shadow-glow border border-brand-blue/20">
          <Database className="w-8 h-8 text-brand-blue" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-brand-dark tracking-tight">
          Connect Salesforce to see your agents
        </h1>
        <p className="mt-3 text-slate-500 max-w-md leading-relaxed">
          Your deployed Agentforce agents will show up here once an org is connected.
          Read-only, with rapid YAML inspection and natural language edits in chat.
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

  // Package access gate
  if (pkg.status !== 'installed') {
    return (
      <PackageRequiredGate
        health={pkg.health}
        status={pkg.status}
        onRecheck={pkg.forceRecheck}
        orgAlias={org?.name}
      />
    );
  }

  const totalCount = agents ? agents.length : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl md:text-3xl font-bold text-brand-dark tracking-tight">Agents</h1>
            {!loading && agents !== null && (
              <span className="inline-flex items-center rounded-full bg-brand-blue-light px-3 py-0.5 text-xs font-bold text-brand-blue border border-brand-blue/20">
                {totalCount} {totalCount === 1 ? 'Agent' : 'Agents'} Deployed
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-slate-500">
            Your deployed Agentforce agents in <span className="font-medium text-brand-dark">{org?.name || 'Salesforce'}</span> (read-only here; edits and actions happen in chat).
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-brand-border bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-xs disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={cn('w-3.5 h-3.5 text-slate-500', (refreshing || loading) && 'animate-spin')} />
            Refresh
          </button>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-blue text-white text-xs font-semibold shadow-glow hover:bg-brand-blue-hover transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask Forge
          </Link>
        </div>
      </div>

      {/* ── Overview Metrics Strip ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-brand-border bg-white p-4.5 shadow-soft flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-brand-blue-light flex items-center justify-center text-brand-blue shrink-0">
            <Bot className="w-5.5 h-5.5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">Total Agents</p>
            <p className="text-lg font-bold text-brand-dark mt-0.5">
              {loading ? '—' : `${totalCount} Deployed`}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-brand-border bg-white p-4.5 shadow-soft flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
            <Database className="w-5.5 h-5.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">Active Org</p>
            <p className="text-sm font-bold text-brand-dark mt-0.5 truncate flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              {org?.name || 'Salesforce Org'}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-brand-border bg-white p-4.5 shadow-soft flex items-center gap-4">
          <div className={cn(
            'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border',
            agentsUnavailable
              ? 'bg-amber-50 text-amber-600 border-amber-200'
              : 'bg-indigo-50 text-indigo-600 border-indigo-100'
          )}>
            <Cpu className="w-5.5 h-5.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">Agentforce Runtime</p>
            <p className="text-sm font-bold text-brand-dark mt-0.5 flex items-center gap-1.5">
              {agentsUnavailable ? (
                <span className="text-amber-700">Setup Required</span>
              ) : (
                <span className="text-emerald-700 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 inline" /> Ready
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* ── Readiness Banner ── */}
      {agentsUnavailable && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3.5 shadow-soft animate-slide-up">
          <AlertTriangle className="w-4.5 h-4.5 text-amber-600 shrink-0" />
          <p className="text-xs sm:text-sm text-slate-700 flex-1">
            Agent building is unavailable in this org.{' '}
            <span className="text-slate-600">{agentsUnavailableHint(readiness.diag)}.</span>
          </p>
          {readiness.diag?.checks?.package?.installed === false && readiness.diag.installUrl && (
            <a
              href={readiness.diag.installUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-brand-blue hover:underline"
            >
              Get install link
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <Link
            href="/settings"
            className="shrink-0 text-xs font-semibold text-brand-blue hover:underline"
          >
            Fix in Settings
          </Link>
        </div>
      )}

      {readinessFailed && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-border bg-white px-4 py-3 shadow-soft animate-slide-up">
          <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0" />
          <p className="text-xs sm:text-sm text-slate-500 flex-1">
            Couldn&apos;t verify agent runtime capabilities for this org.
          </p>
          <button
            type="button"
            onClick={readiness.retry}
            className="shrink-0 text-xs font-semibold text-brand-blue hover:underline cursor-pointer"
          >
            Retry check
          </button>
        </div>
      )}

      {/* ── Toolbar: Search, Count & View Switcher ── */}
      <div className="rounded-2xl border border-brand-border bg-white p-3.5 shadow-soft flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or developer API name…"
            className="w-full pl-9 pr-8 py-2 rounded-xl border border-brand-border bg-slate-50/50 text-xs text-brand-dark placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue/50 transition-all"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between w-full sm:w-auto gap-4">
          <p className="text-xs text-slate-500 tabular-nums">
            {query.trim()
              ? `Showing ${filtered.length} of ${totalCount} agents`
              : `${totalCount} total ${totalCount === 1 ? 'agent' : 'agents'}`}
          </p>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/60">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              className={cn(
                'p-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5',
                viewMode === 'grid'
                  ? 'bg-white text-brand-dark shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              )}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="List view"
              className={cn(
                'p-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5',
                viewMode === 'list'
                  ? 'bg-white text-brand-dark shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              )}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-warning/30 bg-brand-warning-bg px-5 py-4 animate-slide-up">
          <RefreshCw className="w-4 h-4 text-brand-warning shrink-0" />
          <p className="text-xs sm:text-sm text-slate-700 flex-1">Couldn&apos;t load your agents: {error}</p>
          <button
            type="button"
            onClick={refresh}
            className="text-xs sm:text-sm font-semibold text-brand-warning hover:underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Agents Grid / List ── */}
      {loading ? (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
          role="status"
          aria-label="Loading agents"
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex flex-col rounded-2xl border border-brand-border bg-white p-5.5 shadow-soft min-h-[220px]"
            >
              <div className="flex items-center justify-between">
                <div className="skeleton-strong w-11 h-11 rounded-xl" aria-hidden="true" />
                <div className="skeleton-strong h-5 w-16 rounded-full" aria-hidden="true" />
              </div>
              <div className="mt-4 flex-1 space-y-2">
                <div className="skeleton-strong h-4 w-3/4 rounded" aria-hidden="true" />
                <div className="skeleton-strong h-3 w-1/2 rounded" aria-hidden="true" />
              </div>
              <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-between">
                <div className="skeleton-strong h-6 w-20 rounded" aria-hidden="true" />
                <div className="skeleton-strong h-6 w-24 rounded" aria-hidden="true" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((agent, index) => {
              const name = agent.name || agent.masterLabel || agent.developerName || 'Unnamed agent';
              const displayTitle = formatAgentTitle(name);
              const devName = agent.developerName || agent.id || '';
              const isCopied = copiedDevName === devName;

              return (
                <motion.div
                  key={agent.id || devName || name}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.03, ease: EASE_REVEAL }}
                  onClick={() => setSelectedAgent(agent)}
                  className="group flex flex-col justify-between rounded-2xl border border-brand-border bg-white p-5.5 shadow-soft hover:shadow-card-hover hover:border-brand-blue/35 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer relative"
                >
                  {/* Top card row: Bot Avatar + Status Pill */}
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-blue-light to-blue-100/60 border border-brand-blue/20 flex items-center justify-center shrink-0 text-brand-blue group-hover:bg-brand-blue group-hover:text-white transition-all duration-200 shadow-xs">
                        <Bot className="w-5.5 h-5.5" />
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200/60 shrink-0">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        in org
                      </span>
                    </div>

                    {/* Agent Titles and Developer Identifier */}
                    <div className="mt-4 min-w-0">
                      <h3
                        title={displayTitle}
                        className="text-[15px] font-bold text-brand-dark group-hover:text-brand-blue transition-colors leading-snug line-clamp-2"
                      >
                        {displayTitle}
                      </h3>

                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={(e) => copyDevName(e, devName)}
                          title="Click to copy developer API name"
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-50 hover:bg-slate-100 border border-slate-200/70 text-[11px] font-mono text-slate-600 transition-colors max-w-full truncate cursor-pointer"
                        >
                          <span className="truncate">{devName}</span>
                          {isCopied ? (
                            <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                          ) : (
                            <Copy className="w-3 h-3 text-slate-400 group-hover/btn:text-slate-600 shrink-0 opacity-70" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Bundle Tags */}
                    <div className="mt-3 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100/80 px-2 py-0.5 rounded-md">
                        <Layers className="w-3 h-3 text-slate-400" /> .agent
                      </span>
                      <span className="text-[11px] text-slate-400">AiAuthoringBundle</span>
                    </div>
                  </div>

                  {/* Card Footer Actions */}
                  <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAgent(agent);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-brand-blue hover:bg-brand-blue-light/50 transition-colors cursor-pointer"
                    >
                      <FileCode2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-brand-blue" />
                      View YAML
                    </button>

                    <Link
                      href={`/chat?prompt=${encodeURIComponent(`Show me how the agent ${devName || name} is configured`)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue/10 hover:bg-brand-blue text-brand-blue hover:text-white px-3 py-1.5 text-xs font-semibold transition-all shadow-xs"
                    >
                      Open in chat
                      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          /* ── List / Table View ── */
          <div className="rounded-2xl border border-brand-border bg-white shadow-soft overflow-hidden">
            <div className="divide-y divide-brand-border">
              {filtered.map((agent) => {
                const name = agent.name || agent.masterLabel || agent.developerName || 'Unnamed agent';
                const displayTitle = formatAgentTitle(name);
                const devName = agent.developerName || agent.id || '';
                const isCopied = copiedDevName === devName;

                return (
                  <div
                    key={agent.id || devName || name}
                    onClick={() => setSelectedAgent(agent)}
                    className="p-4 sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <span className="w-10 h-10 rounded-xl bg-brand-blue-light/70 border border-brand-blue/20 flex items-center justify-center text-brand-blue shrink-0 group-hover:bg-brand-blue group-hover:text-white transition-colors">
                        <Bot className="w-5 h-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-brand-dark group-hover:text-brand-blue transition-colors truncate">
                            {displayTitle}
                          </p>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200/60 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> in org
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <button
                            type="button"
                            onClick={(e) => copyDevName(e, devName)}
                            className="inline-flex items-center gap-1 text-xs font-mono text-slate-500 hover:text-slate-700 truncate"
                          >
                            <span>{devName}</span>
                            {isCopied ? (
                              <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                            ) : (
                              <Copy className="w-3 h-3 text-slate-400 opacity-60 shrink-0" />
                            )}
                          </button>
                          <span className="text-xs text-slate-300">·</span>
                          <span className="text-xs text-slate-400">.agent</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAgent(agent);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-brand-border bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-brand-blue transition-colors cursor-pointer"
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-slate-400" />
                        View YAML
                        <ChevronRight className="w-3 h-3 text-slate-400" />
                      </button>

                      <Link
                        href={`/chat?prompt=${encodeURIComponent(`Show me how the agent ${devName || name} is configured`)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue text-white px-3.5 py-1.5 text-xs font-semibold shadow-glow hover:bg-brand-blue-hover transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Open in chat
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : error ? null : (
        /* ── Empty State ── */
        <div className="rounded-2xl border border-brand-border bg-white px-6 py-16 text-center shadow-soft">
          <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-blue-light to-blue-100/60 border border-brand-blue/20 text-brand-blue mb-4 shadow-xs">
            <Bot className="w-7 h-7" />
          </span>
          <h3 className="text-base font-bold text-brand-dark">
            {query.trim() ? 'No matching agents found' : 'No Agentforce agents found in this org'}
          </h3>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
            {query.trim() ? (
              <>No deployed agents match &ldquo;{query}&rdquo;. Try a different search keyword or clear the filter.</>
            ) : (
              <>You don&apos;t have any Agentforce agents deployed in this org yet. You can create your first agent using natural language in chat.</>
            )}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            {query.trim() ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="px-4 py-2 rounded-xl border border-brand-border text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Clear filter
              </button>
            ) : (
              <Link
                href="/chat"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-blue text-white text-xs font-semibold shadow-glow hover:bg-brand-blue-hover transition-colors"
              >
                <Sparkles className="w-4 h-4" /> Build an agent in chat
              </Link>
            )}
          </div>
        </div>
      )}

      {/* ── YAML Detail Drawer ── */}
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
