'use client';

import React, { useState } from 'react';
import {
  FileCode2,
  Radar,
  ShieldCheck,
  ShieldAlert,
  FlaskConical,
  Rocket,
  Fingerprint,
  GitBranch,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
  HelpCircle,
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
  artifact: 'Proposed Change',
  blast_radius: 'Safety & Org Impact',
  refusal_gates: 'Review & Governance',
  dry_run: 'Simulation Check',
  deploy: 'Deployment',
  record: 'Audit Trail',
};

const GATE_TITLES: Record<string, string> = {
  'REF-01': 'Org Impact Scan',
  'REF-02': 'Simulation Check',
  'REF-03': 'Security & Code Scan',
  'REF-04': 'Approval Required',
  'REF-05': 'Existing Records Conflict',
  'REF-06': 'Deletion Safeguard',
  'REF-07': 'Production Safeguard',
  'REF-08': 'Protected Package Safeguard',
  'REF-09': 'System Rule Verification',
  'REF-10': 'Quick Clarification Needed',
};

function formatOpName(op?: string): string {
  if (!op) return 'Metadata Change';
  const clean = op.replace(/^(CREATE|UPDATE|DELETE)_/, '');
  const prefix = op.startsWith('CREATE') ? 'New ' : op.startsWith('DELETE') ? 'Delete ' : 'Update ';
  return `${prefix}${clean.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}`;
}

