'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plug,
  GitBranch,
  Package,
  ArrowRight,
  RefreshCw,
  Trash2,
  Loader2,
  Database,
  Bot,
  Workflow,
  ShieldCheck,
  Activity,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useActiveOrg } from '@/lib/org-context';
import { cn } from '@/lib/utils';
import GithubConnectCard from '@/components/settings/GithubConnectCard';

interface OrgRow {
  id: string;
  alias?: string;
  type?: string;
  instanceUrl?: string;
  components?: number;
}

const ORG_TYPE_CLASSES: Record<string, string> = {
  production: 'bg-brand-danger/10 text-brand-danger',
  sandbox: 'bg-brand-warning/10 text-brand-warning',
  scratch: 'bg-brand-pass/10 text-brand-pass',
};

/** Diagnostics preflight result — GET /api/v1/diagnostics + POST /recheck. */
interface DiagResult {
  state: 'ok' | 'attention' | 'error';
  capability?: {
    agents?: 'ok' | 'attention';
    org_change?: 'ok' | 'attention';
  };
  checks?: {
    instanceUrl?: { ok?: boolean };
    license?: { supported?: boolean; reason?: string };
    package?: { installed?: boolean; reason?: string };
    settings?: { agentforceEnabled?: boolean | null; reason?: string };
    provisioning?: {
      ok?: boolean;
      agentUsername?: string | null;
      permissionsAssigned?: boolean;
      reason?: string;
    };
    orgType?: { detected?: string | null; corrected?: boolean };
  };
  agentUsername?: string | null;
  checkedAt?: string;
  cached?: boolean;
  cachedAt?: string;
}

const STATE_META: Record<DiagResult['state'], { label: string; className: string }> = {
  ok: { label: 'All systems ready', className: 'bg-brand-pass/10 text-brand-pass' },
  attention: { label: 'Needs attention', className: 'bg-brand-warning/10 text-brand-warning' },
  error: { label: 'Check failed', className: 'bg-brand-danger/10 text-brand-danger' },
};

function CapabilityChip({ label, icon: Icon, status }: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  status?: 'ok' | 'attention';
}) {
  const ready = status === 'ok';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-brand-border bg-brand-surface/40 px-3.5 py-3">
      <span className={cn(
        'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
        ready ? 'bg-brand-pass/10 text-brand-pass' : 'bg-brand-warning/10 text-brand-warning'
      )}>
        <Icon className="w-4.5 h-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-dark">{label}</p>
        <p className="text-xs text-slate-400">{ready ? 'Ready to use in this org' : 'Needs setup'}</p>
      </div>
      <span className={cn(
        'rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0',
        ready ? 'bg-brand-pass/10 text-brand-pass' : 'bg-brand-warning/10 text-brand-warning'
      )}>
        {ready ? 'READY' : 'ATTENTION'}
      </span>
    </div>
  );
}

