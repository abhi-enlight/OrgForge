'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, ShieldAlert, ArrowUpRight } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { EASE_OUT } from '@/lib/motion';

export interface GateResult {
  code: string; // REF-01 to REF-10
  name: string;
  outcome: 'PASS' | 'REFUSED';
  plainReason: string;
  missingEvidence?: string;
  unblockPath?: string;
}

interface RefusalGateCardProps {
  gate: GateResult;
  onUnblockClick?: (code: string) => void;
}

export default function RefusalGateCard({ gate, onUnblockClick }: RefusalGateCardProps) {
  const isPass = gate.outcome === 'PASS';
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      whileHover={reduceMotion ? undefined : { y: -2 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className={cn(
        'p-5 rounded-2xl transition-colors duration-200 relative space-y-3',
        'focus-within:ring-2 focus-within:ring-brand-blue/30',
        isPass
          ? 'bg-emerald-50/70 border border-emerald-300 shadow-soft'
          : 'bg-rose-50/80 border border-rose-400 shadow-soft'
      )}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant={isPass ? 'pass' : 'refused'} isMono size="sm">
            {gate.code}
          </Badge>
          <span className="text-xs font-bold text-brand-dark truncate">{gate.name}</span>
        </div>

        <div className="shrink-0">
          {isPass ? (
            <span className="flex items-center gap-1 text-[11px] font-mono font-bold text-emerald-700">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              PASS
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] font-mono font-bold text-rose-700">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              REFUSED
            </span>
          )}
        </div>
      </div>

      {/* Description / Reason */}
      <p className="text-xs text-slate-700 leading-relaxed font-sans">
        {gate.plainReason}
      </p>

      {/* Refused Details (Missing Evidence & Unblock Path) */}
      {!isPass && (
        <div className="space-y-2 pt-2 border-t border-rose-200">
          {gate.missingEvidence && (
            <div className="text-[11px] font-mono text-rose-900 bg-white/80 p-2 rounded-lg border border-rose-200">
              <span className="font-bold text-rose-700">Evidence Required:</span>{' '}
              {gate.missingEvidence}
            </div>
          )}

          {gate.unblockPath && (
            <div className="p-2.5 rounded-lg bg-white border border-rose-300 text-xs font-mono space-y-1">
              <div className="flex items-center justify-between text-brand-blue font-bold text-[11px]">
                <span>UNBLOCK PATH:</span>
                {onUnblockClick && (
                  <button
                    onClick={() => onUnblockClick(gate.code)}
                    className="hover:underline flex items-center gap-0.5 focus:outline-none focus-visible:underline cursor-pointer"
                  >
                    <span>Fix</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                )}
              </div>
              <p className="text-slate-700 text-[11px] leading-snug">{gate.unblockPath}</p>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
