'use client';

import { cn } from '@/lib/utils';

export type CapabilityPin = 'agent' | 'org_change' | 'both' | null;

/** Verdict shape from @forge/ai's rule-based stub classifier (canary preview). */
export interface StubVerdict {
  capability: 'agent' | 'org_change' | 'both' | 'clarify';
  confidence: number;
  reason: string;
  overrideSource: 'stub';
}

const OPTIONS: { value: CapabilityPin; label: string; hint: string }[] = [
  { value: null, label: 'Auto', hint: 'Let the router decide' },
  { value: 'agent', label: 'Agent', hint: 'Build / update a Salesforce agent' },
  { value: 'org_change', label: 'Org Change', hint: 'Governed metadata change' },
  { value: 'both', label: 'Both', hint: 'Agent, then org change — in sequence' },
];

const STUB_LABELS: Record<StubVerdict['capability'], string> = {
  agent: 'Agent',
  org_change: 'Org Change',
  both: 'Both',
  clarify: 'Ask to clarify',
};

/**
 * Capability selector (plan §6.3). `Auto` sends no pin — routeIntent's
 * classifier + deterministic overrides decide. Pinning a capability bypasses
 * the classifier (plan §7.1: UI chip is authoritative).
 *
 * Canary mode (`FORGE_UNIFIED_FRONTEND=on`, plan §14.2 Phase 1): when the
 * router is on `Auto`, a live stub rule-based preview shows what routing
 * *would* happen for the current draft — free, offline, zero AI calls. It is
 * explicitly labeled "stub" and never sent to the server (the real router
 * stays authoritative). Pinning any option suppresses the preview.
 */
export default function CapabilityChip({
  value,
  onChange,
  disabled = false,
  canary = false,
  stubVerdict = null,
  disabledOptions = [],
  disabledOptionsReason = '',
}: {
  value: CapabilityPin;
  onChange: (value: CapabilityPin) => void;
  disabled?: boolean;
  /** Canary flag (FORGE_UNIFIED_FRONTEND=on) — enables the stub preview. */
  canary?: boolean;
  /** Rule-based verdict for the current draft (null when nothing typed yet). */
  stubVerdict?: StubVerdict | null;
  /** Options that are unavailable in the active org (e.g. 'agent' when the
   *  Agentforce/Einstein settings aren't enabled) — their buttons render
   *  disabled so the user can't pin a run that will fail. 'both' is included
   *  alongside 'agent' because it runs the agent step too. */
  disabledOptions?: CapabilityPin[];
  /** Why those options are disabled — shown as the button tooltip. */
  disabledOptionsReason?: string;
}) {
  // A disabled option must never look selectable: disabled + dimmed, with the
  // reason (when given) in the tooltip so the state is self-explanatory.
  const isOptionDisabled = (optValue: CapabilityPin) =>
    disabled || (optValue !== null && disabledOptions.includes(optValue));
  const optionDisabledByReadiness = (optValue: CapabilityPin) =>
    !disabled && optValue !== null && disabledOptions.includes(optValue);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        const optionDisabled = isOptionDisabled(opt.value);
        return (
          <button
            key={opt.label}
            type="button"
            disabled={optionDisabled}
            title={
              optionDisabledByReadiness(opt.value)
                ? disabledOptionsReason || opt.hint
                : opt.hint
            }
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-[background-color,border-color,color,box-shadow] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
              active
                ? opt.value === 'agent'
                  ? 'border-brand-blue bg-brand-blue text-white shadow-glow'
                  : opt.value === 'org_change'
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : opt.value === 'both'
                      ? 'border-violet-500 bg-violet-500 text-white'
                      : 'border-brand-dark bg-brand-dark text-white'
                : 'border-brand-border bg-white text-slate-500 hover:border-brand-blue/40 hover:text-brand-blue'
            )}
          >
            {opt.label}
          </button>
        );
      })}

      {/* Canary stub-router preview — informational only, labeled as a stub.
          Shows only while Auto is selected: a pin is the user's override. */}
      {canary && value === null && stubVerdict && (
        <span
          title="Rule-based stub preview — the real router decides on send. This is the Phase-1 zero-AI-risk surface (plan §14.2)."
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500 animate-fade-in"
        >
          <span className="rounded bg-slate-200 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-500">
            Stub
          </span>
          <span>
            router: <span className="font-semibold text-slate-700">{STUB_LABELS[stubVerdict.capability]}</span>
            <span className="hidden sm:inline text-slate-400"> — {stubVerdict.reason}</span>
          </span>
        </span>
      )}
    </div>
  );
}
