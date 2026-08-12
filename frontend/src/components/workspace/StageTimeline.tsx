'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE_REVEAL } from '@/lib/motion';

type StageStatus = 'pending' | 'active' | 'complete' | 'refused';

export interface Stage {
  number: number;
  title: string;
  shortDesc: string;
  status: StageStatus;
}

interface StageTimelineProps {
  stages: Stage[];
  currentStage: number;
  onSelectStage: (stageNumber: number) => void;
}

export default function StageTimeline({
  stages,
  currentStage,
  onSelectStage,
}: StageTimelineProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="w-full bg-white rounded-2xl border border-brand-border shadow-soft p-5 space-y-5 sticky top-[84px]">
      <div className="flex items-center justify-between border-b border-brand-border pb-4">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-brand-dark">
            Governance Pipeline
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            10 stages of refusal-gated change
          </p>
        </div>
        <div className="flex items-baseline gap-0.5 rounded-lg bg-brand-surface/80 border border-brand-border px-2 py-1">
          <span className="font-mono text-sm font-bold text-brand-blue">{currentStage}</span>
          <span className="font-mono text-[10px] text-slate-500">/10</span>
        </div>
      </div>

      <div className="relative">
        {/* Spine line — bisects the 28px nodes (button p-2.5 = 10px + node center 14px = 24px) */}
        <div
          aria-hidden
          className="absolute left-[23.5px] top-2 bottom-2 w-px bg-brand-border"
        />
        <ol className="relative space-y-1.5">
          {stages.map((stage) => {
            const isActive = stage.number === currentStage;
            const isComplete = stage.status === 'complete';
            const isRefused = stage.status === 'refused';

            const isClickable = (() => {
              if (stage.number === currentStage) return true;
              for (const s of stages) {
                if (s.number < stage.number && s.status !== 'complete') {
                  return false;
                }
              }
              return true;
            })();

            return (
              <motion.li
                key={stage.number}
                initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  duration: 0.25,
                  delay: stage.number * 0.03,
                  ease: EASE_REVEAL,
                }}
              >
                <button
                  type="button"
                  disabled={!isClickable}
                  onClick={() => isClickable && onSelectStage(stage.number)}
                  aria-current={isActive ? 'step' : undefined}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-xl p-2.5 pr-3 text-left transition-[background-color,box-shadow,color] duration-200 group',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:ring-offset-1',
                    !isClickable
                      ? 'opacity-40 cursor-not-allowed'
                      : isActive
                      ? 'bg-brand-blue-light/80 ring-1 ring-brand-blue/30 cursor-pointer'
                      : isRefused
                      ? 'bg-rose-50/70 hover:bg-rose-50 cursor-pointer'
                      : isComplete
                      ? 'hover:bg-emerald-50/50 cursor-pointer'
                      : 'hover:bg-brand-surface cursor-pointer'
                  )}
                >
                  {/* Node */}
                  <span
                    className={cn(
                      'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold transition-[background-color,border-color,color,transform] duration-200',
                      isActive
                        ? 'border-brand-blue bg-brand-blue text-white shadow-md shadow-brand-blue/30 scale-105'
                        : isRefused
                        ? 'border-rose-500 bg-rose-500 text-white'
                        : isComplete
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-slate-300 bg-white text-slate-500 group-hover:border-slate-400'
                    )}
                  >
                    {isRefused ? (
                      <X className="h-3.5 w-3.5" strokeWidth={3} />
                    ) : isComplete ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    ) : (
                      stage.number
                    )}
                  </span>

                  {/* Label */}
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-[13px] font-semibold leading-tight transition-colors',
                        isActive
                          ? 'text-brand-blue'
                          : isRefused
                          ? 'text-rose-700'
                          : isComplete
                          ? 'text-emerald-800'
                          : 'text-slate-600'
                      )}
                    >
                      {stage.title}
                    </span>
                    <span
                      className={cn(
                        'block truncate text-[11px] font-medium leading-tight mt-0.5',
                        isActive ? 'text-brand-blue/80' : isRefused ? 'text-rose-500' : 'text-slate-500'
                      )}
                    >
                      {stage.shortDesc}
                    </span>
                  </span>

                  {/* Active indicator */}
                  {isActive && (
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-blue"
                    />
                  )}
                </button>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
