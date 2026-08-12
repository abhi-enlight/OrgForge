'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck, ShieldAlert, Search, RefreshCw, ArrowRight, Sparkles, ChevronDown, ScrollText, Database, GitBranch, Fingerprint, User, Download,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useActiveOrg } from '@/lib/org-context';
import { cn, downloadTextFile } from '@/lib/utils';

interface GateResult {
  gateCode?: string;
  outcome?: string;
  plainLanguageReason?: string;
}

interface ChangeRecord {
  id?: string;
  orgId?: string;
  intentText?: string;
  businessRationale?: string;
  approverIdentity?: string;
  blastRadius?: string | null;
  status?: string;
  signatureHash?: string;
  deploymentId?: string;
  gitCommitHash?: string;
  dryRunId?: string | null;
  impactBrief?: { blastRadiusClassification?: string } | null;
  gateResults?: GateResult[] | null;
  skillsUsed?: string[] | null;
  createdAt?: string;
}

/** A refused gate from the refusal audit trail (GET /api/v1/refusal-logs). */
interface RefusalLog {
  id?: string;
  changeIntentId?: string | null;
  gateCode?: string;
  reason?: string;
  missingEvidence?: string | null;
  unblockPath?: string | null;
  orgId?: string | null;
  intent?: string | null;
  createdAt?: string;
}

/** Normalizes a record status to a badge variant. */
function statusBadge(status?: string): { label: string; variant: 'pass' | 'warning' | 'refused' | 'muted' } {
  const s = String(status || '').toLowerCase();
  if (['deployed', 'succeeded', 'success', 'approved'].includes(s)) return { label: status || 'Deployed', variant: 'pass' };
  if (['refused', 'failed', 'error', 'rejected'].includes(s)) return { label: status || 'Refused', variant: 'refused' };
  if (['pending', 'awaiting_approval', 'draft', 'in_progress'].includes(s)) return { label: status || 'Pending', variant: 'warning' };
  return { label: status || 'Recorded', variant: 'muted' };
}

function blastVariant(r?: string | null): 'warning' | 'info' | 'pass' | 'muted' {
  const s = String(r || '').toLowerCase();
  if (s.includes('high') || s.includes('block')) return 'warning';
  if (s.includes('medium')) return 'info';
  if (s.includes('low')) return 'pass';
  return 'muted';
}

const VARIANT_CLASSES: Record<string, string> = {
  pass: 'bg-brand-pass/10 text-brand-pass',
  warning: 'bg-brand-warning/10 text-brand-warning',
  refused: 'bg-brand-danger/10 text-brand-danger',
  info: 'bg-brand-info/10 text-brand-info',
  muted: 'bg-brand-surface text-slate-500',
};

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', VARIANT_CLASSES[variant] || VARIANT_CLASSES.muted)}>
      {children}
    </span>
  );
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
 * RFC-4180 cell escaping: quotes when the value contains a comma, quote,
 * newline, or carriage return, doubling embedded quotes. (OrgForge only
 * escaped intent/approver; this is the strict form for all evidence fields.)
 */