function SectionCard({ icon: Icon, title, subtitle, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-brand-border bg-white shadow-soft overflow-hidden">
      <div className="px-5 py-4 border-b border-brand-border flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-brand-blue-light flex items-center justify-center shrink-0">
          <Icon className="w-4.5 h-4.5 text-brand-blue" />
        </span>
        <div>
          <h2 className="font-semibold text-brand-dark leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * Settings (plan §6.4) — Connections (linked Salesforce orgs + disconnect),
 * Integrations (GitHub audit destination via the shared GithubConnectCard —
 * D8 persistent status indicator), and Advanced (capabilities per org from
 * the live diagnostics EC-16 split, diagnostics re-run via POST /recheck, the
 * 10-stage operator workspace link, and the packaged-ECA/runtime reference —
 * PRD FR-5 §4.4).
 */
export default function SettingsFlow() {
  const { org, orgs, setOrgs, selectOrg } = useActiveOrg();

  // ── Connections ─────────────────────────────────────────────────────────
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  // Bumped by "Reload settings" so the shared GithubConnectCard re-checks status.
  const [ghRecheck, setGhRecheck] = useState(0);

  // ── Advanced: live diagnostics (capabilities + re-run, PRD FR-5 §4.4) ──
  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [diagOrgId, setDiagOrgId] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  // Tracks the org the most recent fetch STARTED for — a response for a
  // superseded org is discarded (no out-of-order stale display on switch).
  const diagOrgRef = React.useRef<string | null>(null);

  const loadDiagnostics = useCallback(
    async (force: boolean) => {
      if (!org) return;
      const targetId = org.id;
      diagOrgRef.current = targetId;
      setDiagLoading(!force);
      setDiagRunning(force);
      setDiagError(null);
      try {
        // force → POST /recheck (bypasses the 24h forge.diagnostics cache).
        const result = await apiFetch<DiagResult>(
          `/api/v1/diagnostics${force ? '/recheck' : ''}?orgId=${encodeURIComponent(targetId)}`,
          force ? { method: 'POST' } : undefined
        );
        if (diagOrgRef.current !== targetId) return; // org switched — discard
        setDiag(result);
        setDiagOrgId(targetId);
      } catch (err) {
        if (diagOrgRef.current !== targetId) return;
        setDiag(null);
        setDiagError(err instanceof Error ? err.message : 'Diagnostics check failed');
      } finally {
        if (diagOrgRef.current === targetId) {
          setDiagLoading(false);
          setDiagRunning(false);
        }
      }
    },
    [org]
  );

  useEffect(() => {
    if (!org) return;
    // Deferred so state settles after mount (react-hooks/set-state-in-effect).
    // Clear any previous org's result so a switch never shows stale data.
    const timer = setTimeout(() => {
      setDiag(null);
      setDiagOrgId(null);
      setDiagError(null);
      loadDiagnostics(false);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  const loadOrgs = useCallback(async () => {
    try {
      const { orgs: fetched } = await apiFetch<{ orgs: OrgRow[] }>('/api/v1/orgs');
      const mapped = (fetched || []).map((o) => ({
        id: o.id,
        name: o.alias || o.id,
        orgType: (['production', 'sandbox', 'scratch'].includes(o.type || '')
          ? o.type
          : 'production') as 'production' | 'sandbox' | 'scratch',
        instanceUrl: o.instanceUrl,
      }));
      setOrgs(mapped);
      setOrgsError(null);
    } catch (err) {
      setOrgsError(err instanceof Error ? err.message : 'Failed to load org connections');
    } finally {
      setOrgsLoading(false);
    }
  }, [setOrgs]);

  useEffect(() => {
    // Deferred so state settles after mount (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      loadOrgs();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadOrgs]);

  const handleDisconnect = async (orgId: string) => {
    if (!window.confirm(`Disconnect ${orgId}? Its indexed context will be removed.`)) return;
    setDisconnecting(orgId);
    setOrgsError(null);
    try {
      await apiFetch(`/api/v1/orgs/${encodeURIComponent(orgId)}`, { method: 'DELETE' });
      const next = orgs.filter((o) => o.id !== orgId);
      setOrgs(next);
      if (next.length === 0) selectOrg(null);
      await loadOrgs();
    } catch (err) {
      setOrgsError(err instanceof Error ? err.message : 'Failed to disconnect org');
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-brand-dark tracking-tight">Settings</h1>
        <p className="mt-1 text-slate-500">Connections, integrations, and runtime reference.</p>
      </div>

      {/* ── Connections ─────────────────────────────────────────────────── */}
      <SectionCard icon={Plug} title="Connections" subtitle="Linked Salesforce orgs — the active org feeds both engines">
        {orgsLoading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-brand-surface animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 rounded bg-brand-surface animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-brand-surface/70 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : orgsError && (!orgs || orgs.length === 0) ? (
          <div className="text-center py-6">
            <p className="text-sm text-slate-500">{orgsError}</p>
          </div>
        ) : orgs.length > 0 ? (
          <ul className="divide-y divide-brand-border">
            {orgs.map((o) => (
              <li key={o.id} className="py-3.5 first:pt-0 last:pb-0 flex items-center gap-4">
                <span className="w-9 h-9 rounded-xl bg-brand-blue-light flex items-center justify-center shrink-0">
                  <Database className="w-4 h-4 text-brand-blue" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <p className="text-sm font-semibold text-brand-dark truncate">{o.name}</p>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize', ORG_TYPE_CLASSES[o.orgType] || 'bg-brand-surface text-slate-500')}>
                      {o.orgType}
                    </span>
                    {o.id === org?.id && (
                      <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[11px] font-semibold text-brand-blue">active</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 font-mono truncate">{o.instanceUrl || o.id}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDisconnect(o.id)}
                  disabled={disconnecting === o.id}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:text-brand-danger hover:bg-brand-danger/5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {disconnecting === o.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500">No Salesforce org connected yet.</p>
            <Link
              href="/login?step=2"
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-blue text-white text-sm font-semibold shadow-glow hover:bg-brand-blue-hover transition-colors"
            >
              Connect Salesforce <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </SectionCard>

      {/* ── Integrations: GitHub audit destination (shared flow, §12.3) ─── */}
      <SectionCard icon={GitBranch} title="GitHub Audit Destination" subtitle="Where signed change records are committed">
        <GithubConnectCard variant="section" recheckKey={ghRecheck} />
      </SectionCard>

      {/* ── Advanced: capabilities per org, diagnostics re-run, workspace ── */}
      <SectionCard icon={Package} title="Advanced" subtitle="Capabilities, diagnostics, and the 10-stage operator workspace">
        <div className="space-y-6">
          {/* Capabilities per org — live EC-16 split from the preflight check */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Capabilities</p>
              {org && (
                <span className="text-xs font-mono text-slate-400 truncate max-w-[180px]">
                  {org.name}
                </span>
              )}
            </div>
            {!org ? (
              <p className="text-sm text-slate-500">
                Connect a Salesforce org to see which capabilities are available here.{' '}
                <Link href="/login?step=2" className="text-brand-blue font-medium hover:underline">
                  Connect
                </Link>
              </p>
            ) : diagLoading ? (
              <div className="space-y-2.5">
                <div className="h-[62px] rounded-xl bg-brand-surface animate-pulse" />
                <div className="h-[62px] rounded-xl bg-brand-surface/70 animate-pulse" />
              </div>
            ) : diagError ? (
              <p className="text-sm text-slate-500">{diagError}</p>
            ) : diag && diagOrgId === org.id ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <CapabilityChip label="Agents" icon={Bot} status={diag.capability?.agents} />
                <CapabilityChip label="Org Change" icon={Workflow} status={diag.capability?.org_change} />
              </div>
            ) : (
              <p className="text-sm text-slate-400">Loading capabilities…</p>
            )}
          </div>

          {/* Diagnostics: state + checks + re-run (EC-14/EC-16) */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 mb-2.5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex-1">Diagnostics</p>
              <button
                type="button"
                onClick={() => loadDiagnostics(true)}
                disabled={!org || diagRunning || diagLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-brand-border bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-brand-surface transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {diagRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                Run diagnostics
              </button>
            </div>
            {!org ? (
              <p className="text-sm text-slate-500">Connect an org to run the preflight check.</p>
            ) : diagLoading ? (
              <div className="space-y-2">
                <div className="h-4 w-1/3 rounded bg-brand-surface animate-pulse" />
                <div className="h-8 w-full rounded-lg bg-brand-surface/70 animate-pulse" />
                <div className="h-8 w-full rounded-lg bg-brand-surface/50 animate-pulse" />
              </div>
            ) : diagError ? (
              <p className="text-sm text-slate-500">{diagError}</p>
            ) : diag && diagOrgId === org.id ? (
              <div className="rounded-xl border border-brand-border overflow-hidden">
                <div className="px-3.5 py-2.5 bg-brand-surface/40 border-b border-brand-border flex items-center gap-2.5">
                  <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', (STATE_META[diag.state] || STATE_META.ok).className)}>
                    {(STATE_META[diag.state] || STATE_META.ok).label}
                  </span>
                  <span className="text-xs text-slate-400">
                    {diag.cached ? 'cached' : 'fresh'}
                    {diag.checkedAt
                      ? ` · ${new Date(diag.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : ''}
                  </span>
                </div>
                <ul className="divide-y divide-brand-border">
                  <li className="px-3.5 py-2.5 flex items-center gap-2.5 text-sm">
                    {diag.checks?.package?.installed ? (
                      <CheckCircle2 className="w-4 h-4 text-brand-pass shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-brand-warning shrink-0" />
                    )}
                    <span className="text-slate-600 min-w-0">Connector package {diag.checks?.package?.installed ? 'installed' : 'missing'}</span>
                    {diag.checks?.package?.reason && (
                      <span className="text-xs text-slate-400 ml-auto text-right break-words max-w-[60%]">{diag.checks.package.reason}</span>
                    )}
                  </li>
                  <li className="px-3.5 py-2.5 flex items-center gap-2.5 text-sm">
                    {diag.checks?.license?.supported ? (
                      <CheckCircle2 className="w-4 h-4 text-brand-pass shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-brand-warning shrink-0" />
                    )}
                    <span className="text-slate-600 min-w-0">
                      Einstein Agent license {diag.checks?.license?.supported ? 'available' : 'unsupported'}
                    </span>
                    {diag.checks?.license?.reason && (
                      <span className="text-xs text-slate-400 ml-auto text-right break-words max-w-[60%]">{diag.checks.license.reason}</span>
                    )}
                  </li>
                  <li className="px-3.5 py-2.5 flex items-center gap-2.5 text-sm">
                    {diag.checks?.provisioning?.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-brand-pass shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-brand-warning shrink-0" />
                    )}
                    <span className="text-slate-600 min-w-0">Agent user provisioning</span>
                    <span className="text-xs text-slate-400 ml-auto text-right break-words max-w-[60%]">
                      {diag.agentUsername || diag.checks?.provisioning?.agentUsername || (diag.checks?.provisioning?.ok ? 'ready' : 'pending')}
                    </span>
                  </li>
                  <li className="px-3.5 py-2.5 flex items-center gap-2.5 text-sm">
                    {diag.checks?.settings?.agentforceEnabled === true ? (
                      <CheckCircle2 className="w-4 h-4 text-brand-pass shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-brand-warning shrink-0" />
                    )}
                    <span className="text-slate-600 min-w-0">Agentforce + Einstein settings</span>
                    <span className="text-xs text-slate-400 ml-auto text-right break-words max-w-[60%]">
                      {diag.checks?.settings?.agentforceEnabled === false
                        ? diag.checks.settings.reason || 'Enable Agentforce Agent and Einstein in Setup → Agentforce'
                        : diag.checks?.settings?.agentforceEnabled == null
                          ? 'could not verify'
                          : 'enabled'}
                    </span>
                  </li>
                  <li className="px-3.5 py-2.5 flex items-center gap-2.5 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-brand-pass shrink-0" />
                    <span className="text-slate-600 min-w-0">Org type detected</span>
                    <span className="text-xs text-slate-400 font-mono ml-auto text-right break-words max-w-[60%]">
                      {diag.checks?.orgType?.detected || '—'}
                    </span>
                  </li>
                </ul>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Running the preflight check…</p>
            )}
          </div>

          {/* Link to the 10-stage operator workspace (PRD FR-5) */}
          <Link
            href="/workspace"
            className="group flex items-center gap-3 rounded-xl border border-brand-border bg-brand-surface/40 px-4 py-3.5 hover:border-brand-blue/30 hover:bg-brand-blue-light/50 transition-[background-color,border-color] duration-200"
          >
            <span className="w-9 h-9 rounded-xl bg-brand-blue-light flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4.5 h-4.5 text-brand-blue" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-brand-dark">10-stage operator workspace</span>
              <span className="block text-xs text-slate-400">
                Governed flow: intent → artifacts → blast radius → refusal gates → dry-run → deploy → signed audit.
              </span>
            </span>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-brand-blue group-hover:translate-x-0.5 transition-[color,transform]" />
          </Link>

          {/* Technical reference (kept from the original Advanced tab) */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Packaged External Client App</p>
            <p className="mt-1.5 text-sm text-slate-600">
              Org connections use the packaged <span className="font-semibold text-brand-dark">Forge Connector</span>{' '}
              External Client App (OAuth scopes Basic, Api, RefreshToken, OpenID; PKCE + refresh-token rotation
              enforced). Install the connector package once per org — the dashboard surfaces an install prompt when a
              connected org is missing it.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Runtime</p>
            <p className="mt-1.5 text-sm text-slate-600">
              Forge runs a single unified API with the Agent and Org Change capabilities mounted behind feature flags
              (<span className="font-mono text-xs">FORGE_UNIFIED_API</span> /{' '}
              <span className="font-mono text-xs">FORGE_MOUNT_AGENTFORGE</span>). Legacy apps keep running until the
              Phase 5 decommission.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Footer refresh */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            loadOrgs();
            setGhRecheck((k) => k + 1);
            loadDiagnostics(false);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-brand-border bg-white text-sm font-medium text-slate-600 hover:bg-brand-surface transition-colors cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" /> Reload settings
        </button>
      </div>
    </div>
  );
}