function Pill({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'pass' | 'warning' | 'refused' | 'info' | 'muted';
}) {
  const tones: Record<string, string> = {
    pass: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
    warning: 'bg-amber-50 text-amber-800 border border-amber-200/80',
    refused: 'bg-rose-50 text-rose-700 border border-rose-200/80',
    info: 'bg-blue-50 text-brand-blue border border-blue-200/80',
    muted: 'bg-slate-50 text-slate-600 border border-slate-200',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', tones[tone] || tones.muted)}>
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

function parseAmbiguityOptions(text?: string): Array<{ title: string; desc: string; prompt: string }> {
  if (!text) return [];
  // Split on semicolons or option delimiters
  const segments = text.split(/;\s*|(?=Option \d+:)/i).map((s) => s.trim()).filter(Boolean);
  const options: Array<{ title: string; desc: string; prompt: string }> = [];

  for (const seg of segments) {
    const colonIdx = seg.indexOf(':');
    if (colonIdx > 0 && colonIdx < 80) {
      const title = seg.slice(0, colonIdx).replace(/^(Unresolved ambiguities in intent:\s*|Option \d+:\s*)/i, '').trim();
      const desc = seg.slice(colonIdx + 1).trim();
      options.push({
        title,
        desc,
        prompt: `Let's proceed with: "${title}". ${desc}`,
      });
    } else if (seg.length > 5 && !seg.toLowerCase().startsWith('unresolved ambiguities')) {
      options.push({
        title: seg,
        desc: '',
        prompt: `Let's proceed with: ${seg}`,
      });
    }
  }

  return options;
}

/**
 * Inline org-change card — simplifies complex Salesforce internals for business users
 * while preserving full audit details for developers.
 */
export default function OrgChangeCard({ msg }: { msg: ChatMessage }) {
  const { card, content, payload } = msg;
  const title = CARD_TITLES[card || ''] || 'Org Change';
  const p = (payload || {}) as Record<string, unknown>;
  const [showTechDetails, setShowTechDetails] = useState(false);

  // ── 1. Artifact Card ───────────────────────────────────────────────────
  if (card === 'artifact') {
    const files = (p.files as ArtifactFile[]) || [];
    const op = String(p.operation || '');
    const targetComp = String(p.targetComponent || 'Salesforce Object');
    const displayOp = formatOpName(op);

    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden transition-all">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2.5 bg-slate-50/60">
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1 rounded-lg bg-blue-100/70 text-brand-blue">
                <FileCode2 className="w-4 h-4" />
              </span>
              <span className="text-sm font-bold text-slate-900 truncate">{title}</span>
            </div>
            <Pill tone="info">{displayOp}</Pill>
          </div>

          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50/80 border border-slate-200/60">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate">
                  {targetComp}
                  {files[0]?.fullName && files[0].fullName !== targetComp ? ` → ${files[0].fullName}` : ''}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {files[0]?.metadataType || 'Component'} ready for validation in your connected org
                </p>
              </div>
            </div>

            {/* Collapsible Tech Details for Devs */}
            {files.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowTechDetails(!showTechDetails)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  {showTechDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  <span>{showTechDetails ? 'Hide technical file path' : 'Show technical file path'}</span>
                </button>

                {showTechDetails && (
                  <div className="mt-2 p-2.5 rounded-lg bg-slate-900 text-slate-200 font-mono text-[11px] overflow-x-auto">
                    {files.map((f, i) => (
                      <p key={i} className="truncate">{f.filePath || f.fullName}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 2. Blast Radius (Impact Analysis) ──────────────────────────────────
  if (card === 'blast_radius') {
    const radius = String(p.blastRadiusClassification || 'Low');
    const narrative = typeof p.summaryNarrative === 'string' && p.summaryNarrative.trim() ? p.summaryNarrative : null;
    const dep = p.dependencyImpact as Record<string, unknown> | undefined;
    const data = p.dataImpact as Record<string, unknown> | undefined;
    const perm = p.permissionImpact as Record<string, unknown> | undefined;

    const violatingRecords = Number(data?.violatingRecordsCount || 0);
    const affectedWorkflows = Number(dep?.referencingComponentsCount || 0);
    const affectedUsers = Number(perm?.affectedUsersCount || 0);

    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2.5 bg-slate-50/60">
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1 rounded-lg bg-emerald-100/70 text-emerald-700">
                <Radar className="w-4 h-4" />
              </span>
              <span className="text-sm font-bold text-slate-900 truncate">{title}</span>
            </div>
            <Pill tone={radiusTone(radius)}>
              {radius.toLowerCase() === 'low' ? 'Low Risk ✅' : `${radius} Risk`}
            </Pill>
          </div>

          <div className="p-4 space-y-3.5">
            {narrative && (
              <p className="text-xs text-slate-700 leading-relaxed font-sans">
                {narrative}
              </p>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-2.5 text-center">
                <p className="text-base font-bold text-slate-900">{violatingRecords}</p>
                <p className="text-[11px] text-slate-500 font-medium">Existing Records Blocked</p>
              </div>
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-2.5 text-center">
                <p className="text-base font-bold text-slate-900">{affectedWorkflows}</p>
                <p className="text-[11px] text-slate-500 font-medium">Workflows Affected</p>
              </div>
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-2.5 text-center">
                <p className="text-base font-bold text-slate-900">{affectedUsers}</p>
                <p className="text-[11px] text-slate-500 font-medium">Users Disrupted</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 3. Refusal Gates (Review & Clarifications) ──────────────────────────
  if (card === 'refusal_gates') {
    const gateOutcome = String(p.gateOutcome || '');
    const results = (p.results as GateResult[]) || [];
    const refused = gateOutcome !== 'PASS';
    const refusedGates = results.filter((g) => String(g.outcome || '').toUpperCase() !== 'PASS');
    const passedGates = results.filter((g) => String(g.outcome || '').toUpperCase() === 'PASS');

    const handleSelectOption = (promptText: string) => {
      window.dispatchEvent(new CustomEvent('orgforge:fill-prompt', { detail: promptText }));
    };

    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
          <div
            className={cn(
              'px-4 py-3 border-b flex items-center justify-between gap-2.5',
              refused ? 'border-amber-200/60 bg-amber-50/60' : 'border-emerald-200/60 bg-emerald-50/60'
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              {refused ? (
                <span className="p-1 rounded-lg bg-amber-100 text-amber-700">
                  <ShieldAlert className="w-4 h-4" />
                </span>
              ) : (
                <span className="p-1 rounded-lg bg-emerald-100 text-emerald-700">
                  <ShieldCheck className="w-4 h-4" />
                </span>
              )}
              <span className="text-sm font-bold text-slate-900 truncate">{title}</span>
            </div>
            <Pill tone={refused ? 'warning' : 'pass'}>
              {refused ? 'Review Needed' : 'All Safeguards Passed'}
            </Pill>
          </div>

          <div className="p-4 space-y-3.5">
            {refusedGates.length > 0 && (
              <div className="space-y-3">
                {refusedGates.map((g, i) => {
                  const gateCode = g.gateCode || 'REF-10';
                  const friendlyTitle = GATE_TITLES[gateCode] || 'Attention Required';
                  const isAmbiguity = gateCode === 'REF-10';
                  const options = isAmbiguity ? parseAmbiguityOptions(g.plainLanguageReason) : [];

                  return (
                    <div
                      key={gateCode || i}
                      className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-4 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span className="text-xs font-bold text-slate-900">{friendlyTitle}</span>
                        </div>
                        <span className="text-[10px] font-mono font-medium text-slate-400 bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                          {gateCode}
                        </span>
                      </div>

                      {/* Plain Language Reason */}
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {g.plainLanguageReason?.replace(/^Unresolved ambiguities in intent:\s*/i, '')}
                      </p>

                      {/* Interactive Choice Buttons for REF-10 */}
                      {options.length > 0 && (
                        <div className="mt-3 space-y-2 pt-2 border-t border-amber-200/60">
                          <p className="text-[11px] font-semibold text-slate-800 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-brand-blue" />
                            Click an option below to apply:
                          </p>
                          <div className="grid grid-cols-1 gap-2">
                            {options.map((opt, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleSelectOption(opt.prompt)}
                                className="group w-full text-left p-3 rounded-xl border border-blue-200 bg-white hover:bg-blue-50/80 hover:border-brand-blue transition-all flex items-start justify-between gap-3 shadow-xs cursor-pointer"
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-bold text-brand-blue">
                                      Option {idx + 1}:
                                    </span>
                                    <span className="text-xs font-semibold text-slate-900">
                                      {opt.title}
                                    </span>
                                  </div>
                                  {opt.desc && (
                                    <p className="text-[11px] text-slate-500 leading-snug">
                                      {opt.desc}
                                    </p>
                                  )}
                                </div>
                                <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-brand-blue transition-colors shrink-0 mt-1" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Standard Unblock Action if not interactive */}
                      {!options.length && g.unblockPath && (
                        <div className="p-2.5 rounded-lg bg-white/90 border border-amber-200 text-xs text-slate-700">
                          <span className="font-bold text-amber-800">How to proceed:</span> {g.unblockPath}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {passedGates.length > 0 && (
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>
                  {passedGates.length} security &amp; safety check{passedGates.length === 1 ? '' : 's'} passed successfully.
                </span>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 4. Simulation / Deployment ──────────────────────────────────────────
  if (card === 'dry_run' || card === 'deploy') {
    const success = p.success !== false;
    const errors = (p.errors as Array<{ component?: string; problem?: string }>) || [];
    const isDeploy = card === 'deploy';
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
          <div
            className={cn(
              'px-4 py-3 border-b flex items-center justify-between gap-2.5',
              success ? 'border-emerald-200/60 bg-emerald-50/60' : 'border-rose-200/60 bg-rose-50/60'
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              {isDeploy ? (
                <span className={cn('p-1 rounded-lg', success ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>
                  <Rocket className="w-4 h-4" />
                </span>
              ) : (
                <span className={cn('p-1 rounded-lg', success ? 'bg-blue-100 text-brand-blue' : 'bg-rose-100 text-rose-700')}>
                  <FlaskConical className="w-4 h-4" />
                </span>
              )}
              <span className="text-sm font-bold text-slate-900 truncate">{title}</span>
            </div>
            <Pill tone={success ? 'pass' : 'refused'}>
              {success ? (isDeploy ? 'Live in Org' : 'Simulation Passed') : 'Issues Found'}
            </Pill>
          </div>

          <div className="p-4 space-y-2.5">
            <p className="text-xs text-slate-600">
              {success
                ? isDeploy
                  ? 'Successfully published and active in your Salesforce organization.'
                  : 'Pre-deployment simulation succeeded without any schema conflicts.'
                : content || 'The simulation identified issues.'}
            </p>

            {errors.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {errors.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-rose-700 p-2.5 rounded-lg bg-rose-50 border border-rose-200">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-600" />
                    <span>
                      {e.component ? <span className="font-semibold">{e.component}: </span> : null}
                      {e.problem || 'Deployment error'}
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

  // ── 5. Audit Trail Record ──────────────────────────────────────────────
  if (card === 'record') {
    const persisted = p.persisted !== false;
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[90%] bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
          <div
            className={cn(
              'px-4 py-3 border-b flex items-center justify-between gap-2.5',
              persisted ? 'border-emerald-200/60 bg-emerald-50/60' : 'border-amber-200/60 bg-amber-50/60'
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1 rounded-lg bg-slate-100 text-slate-700">
                <Fingerprint className="w-4 h-4" />
              </span>
              <span className="text-sm font-bold text-slate-900 truncate">{title}</span>
            </div>
            <Pill tone={persisted ? 'pass' : 'warning'}>{persisted ? 'Cryptographically Signed' : 'Pending'}</Pill>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-xs text-slate-600">
              {persisted ? 'Change record logged with cryptographic tamper-evident signature.' : String(content)}
            </p>
            {p.gitCommitHash ? (
              <p className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
                <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                <span>Commit: {String(p.gitCommitHash).slice(0, 12)}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // ── Fallback ───────────────────────────────────────────────────────────
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 max-w-[90%] shadow-sm">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{title}</p>
        <p className="mt-1 text-sm text-slate-600">{content}</p>
      </div>
    </div>
  );
}