function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (!/[,"\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Serializes gate results to a compact evidence string: `REF-01 PASS; REF-02 REFUSED — reason`. */
function serializeGateResults(gates?: GateResult[] | null): string {
  return (gates || [])
    .map((g) => {
      const code = g.gateCode ? String(g.gateCode) : 'GATE';
      const outcome = g.outcome ? String(g.outcome).toUpperCase() : '?';
      return `${code} ${outcome}${g.plainLanguageReason ? ` — ${g.plainLanguageReason}` : ''}`;
    })
    .join('; ');
}

/**
 * Builds the full audit-log CSV (OrgForge history convention: `-audit-log-
 * <date>.csv`, header row + one row per record, full list — not the filtered
 * view). Columns carry the signed evidence: rationale, blast radius, gates,
 * dry run, deployment, git commit, HMAC signature, skills.
 */
function buildAuditCsv(records: ChangeRecord[]): string {
  const header = ['ID', 'Org', 'Intent', 'Rationale', 'Blast Radius', 'Status', 'Approver', 'Deployment ID', 'Dry Run ID', 'Git Commit', 'Signature Hash', 'Skills', 'Gates', 'Timestamp'];
  const rows = records.map((r) =>
    [
      r.id ?? '',
      r.orgId ?? '',
      r.intentText ?? '',
      r.businessRationale ?? '',
      r.blastRadius ?? r.impactBrief?.blastRadiusClassification ?? '',
      r.status ?? '',
      r.approverIdentity ?? '',
      r.deploymentId ?? '',
      r.dryRunId ?? '',
      r.gitCommitHash ?? '',
      r.signatureHash ?? '',
      (r.skillsUsed || []).join('; '),
      serializeGateResults(r.gateResults),
      r.createdAt ?? '',
    ].map(csvCell).join(',')
  );
  return `${[header.map(csvCell).join(','), ...rows].join('\n')}\n`;
}

/**
 * Changes & Audit (plan §6.4) — the signed governance trail: every governed
 * org change and (soon, EC-37) agent deploy in one reverse-chronological,
 * read-only list. Search + status filters over GET /api/v1/change-records;
 * each card expands to the signed evidence (rationale, approver, blast
 * radius, gates, signature hash, git commit). Quiet by design — no forms,
 * actions live in chat.
 */
export default function ChangesPage() {
  const { org } = useActiveOrg();
  const [records, setRecords] = useState<ChangeRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pass' | 'warning' | 'refused'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<'records' | 'refusals'>('records');
  const [refusals, setRefusals] = useState<RefusalLog[] | null>(null);
  const [refusalsError, setRefusalsError] = useState<string | null>(null);
  const [refusalsLoading, setRefusalsLoading] = useState(false);
  const [refusalsNote, setRefusalsNote] = useState<string | null>(null);

  const load = async () => {
    try {
      const { records: r } = await apiFetch<{ records: ChangeRecord[] }>('/api/v1/change-records');
      setRecords(Array.isArray(r) ? r : []);
      setError(null);
    } catch (err) {
      setRecords(null);
      setError(err instanceof Error ? err.message : 'Failed to load change records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Deferred so state settles after mount (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Dedicated refusal audit trail (PRD FR-5) — GET /api/v1/refusal-logs.
   * User-scoped (no orgId), consistent with the records view (which lists all
   * of the user's records) — each refusal card shows its org. Passing orgId
   * here would show a mismatched trail for multi-org users.
   */
  const loadRefusals = async () => {
    setRefusalsLoading(true);
    try {
      const data = await apiFetch<{ refusals: RefusalLog[]; note?: string }>('/api/v1/refusal-logs');
      setRefusals(Array.isArray(data.refusals) ? data.refusals : []);
      setRefusalsNote(data.note ?? null);
      setRefusalsError(null);
    } catch (err) {
      setRefusals(null);
      setRefusalsError(err instanceof Error ? err.message : 'Failed to load refusals');
    } finally {
      setRefusalsLoading(false);
    }
  };

  // Load refusals lazily on first switch to the Refusals tab (a failed load
  // leaves refusals null, so re-entering the tab refetches). Deferred so state
  // settles after mount (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (view !== 'refusals' || refusals !== null) return;
    const timer = setTimeout(() => {
      loadRefusals();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const refresh = async () => {
    setRefreshing(true);
    if (view === 'refusals') {
      await loadRefusals();
    } else {
      await load();
    }
    setRefreshing(false);
  };

  /** Full-log CSV export (OrgForge history convention) — the signed evidence trail. */
  const handleExport = () => {
    if (!records || records.length === 0) return;
    // Synchronous client-side download — no spinner needed (React would batch
    // any loading state into the same tick, making it dead code).
    downloadTextFile(
      `forge-audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      buildAuditCsv(records),
      'text/csv'
    );
  };

  const filtered = (records || []).filter((r) => {
    const q = query.trim().toLowerCase();
    const text = `${r.intentText ?? ''} ${r.businessRationale ?? ''} ${r.approverIdentity ?? ''} ${r.orgId ?? ''}`.toLowerCase();
    if (q && !text.includes(q)) return false;
    if (statusFilter === 'all') return true;
    return statusBadge(r.status).variant === statusFilter;
  });

  // ── No org + nothing loaded → one connect CTA (same rule as the other pages) ──
  if (!loading && !org && (!records || records.length === 0)) {
    return (
      <div className="max-w-3xl mx-auto pt-16 md:pt-24 flex flex-col items-center text-center animate-fade-in">
        <div className="w-14 h-14 rounded-2xl bg-brand-blue-light flex items-center justify-center mb-6 shadow-glow">
          <Database className="w-7 h-7 text-brand-blue" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-brand-dark tracking-tight">
          Connect Salesforce to see your audit trail
        </h1>
        <p className="mt-3 text-slate-500 max-w-md">
          Every governed change gets a signed, tamper-evident record here — approvals, blast radius, gates, and the
          final deployment.
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

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      {/* Header row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-brand-dark tracking-tight">Changes & Audit</h1>
          <p className="mt-1 text-slate-500">Every governed change and deployment, in one signed record trail.</p>
        </div>
        <div className="flex items-center gap-2.5">
          {view === 'records' && (
            <button
              type="button"
              onClick={handleExport}
              disabled={!records || records.length === 0}
              title={!records || records.length === 0 ? 'Nothing to export yet' : 'Export the full audit log (all records, not just this filter)'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-brand-border bg-white text-sm font-medium text-slate-600 hover:bg-brand-surface transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Export Full Log
            </button>
          )}
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
            <Sparkles className="w-4 h-4" /> Ask Forge
          </Link>
        </div>
      </div>

      {/* View toggle — Records (signed trail) | Refusals (blocked gates) */}
      <div className="flex items-center gap-1.5">
        {([
          ['records', 'Records'],
          ['refusals', 'Refusals'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setView(value)}
            className={cn(
              'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
              view === value
                ? 'bg-brand-blue text-white shadow-glow'
                : 'bg-white border border-brand-border text-slate-500 hover:bg-brand-surface'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'records' ? (
        <>
      {/* Filters — quiet; hidden when there are no records */}
      {records !== null && records.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search intent, approver, org…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-brand-border bg-white text-sm text-brand-dark placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue/50 transition-shadow"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {([
              ['all', 'All'],
              ['pass', 'Deployed'],
              ['warning', 'Pending'],
              ['refused', 'Refused'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                  statusFilter === value
                    ? 'bg-brand-blue text-white shadow-glow'
                    : 'bg-white border border-brand-border text-slate-500 hover:bg-brand-surface'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error banner — one inline banner, one action */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-brand-warning/30 bg-brand-warning-bg px-5 py-4 animate-slide-up">
          <RefreshCw className="w-4 h-4 text-brand-warning shrink-0" />
          <p className="text-sm text-slate-700 flex-1">Couldn&apos;t load the audit trail — {error}</p>
          <button type="button" onClick={refresh} className="text-sm font-semibold text-brand-warning hover:underline cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {/* Record list */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-brand-border bg-white p-5 shadow-soft">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-brand-surface animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 rounded bg-brand-surface animate-pulse" />
                  <div className="h-3 w-1/3 rounded bg-brand-surface/70 animate-pulse" />
                </div>
              </div>
              <div className="h-3 w-full rounded bg-brand-surface/50 animate-pulse" />
            </div>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <ul className="space-y-3">
          {filtered.map((record) => {
            const id = record.id || record.deploymentId || record.createdAt || 'record';
            const expanded = expandedId === id;
            const badge = statusBadge(record.status);
            const radius = record.blastRadius ?? record.impactBrief?.blastRadiusClassification ?? null;
            const intent = record.intentText || 'Governed change';
            return (
              <li
                key={id}
                className={cn(
                  'rounded-2xl border bg-white shadow-soft transition-[box-shadow,border-color] duration-200',
                  expanded ? 'border-brand-blue/30 shadow-card-hover' : 'border-brand-border hover:border-brand-blue/20'
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : id)}
                  className="w-full text-left px-5 py-4 flex items-center gap-4 cursor-pointer"
                  aria-expanded={expanded}
                >
                  <span className="w-9 h-9 rounded-xl bg-brand-blue-light flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4 text-brand-blue" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <p className="text-sm font-semibold text-brand-dark truncate">{intent}</p>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      {record.orgId ? <span className="font-mono">{record.orgId}</span> : 'org'}
                      {record.approverIdentity ? ` · approved by ${record.approverIdentity}` : ''}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">{timeAgo(record.createdAt)}</span>
                  <ChevronDown className={cn('w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200', expanded && 'rotate-180')} />
                </button>

                {expanded && (
                  <div className="px-5 pb-5 border-t border-brand-border animate-fade-in">
                    {/* Evidence grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
                      {record.businessRationale && (
                        <div className="sm:col-span-2">
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Rationale</p>
                          <p className="mt-1 text-sm text-slate-600">{record.businessRationale}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Blast radius</p>
                        {radius ? (
                          <div className="mt-1.5">
                            <Badge variant={blastVariant(radius)}>{radius}</Badge>
                          </div>
                        ) : (
                          <p className="mt-1 text-sm text-slate-400">—</p>
                        )}
                      </div>
                      {record.approverIdentity && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                            <User className="w-3 h-3" /> Approver
                          </p>
                          <p className="mt-1 text-sm text-slate-600 truncate">{record.approverIdentity}</p>
                        </div>
                      )}
                      {record.deploymentId && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Deployment</p>
                          <p className="mt-1 text-xs font-mono text-slate-600 truncate">{record.deploymentId}</p>
                        </div>
                      )}
                      {record.dryRunId && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Dry run</p>
                          <p className="mt-1 text-xs font-mono text-slate-600 truncate">{record.dryRunId}</p>
                        </div>
                      )}
                      {record.gitCommitHash && (
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                            <GitBranch className="w-3 h-3" /> Git commit
                          </p>
                          <p className="mt-1 text-xs font-mono text-brand-blue truncate">{record.gitCommitHash}</p>
                        </div>
                      )}
                    </div>

                    {/* Gate results */}
                    {Array.isArray(record.gateResults) && record.gateResults.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Refusal gates</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {record.gateResults.map((g, i) => (
                            <span
                              key={g.gateCode || i}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium',
                                String(g.outcome || '').toLowerCase() === 'pass' ? 'bg-brand-pass/10 text-brand-pass' : 'bg-brand-danger/10 text-brand-danger'
                              )}
                            >
                              {g.gateCode || 'gate'}
                              {g.outcome ? ` · ${g.outcome}` : ''}
                              {g.plainLanguageReason ? ` — ${g.plainLanguageReason}` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Skills + signature */}
                    <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      {Array.isArray(record.skillsUsed) && record.skillsUsed.length > 0 ? (
                        <p className="text-xs text-slate-400">
                          Skills: <span className="font-mono">{record.skillsUsed.join(', ')}</span>
                        </p>
                      ) : (
                        <span />
                      )}
                      {record.signatureHash && (
                        <p className="inline-flex items-center gap-1.5 text-xs text-slate-400" title="Tamper-evident signature">
                          <Fingerprint className="w-3.5 h-3.5" />
                          <span className="font-mono">{record.signatureHash}</span>
                        </p>
                      )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-brand-border flex items-center justify-between">
                      <span className="text-xs text-slate-400">Actions live in chat</span>
                      <Link
                        href={`/chat?prompt=${encodeURIComponent(`What happened with "${intent}"? Show me the details.`)}`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                      >
                        Discuss in chat <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : error ? null : (
        <div className="rounded-2xl border border-brand-border bg-white px-5 py-12 text-center shadow-soft">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-surface mb-4">
            <ScrollText className="w-6 h-6 text-slate-400" />
          </span>
          <p className="text-sm text-slate-500">
            {query.trim() || statusFilter !== 'all'
              ? 'No records match your filters.'
              : 'No governed changes yet — every deployment gets a signed record here.'}{' '}
            <Link href="/chat?prompt=Add%20a%20validation%20rule%20to%20Opportunity" className="text-brand-blue font-medium hover:underline">
              Request a governed change
            </Link>
          </p>
        </div>
      )}
        </>
      ) : (
        /* ── Refusals view: the dedicated refusal audit trail (PRD FR-5) ── */
        <div className="space-y-3">
          {refusalsError ? (
            <div className="flex items-center gap-3 rounded-2xl border border-brand-warning/30 bg-brand-warning-bg px-5 py-4 animate-slide-up">
              <RefreshCw className="w-4 h-4 text-brand-warning shrink-0" />
              <p className="text-sm text-slate-700 flex-1">Couldn&apos;t load refusals — {refusalsError}</p>
              <button type="button" onClick={loadRefusals} className="text-sm font-semibold text-brand-warning hover:underline cursor-pointer">
                Retry
              </button>
            </div>
          ) : refusalsLoading && !refusals ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="rounded-2xl border border-brand-border bg-white p-5 shadow-soft">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-xl bg-brand-danger/10 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-2/3 rounded bg-brand-surface animate-pulse" />
                      <div className="h-3 w-1/2 rounded bg-brand-surface/70 animate-pulse" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : refusals && refusals.length > 0 ? (
            <ul className="space-y-3">
              {refusals.map((ref) => {
                const gate = ref.gateCode || 'GATE';
                const prompt = `Explain the ${gate} refusal: ${ref.reason ?? ''} — how do I unblock it?`;
                return (
                  <li
                    key={ref.id || `${gate}-${ref.createdAt ?? ''}`}
                    className="rounded-2xl border border-brand-danger/20 bg-white p-5 shadow-soft hover:border-brand-danger/40 transition-[box-shadow,border-color] duration-200"
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-9 h-9 rounded-xl bg-brand-danger/10 flex items-center justify-center shrink-0">
                        <ShieldAlert className="w-4 h-4 text-brand-danger" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <Badge variant="refused">{gate} · Refused</Badge>
                          {ref.orgId && <span className="text-xs font-mono text-slate-400">{ref.orgId}</span>}
                          <span className="text-xs text-slate-400 shrink-0 ml-auto">{timeAgo(ref.createdAt)}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-700">{ref.reason}</p>
                        {(ref.missingEvidence || ref.unblockPath) && (
                          <div className="mt-2 space-y-1 text-xs text-slate-500">
                            {ref.missingEvidence && (
                              <p>
                                <span className="font-semibold text-slate-600">Missing evidence:</span> {ref.missingEvidence}
                              </p>
                            )}
                            {ref.unblockPath && (
                              <p>
                                <span className="font-semibold text-slate-600">Unblock:</span> {ref.unblockPath}
                              </p>
                            )}
                          </div>
                        )}
                        {ref.intent && <p className="mt-2 text-xs text-slate-400 truncate">&ldquo;{ref.intent}&rdquo;</p>}
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-brand-border flex items-center justify-between">
                      <span className="text-xs text-slate-400">Fix the cause, then re-request in chat</span>
                      <Link
                        href={`/chat?prompt=${encodeURIComponent(prompt)}`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
                      >
                        Discuss in chat <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-2xl border border-brand-border bg-white px-5 py-12 text-center shadow-soft">
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-surface mb-4">
                <ShieldAlert className="w-6 h-6 text-slate-400" />
              </span>
              <p className="text-sm text-slate-500">
                No refusals recorded — every blocked change shows up here with the plain-language reason and how to unblock it.
              </p>
              {refusalsNote && <p className="mt-2 text-xs text-slate-400">{refusalsNote}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
