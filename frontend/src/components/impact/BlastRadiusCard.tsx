'use client';

import React from 'react';
import { Activity, AlertTriangle, Layers, Users } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { cn } from '@/lib/utils';

interface BlastRadiusCardProps {
  classification: 'Low' | 'Medium' | 'High' | 'Blocked';
  referencingCount: number;
  violatingRecordsCount: number;
  affectedUsersCount: number;
  summaryNarrative?: string;
}

export default function BlastRadiusCard({
  classification = 'High',
  referencingCount = 3,
  violatingRecordsCount = 4112,
  affectedUsersCount = 45,
  summaryNarrative,
}: BlastRadiusCardProps) {
  const isHighOrBlocked = classification === 'High' || classification === 'Blocked';

  return (
    <Card
      variant={isHighOrBlocked ? 'glass' : 'default'}
      className={cn(
        'space-y-6 border',
        classification === 'High'
          ? 'border-amber-300 bg-amber-50/30'
          : classification === 'Blocked'
          ? 'border-rose-400 bg-rose-50/40'
          : 'border-brand-border'
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-[0.14em] text-brand-dark">
            <Activity className="w-3.5 h-3.5 text-brand-blue" />
            BLAST RADIUS IMPACT CLASSIFICATION
          </span>
          <h3 className="text-xl font-bold tracking-tight text-brand-dark">Calculated Change Impact Scope</h3>
        </div>

        <Badge
          variant={
            classification === 'Blocked'
              ? 'refused'
              : classification === 'High'
              ? 'warning'
              : 'pass'
          }
          isMono
          size="md"
          className="text-sm px-3 py-1"
        >
          {classification} IMPACT
        </Badge>
      </div>

      {/* Metric Tiles Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-xl border border-brand-border space-y-1.5 shadow-soft">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-mono uppercase font-bold tracking-wide">Referencing Components</span>
            <Layers className="w-4 h-4 text-brand-blue" />
          </div>
          <span className="block text-3xl font-black tracking-tight text-brand-dark">{referencingCount}</span>
          <span className="text-[11px] text-slate-500 font-mono">Flows & Page Layouts</span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-brand-border space-y-1.5 shadow-soft">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-mono uppercase font-bold tracking-wide">Violating Records</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <span className="block text-3xl font-black tracking-tight text-rose-600">
            {violatingRecordsCount.toLocaleString()}
          </span>
          <span className="text-[11px] text-rose-700 font-mono font-semibold">
            Requires REF-05 Resolution
          </span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-brand-border space-y-1.5 shadow-soft">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-mono uppercase font-bold tracking-wide">Affected Users</span>
            <Users className="w-4 h-4 text-emerald-600" />
          </div>
          <span className="block text-3xl font-black tracking-tight text-brand-dark">{affectedUsersCount}</span>
          <span className="text-[11px] text-slate-500 font-mono">Sales Rep Profile Access</span>
        </div>
      </div>

      {/* Detailed Executive Impact Brief Note */}
      <div className="p-4 md:p-5 bg-white/90 rounded-xl border border-brand-border space-y-3 shadow-soft">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-brand-blue">
            EXECUTIVE IMPACT BRIEF & ANALYSIS NOTE
          </span>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed font-sans font-normal">
          {summaryNarrative ||
            `Impact analysis indicates a ${classification.toUpperCase()} blast radius risk. ${
              violatingRecordsCount > 0
                ? `${violatingRecordsCount} database record(s) fail target schema rules and require REF-05 resolution before deployment.`
                : 'Zero database records violate the target schema rules.'
            } ${
              referencingCount > 0
                ? `There are ${referencingCount} active metadata component dependencies in your org.`
                : 'No active metadata component dependencies detected.'
            }`}
        </p>
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono">
          <span>Target System: Connected Salesforce Org</span>
          <span>Refusal Gate Check: Required</span>
        </div>
      </div>
    </Card>
  );
}
