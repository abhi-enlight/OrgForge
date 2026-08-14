'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, X, Wrench, ArrowRight, UserCheck, AlertTriangle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import { EASE_OUT } from '@/lib/motion';
import { GateResult } from './RefusalGateCard';

export interface UnblockEvidence {
  gateCode: string;
  approverIdentity?: string;
  rollbackAcknowledged?: boolean;
  productionMode?: boolean;
}

interface UnblockActionModalProps {
  isOpen: boolean;
  gate: GateResult | null;
  onClose: () => void;
  onResolve: (evidence: UnblockEvidence) => Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Gates the operator can genuinely clear from this modal by supplying evidence.
const INTERACTIVE_GATES = new Set(['REF-04', 'REF-06', 'REF-07']);

function remediationCopy(gate: GateResult): string {
  switch (gate.code) {
    case 'REF-04':
      return 'Enter the approver\u2019s email below. The permission change will be re-evaluated with approver authorization recorded.';
    case 'REF-06':
      return 'Confirm that you understand this destructive change cannot be automatically rolled back. The gate will then be cleared.';
    case 'REF-07':
      return 'This is a production org. Enable production deployment mode and record the executive/approver identity that authorizes the write.';
    case 'REF-05':
      return 'OrgForge cannot delete or modify records on your behalf. Clean up the violating records directly in Salesforce, then re-run the evaluation to confirm the gate passes.';
    default:
      return 'Complete the required action listed under the unblock path, then re-run the evaluation to confirm the gate now passes.';
  }
}

export default function UnblockActionModal({
  isOpen,
  gate,
  onClose,
  onResolve,
}: UnblockActionModalProps) {
  const [approverIdentity, setApproverIdentity] = useState('');
  const [rollbackAcknowledged, setRollbackAcknowledged] = useState(false);
  const [productionMode, setProductionMode] = useState(false);
  const [isFixing, setIsFixing] = useState(false);

  // Evidence state resets automatically when a different gate is opened:
  // the parent remounts this modal via `key={gate.code}`.
  if (!isOpen || !gate) return null;

  const isInteractive = INTERACTIVE_GATES.has(gate.code);
  const approverValid = EMAIL_RE.test(approverIdentity.trim());
  const canSubmit =
    !isInteractive ||
    (gate.code === 'REF-04'
      ? approverValid
      : gate.code === 'REF-07'
        ? approverValid && productionMode
        : rollbackAcknowledged);

  const handleFix = async () => {
    if (!canSubmit) return;
    setIsFixing(true);
    try {
      await onResolve({
        gateCode: gate.code,
        approverIdentity:
          gate.code === 'REF-04' || gate.code === 'REF-07'
            ? approverIdentity.trim()
            : undefined,
        rollbackAcknowledged: gate.code === 'REF-06' ? rollbackAcknowledged : undefined,
        productionMode: gate.code === 'REF-07' ? productionMode : undefined,
      });
      onClose();
    } finally {
      setIsFixing(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="relative w-full max-w-lg bg-white rounded-2xl border border-rose-200 shadow-2xl overflow-hidden p-6 space-y-5"
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-100 text-rose-600 rounded-xl border border-rose-200">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="refused" isMono size="sm">
                    {gate.code}
                  </Badge>
                  <h3 className="text-lg font-bold text-slate-900">Unblock Governance Gate</h3>
                </div>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{gate.name}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Refusal Explanation */}
          <div className="p-4 bg-rose-50/60 rounded-xl border border-rose-200 space-y-2">
            <span className="text-[11px] font-mono font-bold text-rose-800 uppercase tracking-wider block">
              Refusal Cause & Requirement
            </span>
            <p className="text-xs text-slate-700 leading-relaxed font-sans">{gate.plainReason}</p>
            {gate.missingEvidence && (
              <div className="text-[11px] font-mono text-rose-900 bg-white/90 p-2.5 rounded-lg border border-rose-200 mt-2">
                <span className="font-bold text-rose-700">Required Evidence:</span> {gate.missingEvidence}
              </div>
            )}
          </div>

          {/* Remediation Action Box */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center gap-2 text-brand-dark">
              <Wrench className="w-4 h-4 text-brand-blue" />
              <span className="text-xs font-bold font-mono">
                {isInteractive ? 'AUTOMATED UNBLOCK REMEDIATION' : 'REQUIRED ACTION'}
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{remediationCopy(gate)}</p>

            {/* REF-04: approver authorization */}
            {gate.code === 'REF-04' && (
              <div className="pt-1 space-y-2">
                <Input
                  label="Approver Email"
                  type="email"
                  placeholder="approver@company.com"
                  value={approverIdentity}
                  onChange={(e) => setApproverIdentity(e.target.value)}
                  leftIcon={<UserCheck className="w-4 h-4" />}
                  error={
                    approverIdentity.trim().length > 0 && !approverValid
                      ? 'Enter a valid approver email address.'
                      : undefined
                  }
                  helperText="The approver identity is included in this gate evaluation."
                />
              </div>
            )}

            {/* REF-07: production mode + approver */}
            {gate.code === 'REF-07' && (
              <div className="pt-1 space-y-3">
                <label className="flex items-start gap-3 p-3 bg-white rounded-xl border border-amber-200 cursor-pointer hover:border-amber-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={productionMode}
                    onChange={(e) => setProductionMode(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500/20 accent-amber-600"
                  />
                  <span className="text-xs text-slate-700 leading-relaxed">
                    I confirm this is a <strong className="text-amber-700">production org</strong> and I
                    explicitly enable <strong className="text-amber-700">production deployment mode</strong>.
                  </span>
                </label>
                <Input
                  label="Approver / Executive Identity"
                  type="email"
                  placeholder="approver@company.com"
                  value={approverIdentity}
                  onChange={(e) => setApproverIdentity(e.target.value)}
                  leftIcon={<UserCheck className="w-4 h-4" />}
                  error={
                    approverIdentity.trim().length > 0 && !approverValid
                      ? 'Enter a valid approver email address.'
                      : undefined
                  }
                  helperText="The named approver is recorded on the change record (REF-07)."
                />
              </div>
            )}

            {/* REF-06: rollback acknowledgement */}
            {gate.code === 'REF-06' && (
              <label className="flex items-start gap-3 p-3 bg-white rounded-xl border border-rose-200 cursor-pointer hover:border-rose-300 transition-colors">
                <input
                  type="checkbox"
                  checked={rollbackAcknowledged}
                  onChange={(e) => setRollbackAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-blue focus:ring-brand-blue/20 accent-brand-blue"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  I acknowledge that <strong className="text-rose-700">destructive changes cannot be automatically rolled back</strong>,
                  and I accept responsibility for this irreversible change.
                </span>
              </label>
            )}

            {/* Non-interactive gates: honest note */}
            {!isInteractive && (
              <div className="flex items-start gap-2.5 p-3 bg-amber-50 rounded-xl border border-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  This gate cannot be cleared automatically. Complete the required action in Salesforce
                  (or elsewhere) first, then re-run the evaluation. It will pick up the updated state.
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={isFixing}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleFix}
              isLoading={isFixing}
              disabled={!canSubmit}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              {isInteractive ? 'Apply Fix & Re-Evaluate Gates' : 'Re-Evaluate Gates'}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
