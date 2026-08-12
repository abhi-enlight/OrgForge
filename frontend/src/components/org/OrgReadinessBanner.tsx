'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  PackageOpen,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { useActiveOrg } from '@/lib/org-context';
import { EASE_OUT } from '@/lib/motion';
import { useOrgReadiness, type ReadinessDiag } from '@/lib/orgReadiness';

interface ReadinessItem {
  icon: React.ComponentType<{ className?: string }>;
  text: React.ReactNode;
}

/**
 * Maps a preflight result to the human-actionable setup items. Every item is a
 * concrete fix the user (or their admin) must complete in Salesforce — no
 * informational-only noise.
 */
function buildItems(diag: ReadinessDiag): ReadinessItem[] {
  const c = diag.checks || {};
  const items: ReadinessItem[] = [];

  if (c.package?.installed === false) {
    items.push({
      icon: PackageOpen,
      text: (
        <>
          Install the <strong className="font-semibold text-slate-700">OrgForge Connector</strong> package —{' '}
          <span className="font-medium text-slate-600">chat stays locked until it is installed</span>.
        </>
      ),
    });
  }
  if (c.settings?.agentforceEnabled === false) {
    items.push({
      icon: Sparkles,
      text: (
        <>
          Enable <strong className="font-semibold text-slate-700">Agentforce Agent</strong> and{' '}
          <strong className="font-semibold text-slate-700">Einstein</strong> in{' '}
          <span className="font-mono text-[11px] text-slate-600">Setup → Agentforce</span>, then re-run diagnostics.
        </>
      ),
    });
  }
  if (c.license?.supported === false) {
    items.push({
      icon: ShieldAlert,
      text: (
        <>
          Einstein Agent license: <span className="text-slate-600">{c.license.reason || 'not available'}</span>
        </>
      ),
    });
  }
  if (c.provisioning?.ok === false && c.provisioning.reason) {
    items.push({
      icon: Settings2,
      text: (
        <>
          Agent provisioning: <span className="text-slate-600">{c.provisioning.reason}</span>
        </>
      ),
    });
  }
  // Safety net: agents flagged attention without a named check above (e.g. a
  // future check) — never let the banner go silent on a blocked capability.
  if (items.length === 0 && diag.capability?.agents === 'attention') {
    items.push({
      icon: AlertTriangle,
      text: (
        <>
          Agent building needs setup in this org —{' '}
          <Link href="/settings" className="text-brand-blue font-medium hover:underline">
            open Settings → Advanced → Run diagnostics
          </Link>{' '}
          for the specific reason.
        </>
      ),
    });
  }
  return items;
}

/**
 * One-time-per-session org readiness banner, shown at the top of the app shell
 * right after sign-in. Reads the SAME preflight result as the chat page's
 * capability chip (shared `useOrgReadiness` hook), so the two surfaces always
 * agree on what the active org can run.
 *
 * - The fetch itself is once-per-org-per-session (hook semantics; the server
 *   additionally caches 24h). Dismissal is session-scoped via sessionStorage,
 *   mirroring the package-install popup's pattern.
 * - Shows only for `attention` (actionable items) or `error` (couldn't
 *   verify) — an `ok` org renders nothing.
 */
export default function OrgReadinessBanner() {
  const { org } = useActiveOrg();
  // orgId gates rendering below — a stale diag for a PREVIOUS org must never
  // flash here while an org switch is in flight (deferred resets fire after
  // paint). Same attribution guard the chat page uses for its capability chip.
  const { diag, status, error, orgId, retry } = useOrgReadiness();
  // null / another org ⇒ not dismissed for the current org (banner may show);
  // the current org's id ⇒ dismissed this session (hidden).
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  // Re-read this org's session dismissal whenever the active org changes.
  useEffect(() => {
    if (!org) {
      // Deferred so no setState runs synchronously inside the effect body.
      const timer = setTimeout(() => setDismissedFor(null), 0);
      return () => clearTimeout(timer);
    }
    let wasDismissed = false;
    try {
      wasDismissed = Boolean(
        window.sessionStorage.getItem(`forge:readiness-dismissed:${org.id}`)
      );
    } catch {
      /* private mode — ignore */
    }
    const timer = setTimeout(() => setDismissedFor(wasDismissed ? org.id : null), 0);
    return () => clearTimeout(timer);
  }, [org]);

  const dismiss = useCallback(() => {
    if (!org) return;
    setDismissedFor(org.id);
    try {
      window.sessionStorage.setItem(`forge:readiness-dismissed:${org.id}`, '1');
    } catch {
      /* private mode — ignore */
    }
  }, [org]);

  // Only `attention` is actionable; a transient `error` is a quiet retryable
  // note so a token blip can't hide a genuinely broken setup. Both gates also
  // require the hook's result to belong to the current org — a stale result
  // for a previous org never renders here.
  const isDismissed = org != null && dismissedFor === org.id;
  const showAttention =
    org != null && !isDismissed && status === 'done' && orgId === org.id && diag?.state === 'attention';
  const showError =
    org != null && !isDismissed && status === 'done' && orgId === org.id && (diag?.state === 'error' || error != null);

  if (status === 'loading' || status === 'idle') return null;
  if (!showAttention && !showError) return null;

  const items = diag?.state === 'attention' ? buildItems(diag) : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
      role="status"
      aria-live="polite"
      className="mb-6 max-w-5xl mx-auto"
    >
      {showError && (
        <div className="flex items-start gap-3 rounded-2xl border border-brand-border bg-white px-4 py-3.5 shadow-soft">
          <span className="w-8 h-8 shrink-0 rounded-lg bg-brand-danger/10 text-brand-danger flex items-center justify-center">
            <AlertTriangle className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-dark">Couldn&apos;t verify org readiness</p>
            <p className="text-xs text-slate-500 mt-0.5">
              The preflight check could not reach Salesforce for this org. Reconnect the org or retry.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-brand-surface transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-blue hover:bg-brand-blue-light/60 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" /> Settings
            </Link>
          </div>
        </div>
      )}

      {showAttention && items.length > 0 && (
        <div className="rounded-2xl border border-brand-warning/30 bg-gradient-to-br from-amber-50 to-white shadow-soft overflow-hidden">
          <div className="flex items-start gap-3.5 px-4 sm:px-5 py-4">
            <span className="w-9 h-9 shrink-0 rounded-xl bg-amber-100 border border-amber-200 text-amber-600 flex items-center justify-center">
              <Sparkles className="w-4.5 h-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-brand-dark leading-tight">
                    Setup needed before you can build agents in {org?.name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Your admin (or you, with System Administrator access) must complete the steps below in
                    Salesforce. Org changes stay available either way.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={dismiss}
                  aria-label="Dismiss for this session"
                  className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-brand-dark hover:bg-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ul className="mt-3 space-y-2">
                {items.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed bg-white/70 border border-brand-border/70 rounded-xl px-3 py-2.5"
                  >
                    <item.icon className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-px" />
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-2.5 border-t border-brand-warning/15 bg-white/60">
            <p className="text-[11px] text-slate-400">
              Shown once per session — dismiss to continue without it.
            </p>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold text-white bg-brand-blue hover:bg-brand-blue-hover shadow-md shadow-brand-blue/25 transition-[background-color,box-shadow,transform] active:scale-95"
            >
              <Settings2 className="w-3.5 h-3.5" /> Open Settings
            </Link>
          </div>
        </div>
      )}
    </motion.div>
  );
}
