'use client';

import React from 'react';
import {
  FileCode2, Radar, ShieldCheck, ShieldAlert, FlaskConical, Rocket, Fingerprint, GitBranch, CheckCircle2, XCircle, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/lib/chat-stream';

/** Shared gate/result chip shape. */
interface GateResult {
  gateCode?: string;
  outcome?: string;
  plainLanguageReason?: string;
  missingEvidence?: string;
  unblockPath?: string;
}

interface ArtifactFile {
  filePath?: string;
  metadataType?: string;
  fullName?: string;
}

const CARD_TITLES: Record<string, string> = {
  artifact: 'Artifact',
  blast_radius: 'Blast radius',
  refusal_gates: 'Refusal gates',
  dry_run: 'Dry run',
  deploy: 'Deployment',
  record: 'Audit record',
};

function Pill({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'pass' | 'warning' | 'refused' | 'info' | 'muted' }) {
  const tones: Record<string, string> = {
    pass: 'bg-brand-pass/10 text-brand-pass',
    warning: 'bg-brand-warning/10 text-brand-warning',
    refused: 'bg-brand-danger/10 text-brand-danger',
    info: 'bg-brand-info/10 text-brand-info',
    muted: 'bg-brand-surface text-slate-500',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap', tones[tone] || tones.muted)}>
      {children}
    </span>
  );
}

/** Blast radius classification → tone. */
function radiusTone(r?: string): 'warning' | 'info' | 'pass' | 'muted' {
  const s = String(r || '').toLowerCase();
  if (s.includes('high') || s.includes('block')) return 'warning';
  if (s.includes('medium')) return 'info';
  if (s.includes('low')) return 'pass';
  return 'muted';
}

/** Pulls flat numeric/string metrics out of the impact brief for display. */
function metricsOf(payload: unknown): Array<{ label: string; value: string | number }> {
  const out: Array<{ label: string; value: string | number }> = [];
  if (!payload || typeof payload !== 'object') return out;
  const p = payload as Record<string, unknown>;
  // REF-05 context: surface records the change would violate (nested dataImpact).
  const dataImpact = p.dataImpact as Record<string, unknown> | undefined;
  if (dataImpact && typeof dataImpact.violatingRecords === 'number') {
    out.push({ label: 'records affected', value: dataImpact.violatingRecords });
  }
  for (const [key, value] of Object.entries(p)) {
    if (key === 'blastRadiusClassification' || key === 'dataImpact') continue;
    if (typeof value === 'number' || typeof value === 'string') {
      out.push({
        label: key
          .replace(/Count$/, '')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .toLowerCase(),
        value,
      });
    }
  }
  return out.slice(0, 4);
}

/**
 * Inline org-change card (§6.3) — renders one of the unified SSE card payloads
 * (artifact / blast_radius / refusal_gates / dry_run / deploy / record) in the
 * Copilot conversation. Every payload renders a Forge-styled card; unknown
 * card types degrade to a simple summary card.
 */
export default function OrgChangeCard({ msg }: { msg: ChatMessage }) {
  const { card, content, payload } = msg;
  const title = CARD_TITLES[card || ''] || 'Org change';
  const p = (payload || {}) as Record<string, unknown>;

  // ── Artifact ───────────────────────────────────────────────────────────
  if (card === 'artifact') {
    const files = (p.files as ArtifactFile[]) || [];
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] bg-white border border-brand-border rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-brand-border flex items-center gap-2.5 bg-brand-surface/30">
            <FileCode2 className="w-4 h-4 text-brand-blue shrink-0" />
            <span className="text-sm font-semibold text-brand-dark min-w-0 truncate">{title}</span>
            {p.operation ? <Pill tone="info">{String(p.operation)}</Pill> : null}
          </div>
          <div className="p-4 space-y-2.5">
            <p className="text-xs text-slate-500">{content}</p>
            {files.map((f, i) => (
              <div key={i} className="rounded-xl border border-brand-border bg-brand-surface/40 px-3.5 py-2.5">
                <p className="text-xs font-mono text-brand-dark truncate">{f.filePath || f.fullName || 'artifact'}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {f.metadataType && <Pill tone="info">{f.metadataType}</Pill>}
                  {f.fullName && <span className="text-xs text-slate-400 font-mono truncate">{f.fullName}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Blast radius ───────────────────────────────────────────────────────
  if (card === 'blast_radius') {
    const radius = String(p.blastRadiusClassification || 'Unknown');
    const metrics = metricsOf(payload);
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] bg-white border border-brand-border rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-brand-border flex items-center gap-2.5 bg-brand-surface/30">
            <Radar className="w-4 h-4 text-brand-blue shrink-0" />
            <span className="text-sm font-semibold text-brand-dark min-w-0 truncate">{title}</span>
            <Pill tone={radiusTone(radius)}>{radius}</Pill>
          </div>
          <div className="p-4">
            <p className="text-xs text-slate-500 mb-3">{content}</p>
            {metrics.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {metrics.map((m) => (
                  <div key={m.label} className="rounded-xl border border-brand-border bg-brand-surface/40 px-3 py-2.5 text-center">
                    <p className="text-base font-bold text-brand-dark">{m.value}</p>
                    <p className="text-[11px] text-slate-400 capitalize">{m.label}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Impact analysis completed for this org.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Refusal gates ──────────────────────────────────────────────────────
  if (card === 'refusal_gates') {
    const gateOutcome = String(p.gateOutcome || '');
    const results = (p.results as GateResult[]) || [];
    const refused = gateOutcome !== 'PASS';
    // Split refused vs passed so the reasons that blocked the change lead the
    // card — passed gates collapse into a compact footer instead of burying
    // the refusals in a wall of 10 rows.
    const refusedGates = results.filter((g) => String(g.outcome || '').toUpperCase() !== 'PASS');
    const passedGates = results.filter((g) => String(g.outcome || '').toUpperCase() === 'PASS');
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] bg-white border border-brand-border rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
          <div
            className={cn(
              'px-4 py-3 border-b flex items-center gap-2.5',
              refused ? 'border-brand-danger/20 bg-brand-danger/5' : 'border-brand-pass/20 bg-brand-pass/5'
            )}
          >
            {refused ? <ShieldAlert className="w-4 h-4 text-brand-danger shrink-0" /> : <ShieldCheck className="w-4 h-4 text-brand-pass shrink-0" />}
            <span className="text-sm font-semibold text-brand-dark min-w-0 truncate">{title}</span>
            <Pill tone={refused ? 'refused' : 'pass'}>{refused ? 'Refused' : 'All passed'}</Pill>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-slate-500">{content}</p>

            {refusedGates.length > 0 && (
              <ul className="space-y-2.5">
                {refusedGates.map((g, i) => (
                  <li key={g.gateCode || i} className="rounded-xl border border-brand-danger/30 bg-brand-danger/5 px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-3.5 h-3.5 text-brand-danger shrink-0" />
                      <span className="text-xs font-mono font-semibold text-brand-dark">{g.gateCode || 'gate'}</span>
                      <span className="text-[11px] font-semibold text-brand-danger">{g.outcome}</span>
                    </div>
                    {g.plainLanguageReason && <p className="mt-1.5 text-xs text-slate-700 leading-relaxed">{g.plainLanguageReason}</p>}
                    {g.missingEvidence && (
                      <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                        <span className="font-semibold text-brand-danger">Evidence required:</span> {g.missingEvidence}
                      </p>
                    )}
                    {g.unblockPath && (
                      <p className="mt-1 text-[11px] text-brand-blue leading-snug">
                        <span className="font-semibold">Unblock:</span> {g.unblockPath}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {passedGates.length > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] text-slate-400 leading-snug">
                <CheckCircle2 className="w-3 h-3 text-brand-pass shrink-0 mt-px" />
                <span>
                  {passedGates.length} gate{passedGates.length === 1 ? '' : 's'} passed:{' '}
                  <span className="font-mono">{passedGates.map((g) => g.gateCode || 'gate').join(', ')}</span>
                </span>
              </p>
            )}

            {results.length === 0 && <p className="text-xs text-slate-400">No gate results.</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── Dry run / Deploy ───────────────────────────────────────────────────
  if (card === 'dry_run' || card === 'deploy') {
    const success = p.success !== false;
    const errors = (p.errors as Array<{ component?: string; problem?: string }>) || [];
    const isDeploy = card === 'deploy';
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] bg-white border border-brand-border rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
          <div className={cn('px-4 py-3 border-b flex items-center gap-2.5', success ? 'border-brand-pass/20 bg-brand-pass/5' : 'border-brand-danger/20 bg-brand-danger/5')}>
            {isDeploy ? <Rocket className={cn('w-4 h-4 shrink-0', success ? 'text-brand-pass' : 'text-brand-danger')} /> : <FlaskConical className={cn('w-4 h-4 shrink-0', success ? 'text-brand-pass' : 'text-brand-danger')} />}
            <span className="text-sm font-semibold text-brand-dark min-w-0 truncate">{title}</span>
            <Pill tone={success ? 'pass' : 'refused'}>{success ? (isDeploy ? 'Deployed' : 'Passed') : 'Failed'}</Pill>
          </div>
          <div className="p-4 space-y-2.5">
            <p className="text-xs text-slate-500">{content}</p>
            {p.deploymentId ? (
              <p className="text-xs text-slate-400">
                Deployment <span className="font-mono text-brand-blue">{String(p.deploymentId)}</span>
                {p.status ? ` · ${String(p.status)}` : ''}
              </p>
            ) : null}
            {errors.length > 0 && (
              <ul className="space-y-1.5">
                {errors.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-brand-danger">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      {e.component ? <span className="font-mono">{e.component}: </span> : null}
                      {e.problem || 'Deployment failed'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Record ─────────────────────────────────────────────────────────────
  if (card === 'record') {
    const persisted = p.persisted !== false;
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] bg-white border border-brand-border rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
          <div className={cn('px-4 py-3 border-b flex items-center gap-2.5', persisted ? 'border-brand-pass/20 bg-brand-pass/5' : 'border-brand-warning/20 bg-brand-warning/5')}>
            <Fingerprint className={cn('w-4 h-4 shrink-0', persisted ? 'text-brand-pass' : 'text-brand-warning')} />
            <span className="text-sm font-semibold text-brand-dark min-w-0 truncate">{title}</span>
            <Pill tone={persisted ? 'pass' : 'warning'}>{persisted ? 'Signed' : 'Not saved'}</Pill>
          </div>
          <div className="p-4 space-y-2.5">
            <p className="text-xs text-slate-500">{content}</p>
            {p.signatureHash ? (
              <p className="flex items-center gap-1.5 text-xs text-slate-400" title="Tamper-evident signature">
                <Fingerprint className="w-3.5 h-3.5" />
                <span className="font-mono break-all">{String(p.signatureHash)}</span>
              </p>
            ) : null}
            {p.gitCommitHash ? (
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <GitBranch className="w-3.5 h-3.5" />
                <span className="font-mono">{String(p.gitCommitHash)}</span>
              </p>
            ) : persisted ? (
              <p className="text-xs text-slate-400">Saved locally (no GitHub destination configured).</p>
            ) : null}
            {!persisted && p.reason ? <p className="text-xs text-brand-danger">{String(p.reason)}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  // ── Fallback ───────────────────────────────────────────────────────────
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-brand-border rounded-2xl rounded-tl-sm px-4 py-3 max-w-[90%] shadow-sm">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{title}</p>
        <p className="mt-1 text-sm text-slate-600">{content}</p>
      </div>
    </div>
  );
}
