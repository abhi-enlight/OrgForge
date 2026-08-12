'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PackageOpen, Copy, Check, RefreshCw, ExternalLink, ShieldCheck, Server } from 'lucide-react';
import Button from '@/components/ui/Button';
import { PackageHealth } from '@/lib/orgHealth';
import { EASE_OUT } from '@/lib/motion';

interface PackageInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  health: PackageHealth | null;
  orgAlias?: string;
  isRechecking?: boolean;
  onRecheck: () => void;
}

/**
 * Shown when the OrgForge Connector package is NOT installed in the selected
 * org. Mirrors the proven AgentForge flow but with the improvements that
 * matter for OrgForge: the install URL comes from the backend (correct for
 * production / sandbox / scratch), and the re-check action force-bypasses the
 * Redis cache so a freshly-installed package clears the popup immediately.
 */
export default function PackageInstallModal({
  isOpen,
  onClose,
  health,
  orgAlias,
  isRechecking = false,
  onRecheck,
}: PackageInstallModalProps) {
  const [copied, setCopied] = useState(false);
  const installUrl = health?.installUrl || '';

  const handleCopy = async () => {
    if (!installUrl) return;
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-brand-dark/40 backdrop-blur-md cursor-pointer"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-brand-border overflow-hidden z-10"
          >
            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-brand-border bg-amber-50/40">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-600">
                    <PackageOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 mb-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      Setup Required
                    </span>
                    <h3 className="text-lg font-bold text-brand-dark leading-tight">
                      One-Time Org Setup Needed
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      {orgAlias ? `The OrgForge Connector package isn't installed in ${orgAlias}. ` : ''}
                      Install it once (as a System Administrator) before you can run governed changes.
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-brand-dark transition-colors p-1 rounded-lg hover:bg-brand-surface cursor-pointer shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Steps */}
            <div className="px-6 py-5 space-y-3">
              {/* Step 1 */}
              <div className="flex gap-3 p-4 rounded-xl bg-slate-50/80 border border-brand-border">
                <div className="shrink-0 w-7 h-7 rounded-full bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center text-[11px] font-bold text-brand-blue mt-0.5">
                  1
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-brand-dark mb-1 flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-slate-400" />
                    Install the OrgForge Connector
                  </h4>
                  <p className="text-xs text-slate-500 leading-relaxed mb-3">
                    Opens the Salesforce package installer. You need{' '}
                    <strong className="font-semibold text-slate-700">System Administrator</strong>{' '}
                    privileges — choose <em className="not-italic font-medium text-slate-700">Install for All Users</em>.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={installUrl || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-brand-blue hover:bg-brand-blue-hover shadow-md shadow-brand-blue/25 transition-[background-color,box-shadow,transform] active:scale-95"
                    >
                      <PackageOpen className="w-3.5 h-3.5" />
                      Open Install Link
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </a>
                    <button
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-[background-color,color,transform] active:scale-95 cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied!' : 'Copy Link for IT'}
                    </button>
                  </div>
                  {health?.orgType && (
                    <p className="text-[10px] font-mono text-slate-400 mt-2">
                      target: {health.orgType.toUpperCase()} · p0={health.packageVersionId}
                    </p>
                  )}
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-3 p-4 rounded-xl bg-slate-50/80 border border-brand-border">
                <div className="shrink-0 w-7 h-7 rounded-full bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center text-[11px] font-bold text-brand-blue mt-0.5">
                  2
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-brand-dark mb-1 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                    Grant Users Access
                  </h4>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    In <strong className="font-semibold text-slate-700">Setup → External Client App Manager</strong>, open{' '}
                    <em className="not-italic font-medium text-slate-700">OrgForge by Enlight Lab</em> and set{' '}
                    <strong className="font-semibold text-slate-700">Permitted Users</strong> to{' '}
                    <em className="not-italic font-medium text-slate-700">All users may self-authorize</em> (or assign the admin-approved permission set).
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-3 p-4 rounded-xl bg-slate-50/80 border border-brand-border">
                <div className="shrink-0 w-7 h-7 rounded-full bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center text-[11px] font-bold text-brand-blue mt-0.5">
                  3
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-brand-dark mb-1">Re-check the Connection</h4>
                  <p className="text-xs text-slate-500 leading-relaxed mb-3">
                    Installation usually takes under a minute. When it&apos;s done, re-check and the popup will clear.
                  </p>
                  <Button
                    variant="primary"
                    size="md"
                    isLoading={isRechecking}
                    leftIcon={<RefreshCw className="w-4 h-4" />}
                    onClick={onRecheck}
                  >
                    I&apos;ve installed it — Re-check
                  </Button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 bg-slate-50/60 border-t border-brand-border flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-400">
                package {health?.packageVersionId || '…'} · checked {health?.checkedAt ? new Date(health.checkedAt).toLocaleTimeString() : '—'}
              </span>
              <button
                onClick={onClose}
                className="text-xs font-semibold text-slate-500 hover:text-brand-blue transition-colors cursor-pointer"
              >
                Dismiss for this session
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
