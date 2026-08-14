'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export type CapabilityPin = 'agent' | 'org_change' | 'both' | null;

/** Verdict shape from @orgforge/ai's rule-based stub classifier (canary preview). */
export interface StubVerdict {
  capability: 'agent' | 'org_change' | 'both' | 'clarify';
  confidence: number;
  reason: string;
  overrideSource: 'stub';
}

type ModeKey = 'auto' | 'agent' | 'org_change' | 'both';

const OPTIONS: {
  key: ModeKey;
  value: CapabilityPin;
  label: string;
  hint: string;
  /** Simple, plain-language summary of what the mode does. */
  purpose: string;
  /** When a user should pick this mode over the default. */
  whenToUse: string;
}[] = [
  {
    key: 'auto',
    value: null,
    label: 'Auto',
    hint: 'Let the router decide',
    purpose: 'OrgForge reads your request and routes it to the right engine automatically.',
    whenToUse: 'Default for everyday requests. Just type what you want.',
  },
  {
    key: 'agent',
    value: 'agent',
    label: 'Agent',
    hint: 'Build / update a Salesforce agent',
    purpose: 'Builds and tunes Agentforce agents (topics, actions, and testing) in plain language.',
    whenToUse: 'Pick this when you are creating or updating an agent.',
  },
  {
    key: 'org_change',
    value: 'org_change',
    label: 'Org Change',
    hint: 'Governed metadata change',
    purpose: 'Makes governed Salesforce metadata changes with impact and blast-radius checks.',
    whenToUse: 'Pick this when you are changing fields, objects, or other org metadata.',
  },
  {
    key: 'both',
    value: 'both',
    label: 'Both',
    hint: 'Agent, then org change in sequence',
    purpose: 'Runs the agent step first, then applies the supporting org change in sequence.',
    whenToUse: 'Pick this when a request needs an agent plus the metadata it depends on.',
  },
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
 * Each chip explains itself on hover (desktop) and, because touch has no
 * hover, also on tap: selecting a chip pins its explanation open until it is
 * dismissed. Pinned panels close on Esc, on an outside tap, or by toggling
 * the same chip again.
 *
 * Canary mode (`ORGFORGE_UNIFIED_FRONTEND=on`, plan §14.2 Phase 1): when the
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
  /** Canary flag (ORGFORGE_UNIFIED_FRONTEND=on) — enables the stub preview. */
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
  /** Chip whose explanation is pinned open (via tap/click), if any. */
  const [pinned, setPinned] = useState<ModeKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close any pinned panel on an outside tap or on Esc.
  useEffect(() => {
    if (pinned === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setPinned(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pinned]);

  // A disabled option must never look selectable: disabled + dimmed, with the
  // reason (when given) in the tooltip so the state is self-explanatory.
  const isOptionDisabled = (optValue: CapabilityPin) =>
    disabled || (optValue !== null && disabledOptions.includes(optValue));
  const optionDisabledByReadiness = (optValue: CapabilityPin) =>
    !disabled && optValue !== null && disabledOptions.includes(optValue);

  // While a panel is pinned, suppress transient hover popovers so chips don't
  // stack explanations on top of each other.
  const suppressHover = pinned !== null;

  return (
    <div ref={rootRef} className="flex flex-wrap items-center gap-1.5">
      {OPTIONS.map((opt, idx) => {
        const active = value === opt.value;
        const optionDisabled = isOptionDisabled(opt.value);
        const disabledByReadiness = optionDisabledByReadiness(opt.value);
        // Anchor the popup by its inner edge so it can't spill past the
        // viewport on narrow screens: left for early chips, right for the last.
        const anchor = idx === OPTIONS.length - 1 ? 'right-0' : 'left-0';
        const isPinned = pinned === opt.key;
        return (
          <span
            key={opt.key}
            className={cn('relative group', optionDisabled && 'cursor-not-allowed')}
            onClick={() => {
              // Click / tap pins the explanation open. The button's own
              // handler still fires for enabled chips (selecting the mode);
              // disabled chips only open their explanation, never select.
              setPinned((prev) => (prev === opt.key ? null : opt.key));
            }}
          >
            <button
              type="button"
              disabled={optionDisabled}
              onClick={() => onChange(opt.value)}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-[background-color,border-color,color,box-shadow] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
                // Disabled buttons swallow clicks, which would lock touch users
                // out of the "why is this greyed out" explanation. Let taps
                // reach the wrapper so the popup can be opened.
                optionDisabled && 'pointer-events-none',
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
            {/* Hover / tap popup: what the mode does and when to use it.
                Replaces the old native title so the explanation shows
                instantly and is readable. */}
            <div
              role="tooltip"
              className={cn(
                'pointer-events-none absolute bottom-full z-50 mb-2 w-56 rounded-lg border border-slate-700 bg-slate-900/95 p-2.5 text-left shadow-lg backdrop-blur-sm transition-opacity duration-150',
                anchor,
                isPinned
                  ? 'visible opacity-100'
                  : cn(
                      'invisible opacity-0',
                      suppressHover
                        ? ''
                        : 'group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100'
                    )
              )}
            >
              {disabledByReadiness ? (
                <>
                  <span className="block text-[11px] font-bold text-amber-300">
                    {opt.label} isn&apos;t available here
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-slate-300">
                    {disabledOptionsReason || opt.hint}
                  </span>
                </>
              ) : (
                <>
                  <span className="block text-[11px] font-bold text-white">
                    {opt.label}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-slate-300">
                    {opt.purpose}
                  </span>
                  <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    When to use
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-300">
                    {opt.whenToUse}
                  </span>
                </>
              )}
            </div>
          </span>
        );
      })}

      {/* Canary stub-router preview — informational only, labeled as a stub.
          Shows only while Auto is selected: a pin is the user's override. */}
      {canary && value === null && stubVerdict && (
        <span
          title="Rule-based stub preview. The real router decides on send. This is the Phase-1 zero-AI-risk surface (plan §14.2)."
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500 animate-fade-in"
        >
          <span className="rounded bg-slate-200 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-500">
            Stub
          </span>
          <span>
            router: <span className="font-semibold text-slate-700">{STUB_LABELS[stubVerdict.capability]}</span>
            <span className="hidden sm:inline text-slate-400">: {stubVerdict.reason}</span>
          </span>
        </span>
      )}
    </div>
  );
}
