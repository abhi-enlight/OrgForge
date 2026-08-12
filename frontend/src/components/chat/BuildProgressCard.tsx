'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Rocket,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProgressStep {
  id: string;
  type: string;
  content: string;
  errors?: { component?: string; problem?: string }[];
}

const PROGRESS_TYPES = ['action', 'status', 'deploy', 'build_widget', 'deploy_error', 'deploy_warning'];

/**
 * Aggregated build/deploy progress card (ported from Agentforge chat,
 * re-tokenized). Renders the last 3 steps by default with an expand affordance,
 * and surfaces deploy_error details with a self-heal / failure summary.
 *
 * `capability` labels the segment (EC-23 per-segment cards for `both` runs):
 * agent vs org_change get distinct pills so the two phases read as separate
 * stages.
 */
export default function BuildProgressCard({
  steps,
  isBuilding = true,
  capability,
}: {
  steps: ProgressStep[];
  isBuilding?: boolean;
  capability?: 'agent' | 'org_change';
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleSteps = expanded ? steps : steps.slice(-3);
  const hiddenCount = steps.length - 3;
  const errorSteps = steps.filter((s) => s.type === 'deploy_error');
  const hasSucceeded = steps.some((s) => s.type === 'deploy_success');
  const lastType = steps[steps.length - 1]?.type ?? 'status';
  const failed = !hasSucceeded && (lastType === 'deploy_error' || errorSteps.length > 0);

  const title = hasSucceeded
    ? errorSteps.length > 0
      ? 'Resolved Build Errors (auto-healed)'
      : 'Deployed successfully'
    : isBuilding
      ? 'Working on it…'
      : failed
        ? 'Deployment failed'
        : 'Build progress';

  const stepIcon = (type: string) => {
    const base = 'shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-lg border';
    if (type === 'action') return <span className={cn(base, 'border-brand-blue/20 bg-brand-blue-light text-brand-blue')}><ArrowRight className="w-3 h-3" /></span>;
    if (type === 'deploy_error') return <span className={cn(base, 'border-red-200 bg-red-50 text-red-500')}><XCircle className="w-3 h-3" /></span>;
    if (type === 'deploy_success') return <span className={cn(base, 'border-emerald-200 bg-emerald-50 text-emerald-600')}><CheckCircle2 className="w-3 h-3" /></span>;
    if (type === 'deploy_warning') return <span className={cn(base, 'border-amber-200 bg-amber-50 text-amber-600')}><AlertTriangle className="w-3 h-3" /></span>;
    return <span className={cn(base, 'border-slate-200 bg-slate-50 text-slate-400')}><Loader2 className={cn('w-3 h-3', isBuilding && 'animate-spin')} /></span>;
  };

  const latestError = [...errorSteps].reverse().find((s) => s.errors && s.errors.length > 0);

  return (
    <div
      className={cn(
        'max-w-[90%] rounded-2xl border bg-white shadow-sm overflow-hidden transition-colors',
        failed ? 'border-red-200' : hasSucceeded ? 'border-emerald-200' : 'border-brand-border'
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2.5 px-4 py-3 border-b',
          failed ? 'border-red-100 bg-red-50/60' : hasSucceeded ? 'border-emerald-100 bg-emerald-50/60' : 'bg-brand-surface/60'
        )}
      >
        <span
          className={cn(
            'shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg',
            failed ? 'bg-red-100 text-red-500' : hasSucceeded ? 'bg-emerald-100 text-emerald-600' : 'bg-brand-blue-light text-brand-blue'
          )}
        >
          {isBuilding && !failed ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : failed ? (
            <XCircle className="w-4 h-4" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
        </span>
        <span className="text-xs font-bold tracking-wide text-brand-dark uppercase">{title}</span>
        {capability && (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
              capability === 'org_change'
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-brand-blue-light text-brand-blue border border-brand-blue/15'
            )}
          >
            {capability === 'org_change' ? 'Org change' : 'Agent'}
          </span>
        )}
        {steps.length > 3 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto p-1 text-slate-400 hover:text-brand-blue transition-colors cursor-pointer"
            aria-label={expanded ? 'Collapse steps' : 'Expand steps'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Steps */}
      <div className="px-4 py-3 space-y-2.5">
        {visibleSteps.map((step) => (
          <div key={step.id} className="flex items-start gap-3">
            {stepIcon(step.type)}
            <div className="min-w-0 flex-1">
              <p className={cn('text-xs leading-relaxed', step.type === 'deploy_error' ? 'text-red-700 font-semibold' : 'text-slate-600')}>
                {step.content}
              </p>
              {step.type === 'deploy_warning' && (
                <p className="text-[11px] text-amber-700 mt-0.5">Permission assignment needs review.</p>
              )}
            </div>
          </div>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            // ml-9 aligns the affordance with the step text (icon 24px + gap 12px).
            className="ml-9 text-[11px] font-medium text-brand-blue hover:underline cursor-pointer"
          >
            +{hiddenCount} earlier step{hiddenCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {/* Error detail block */}
      {latestError?.errors?.length ? (
        <div className="px-4 pb-3">
          <div className="rounded-lg border p-3 bg-white max-h-48 overflow-y-auto">
            <p className="text-[11px] font-bold uppercase tracking-wider text-red-600 mb-2">Error details</p>
            <div className="space-y-2">
              {latestError.errors.map((err, idx) => (
                <div key={idx} className="font-mono text-[11px] leading-relaxed text-red-800">
                  <span className="font-bold">{err.component || 'Metadata'}</span>: {err.problem || 'Unknown error'}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {hasSucceeded && (
        <div className="px-4 pb-3">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
            <Rocket className="w-3 h-3" /> Deployed
          </div>
        </div>
      )}
    </div>
  );
}

export { PROGRESS_TYPES };
