'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  PackageOpen,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { PackageHealth } from '@/lib/orgHealth';

interface PackageRequiredGateProps {
  /** Live package-health result (null while checking / on error). */
  health: PackageHealth | null;
  status: 'missing' | 'error' | 'checking' | 'idle';
  onRecheck: () => void;
  orgAlias?: string;
}

/**
 * Chat access gate: the Copilot is unusable until the OrgForge Connector
 * package is installed in the active org (both engines — agent builds AND
 * governed org changes — need it). Rendered in place of the whole chat UI:
 *
 *   - missing   → full 3-step setup card (install link + copy for IT, grant
 *                  user access, re-check) so the user is notified AND can fix
 *                  it without leaving the page.
 *   - error     → the backend couldn't verify the package (expired token
 *                  etc.) → reconnect/retry instead of a bogus install prompt.
 *   - checking  → transient "Checking org setup…" so the chat never flashes
 *                  open before the gate resolves.
 */
export default function PackageRequiredGate({
  health,
  status,
  onRecheck,
  orgAlias,
}: PackageRequiredGateProps) {
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

  if (status === 'checking' || status === 'idle') {
    return (
      <div className="max-w-xl mx-auto pt-16 text-center animate-fade-in">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-surface border border-brand-border mb-5">
          <Loader2 className="w-6 h-6 text-brand-blue animate-spin" />
        </span>
        <h1 className="text-xl font-bold text-brand-dark tracking-tight">Checking org setup…</h1>
        <p className="mt-2 text-sm text-slate-500">
          Verifying the connector package in {orgAlias || 'your org'}.
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto pt-16 text-center animate-fade-in">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-red-50 border border-red-100 text-red-500 mb-5">
          <AlertTriangle className="w-6 h-6" />
        </span>
        <h1 className="text-xl font-bold text-brand-dark tracking-tight">Connector status unknown</h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          We couldn&apos;t verify the connector package in {orgAlias || 'your org'}. Usually the
          Salesforce connection needs reconnecting.
        </p>
        <div className="mt-7 flex items-center justify-center gap-2.5">
          <Link
            href="/login?step=2"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-blue text-white text-sm font-semibold px-5 py-2.5 shadow-glow hover:bg-brand-blue-hover transition-colors"
          >
            Reconnect Salesforce
          </Link>
          <button
            type="button"
            onClick={onRecheck}
            className="inline-flex items-center gap-2 rounded-xl border border-brand-border bg-white text-sm font-semibold px-5 py-2.5 text-slate-600 hover:bg-brand-surface transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" /> Re-check
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pt-10 animate-fade-in">
      <div className="rounded-2xl border border-brand-border bg-white shadow-soft overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-5 border-b border-brand-border bg-amber-50/40">
          <div className="flex items-start gap-3.5">
            <span className="shrink-0 w-11 h-11 rounded-xl bg-amber-100 border border-amber-200 text-amber-600 flex items-center justify-center">
              <PackageOpen className="w-5.5 h-5.5" />
            </span>
            <div>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 mb-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                Chat Locked
              </span>
              <h1 className="text-lg font-bold text-brand-dark leading-tight">
                Connector package required to chat
              </h1>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {orgAlias ? `The OrgForge Connector package isn't installed in ${orgAlias}. ` : ''}
                Chat stays locked until it&apos;s installed. Install it once (as a System
                Administrator) and you&apos;ll get access immediately.
              </p>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="px-6 py-5 space-y-3">
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
                privileges. Choose <em className="not-italic font-medium text-slate-700">Install for All Users</em>.
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
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-[background-color,color,transform] active:scale-95 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied!' : 'Copy Link for IT'}
                </button>
              </div>
            </div>
          </div>

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
                <em className="not-italic font-medium text-slate-700">Forge by Enlight Lab</em> and set{' '}
                <strong className="font-semibold text-slate-700">Permitted Users</strong> to{' '}
                <em className="not-italic font-medium text-slate-700">All users may self-authorize</em> (or assign the
                admin-approved permission set).
              </p>
            </div>
          </div>

          <div className="flex gap-3 p-4 rounded-xl bg-slate-50/80 border border-brand-border">
            <div className="shrink-0 w-7 h-7 rounded-full bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center text-[11px] font-bold text-brand-blue mt-0.5">
              3
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-brand-dark mb-1">Re-check the Connection</h4>
              <p className="text-xs text-slate-500 leading-relaxed mb-3">
                Installation usually takes under a minute. When it&apos;s done, re-check and the chat unlocks.
              </p>
              <Button
                variant="primary"
                size="md"
                leftIcon={<RefreshCw className="w-4 h-4" />}
                onClick={onRecheck}
              >                    Re-check after installing
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50/60 border-t border-brand-border flex items-center justify-between gap-3">
          <span className="text-[10px] font-mono text-slate-400">
            package {health?.packageVersionId || '…'} · target {health?.orgType?.toUpperCase() || '–'}
          </span>
          <Link
            href="/settings"
            className="text-xs font-semibold text-slate-500 hover:text-brand-blue transition-colors shrink-0"
          >
            Open Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
