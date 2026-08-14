'use client';

import { Bot, Eye, GitBranch, ShieldCheck } from 'lucide-react';
import { AmbientShape } from './AmbientShape';
import { BlueprintCorners } from './BlueprintCorners';
import { Reveal } from './Reveal';

/**
 * Who it's for — the four personas mapped to their respective surfaces.
 * Styled with subtle, theme-coherent gradients, tinted icon wells, and
 * soft glowing hover states.
 */
const ROLES = [
  {
    tag: 'ADMIN · ARCHITECT',
    title: 'Salesforce Admin / Architect',
    body: 'Build an Agentforce agent in plain language (topics, actions, and reasoning wired through the Agentforce toolchain), then iterate and deploy from chat.',
    surface: 'Chat · Agents list',
    icon: Bot,
    cardBg: 'bg-gradient-to-br from-blue-50/70 via-white to-white',
    cardBorder: 'border-blue-200/70 hover:border-brand-blue/40',
    cardShadow: 'hover:shadow-[0_12px_28px_rgba(26,107,255,0.08)]',
    tagClass: 'text-brand-blue',
    iconWell: 'bg-blue-50 border-blue-200/80 text-brand-blue',
    surfacePill: 'border-blue-100/80 bg-blue-50/60 text-brand-blue',
  },
  {
    tag: 'RELEASE · CHANGE MANAGER',
    title: 'Release / Change Manager',
    body: 'Turn a request into a governed change: intent, blast radius, refusal gates, dry-run, signed deploy, with the full evidence trail on Changes & Audit.',
    surface: 'Chat · Changes & Audit',
    icon: ShieldCheck,
    cardBg: 'bg-gradient-to-br from-emerald-50/70 via-white to-white',
    cardBorder: 'border-emerald-200/70 hover:border-emerald-400/50',
    cardShadow: 'hover:shadow-[0_12px_28px_rgba(16,185,129,0.08)]',
    tagClass: 'text-emerald-700',
    iconWell: 'bg-emerald-50 border-emerald-200/80 text-emerald-600',
    surfacePill: 'border-emerald-100/80 bg-emerald-50/60 text-emerald-700',
  },
  {
    tag: 'PLATFORM · DEV-OPS',
    title: 'DevOps / Platform Engineer',
    body: 'Connect Production, Sandbox, or Scratch orgs, watch package and license health self-heal, and mirror the signed audit log to GitHub.',
    surface: 'Settings · Org connections',
    icon: GitBranch,
    cardBg: 'bg-gradient-to-br from-indigo-50/70 via-white to-white',
    cardBorder: 'border-indigo-200/70 hover:border-indigo-400/50',
    cardShadow: 'hover:shadow-[0_12px_28px_rgba(99,102,241,0.08)]',
    tagClass: 'text-indigo-700',
    iconWell: 'bg-indigo-50 border-indigo-200/80 text-indigo-600',
    surfacePill: 'border-indigo-100/80 bg-indigo-50/60 text-indigo-700',
  },
  {
    tag: 'EXEC · REVIEWER',
    title: 'Exec / Reviewer',
    body: 'See agents, open changes, and recent activity at a glance, on a calm, read-only dashboard with no forms and no surprises.',
    surface: 'Dashboard · Audit trail',
    icon: Eye,
    cardBg: 'bg-gradient-to-br from-amber-50/60 via-white to-white',
    cardBorder: 'border-amber-200/70 hover:border-amber-400/50',
    cardShadow: 'hover:shadow-[0_12px_28px_rgba(245,158,11,0.08)]',
    tagClass: 'text-amber-700',
    iconWell: 'bg-amber-50 border-amber-200/80 text-amber-600',
    surfacePill: 'border-amber-100/80 bg-amber-50/60 text-amber-700',
  },
] as const;

export function Audience() {
  return (
    <section id="audience" className="scroll-mt-20 py-16 lg:py-20">
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <BlueprintCorners />
        <AmbientShape
          shape="orbits"
          size={120}
          soft
          className="-right-6 top-24 hidden opacity-40 lg:block"
        />

        <div className="mx-auto max-w-3xl text-center">
          <Reveal variant="mask-line">
            <h2 className="text-4xl font-bold tracking-[-0.02em] text-brand-dark sm:text-5xl">
              Built for the teams that run Salesforce
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-4 text-lg leading-relaxed text-text-secondary">
              One product, four jobs. Each role lands in the surface built for
              it, and all of them share one conversation, one login, and one
              audit trail.
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {ROLES.map((role, i) => {
            const Icon = role.icon;
            return (
              <Reveal key={role.tag} delay={i * 0.07}>
                <article
                  className={`flex h-full flex-col rounded-2xl border ${role.cardBorder} ${role.cardBg} p-7 shadow-soft transition-all duration-300 ${role.cardShadow} sm:p-8`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border shadow-xs ${role.iconWell}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span
                      className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] ${role.tagClass}`}
                    >
                      {role.tag}
                    </span>
                  </div>
                  <h3 className="mt-5 text-lg font-bold tracking-tight text-brand-dark">
                    {role.title}
                  </h3>
                  <p className="mt-2.5 leading-relaxed text-text-secondary">
                    {role.body}
                  </p>
                  <p className="mt-auto pt-6">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.18em] ${role.surfacePill}`}
                    >
                      {role.surface}
                    </span>
                  </p>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
