'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { Bot, ShieldCheck, Sparkles, ArrowRight, Copy, Check, LayoutTemplate } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE_REVEAL } from '@/lib/motion';
import { AGENT_TEMPLATES, CHANGE_TEMPLATES, type ForgeTemplate } from '@/lib/templates';

/** Difficulty → badge treatment. */
const DIFFICULTY_CLASS: Record<ForgeTemplate['difficulty'], string> = {
  Starter: 'bg-brand-pass/10 text-brand-pass',
  Intermediate: 'bg-brand-warning/10 text-brand-warning',
  Advanced: 'bg-brand-refused/10 text-brand-refused',
};

/**
 * Templates (§6.6) — a quiet library of high-quality starting points for the
 * Copilot. Two clearly separated catalogs: Agent templates (build a new
 * Agentforce agent) and Change & audit templates (governed org changes and
 * audit requests). Every card deep-links into chat with a fully-written,
 * edge-case-aware prompt — no editing required, editing always welcome.
 */
export default function TemplatesPage() {
  const reduceMotion = useReducedMotion();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any in-flight copy confirmation timer on unmount.
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const copyPrompt = async (t: ForgeTemplate) => {
    try {
      await navigator.clipboard.writeText(t.prompt);
      setCopiedId(t.id);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedId((cur) => (cur === t.id ? null : cur)), 1600);
    } catch {
      /* clipboard unavailable — the prompt is still visible on the card */
    }
  };

  const sections: Array<{
    id: 'agent' | 'change';
    title: string;
    kicker: string;
    description: string;
    icon: typeof Bot;
    iconBg: string;
    iconColor: string;
    templates: ForgeTemplate[];
  }> = [
    {
      id: 'agent',
      title: 'Agent templates',
      kicker: 'BUILD',
      description: 'Fully-scoped briefs for building Agentforce agents — with the edge cases baked in.',
      icon: Bot,
      iconBg: 'bg-brand-blue-light border-brand-blue/15',
      iconColor: 'text-brand-blue',
      templates: AGENT_TEMPLATES,
    },
    {
      id: 'change',
      title: 'Change & audit templates',
      kicker: 'GOVERN',
      description: 'Governed org changes and audit requests — guarded, reviewed, and signed before deploy.',
      icon: ShieldCheck,
      iconBg: 'bg-emerald-50 border-emerald-200/60',
      iconColor: 'text-emerald-600',
      templates: CHANGE_TEMPLATES,
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-10 animate-fade-in">
      {/* Header row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="w-9 h-9 rounded-xl bg-brand-blue-light flex items-center justify-center">
              <LayoutTemplate className="w-4.5 h-4.5 text-brand-blue" />
            </span>
            <h1 className="text-2xl md:text-3xl font-bold text-brand-dark tracking-tight">Templates</h1>
          </div>
          <p className="mt-1 text-slate-500">
            High-quality starting points for the Copilot — pick one, review it, and make it yours in chat.
          </p>
        </div>
        <Link
          href="/chat"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-blue text-white text-sm font-semibold shadow-glow hover:bg-brand-blue-hover transition-colors"
        >
          <Sparkles className="w-4 h-4" /> Ask Forge
        </Link>
      </div>

      {sections.map((group) => (
        <section key={group.id} aria-labelledby={`templates-${group.id}`} className="space-y-4">
          {/* Section heading — the two catalogs are clearly distinguished */}
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className={cn('w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0', group.iconBg)}>
                <group.icon className={cn('w-5 h-5', group.iconColor)} />
              </span>
              <div>
                <p className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-slate-400">
                  {group.kicker}
                </p>
                <h2 id={`templates-${group.id}`} className="text-xl font-bold text-brand-dark tracking-tight">
                  {group.title}
                  <span className="ml-2 text-sm font-semibold text-slate-400">{group.templates.length}</span>
                </h2>
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-500 -mt-1">{group.description}</p>

          {/* Template cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {group.templates.map((t, index) => {
              const Icon = t.icon;
              const isCopied = copiedId === t.id;
              return (
                <motion.article
                  key={t.id}
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.04, ease: EASE_REVEAL }}
                  className="group flex flex-col rounded-2xl border border-brand-border bg-white p-5 shadow-soft hover:shadow-card-hover hover:border-brand-blue/30 transition-[box-shadow,border-color] duration-200"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="w-10 h-10 rounded-xl bg-brand-surface flex items-center justify-center group-hover:bg-brand-blue-light transition-colors">
                      <Icon className={cn('w-5 h-5 text-slate-500 group-hover:text-brand-blue transition-colors')} />
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider',
                        DIFFICULTY_CLASS[t.difficulty]
                      )}
                    >
                      {t.difficulty}
                    </span>
                  </div>

                  <h3 className="mt-3 text-sm font-semibold text-brand-dark">{t.title}</h3>
                  <p className="mt-1 text-xs text-slate-500 leading-relaxed flex-1">{t.description}</p>

                  {/* Tags */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-brand-surface px-2 py-0.5 text-[10px] font-medium text-slate-500"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Prompt preview — shows the quality before committing */}
                  <p className="mt-3 rounded-xl border border-brand-border bg-brand-surface/50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500 line-clamp-3">
                    &ldquo;{t.prompt}&rdquo;
                  </p>

                  <div className="mt-4 pt-3 border-t border-brand-border flex items-center gap-2">
                    <Link
                      href={`/chat?prompt=${encodeURIComponent(t.prompt)}`}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-blue px-3 py-2 text-xs font-semibold text-white shadow-glow hover:bg-brand-blue-hover transition-colors"
                    >
                      Use in Copilot <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => copyPrompt(t)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-brand-border px-3 py-2 text-xs font-medium text-slate-600 hover:bg-brand-surface hover:border-brand-blue/30 transition-colors cursor-pointer"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-brand-pass" /> : <Copy className="w-3.5 h-3.5" />}
                      {isCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
