'use client';

import { Bot, GitBranch, ShieldCheck, Waypoints } from 'lucide-react';
import { AmbientShape } from './AmbientShape';
import { BlueprintCorners } from './BlueprintCorners';
import { Reveal } from './Reveal';

const YAML_ARTIFACT = `name: support_agent
description: Triage and resolve support cases
topics:
  - case_triage
  - order_status
instructions:
  - Use the case topic, never promise refunds
actions:
  - case: getCaseById
  - case: updateCaseStatus`;

export function Capabilities() {
  return (
    <section
      id="capabilities"
      className="scroll-mt-20 bg-brand-surface/60 py-16 lg:py-20"
    >
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <BlueprintCorners />
        <AmbientShape
          shape="hex"
          size={104}
          glow="ink"
          soft
          className="-right-6 top-40 hidden opacity-50 lg:block"
        />
        <Reveal variant="fade">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand-blue">
            The two engines
          </p>
        </Reveal>
        <Reveal variant="mask-line" delay={0.08}>
          <h2 className="mt-4 max-w-2xl text-4xl font-bold tracking-[-0.02em] text-brand-dark sm:text-5xl">
            Two skills, one assistant
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-text-secondary">
            The copilot routes every request to the right engine, so agent work
            and org work share one login, one chat, and one audit trail.
          </p>
        </Reveal>

        {/* asymmetric rail: 2/3 artifact panel + 1/3 stacked panel */}
        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Reveal className="lg:col-span-2" delay={0.05}>
            <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-brand-dark bg-brand-dark p-7 transition-shadow duration-300 hover:shadow-lift sm:p-9">
              {/* blueprint-on-dark texture */}
              <div
                aria-hidden
                className="absolute inset-0 opacity-60 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  backgroundImage:
                    'radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
                    agentforce · .agent
                  </span>
                </div>
                <h3 className="mt-6 text-2xl font-bold tracking-tight text-white">
                  Build agents
                </h3>
                <p className="mt-3 max-w-lg leading-relaxed text-white/70">
                  Describe a support agent in plain language and Forge generates
                  the .agent file, wiring topics, actions, and reasoning
                  instructions through the real Agentforce toolchain.
                </p>
                <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black/25">
                  <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
                    <span className="h-2 w-2 rounded-full bg-white/20" />
                    <span className="h-2 w-2 rounded-full bg-white/20" />
                    <span className="h-2 w-2 rounded-full bg-white/20" />
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/60">
                      support_agent.agent
                    </span>
                  </div>
                  <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12px] leading-relaxed text-[#a8c7ff]">
                    {YAML_ARTIFACT}
                  </pre>
                </div>
                <ul className="mt-6 flex flex-wrap gap-2">
                  {['Deploys with permission sets attached', 'Tests against your org'].map(
                    (b) => (
                      <li
                        key={b}
                        className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80"
                      >
                        {b}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </article>
          </Reveal>

          {/* right column: routing annotation + stacked org-change panel */}
          <Reveal delay={0.15} className="flex flex-col">
            <div className="hidden flex-1 items-center gap-3 lg:flex pb-3">
              <span className="h-px flex-1 bg-brand-border" aria-hidden />
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-brand-blue font-semibold">
                <Waypoints className="h-3.5 w-3.5 text-brand-blue" />
                classifier routes
              </span>
              <span className="h-px flex-1 bg-brand-border" aria-hidden />
            </div>
            <article className="group mt-6 flex h-full flex-col rounded-2xl border border-brand-border bg-white p-7 shadow-soft transition-[box-shadow,border-color] duration-300 hover:border-brand-blue/30 hover:shadow-lift sm:p-8 lg:mt-0">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-blue-light border border-brand-blue/15">
                <GitBranch className="h-5 w-5 text-brand-blue" />
              </div>
              <h3 className="mt-6 text-xl font-bold tracking-tight text-brand-dark">
                Governed org changes
              </h3>
              <p className="mt-3 leading-relaxed text-text-secondary">
                Add fields, validation rules, or layouts through a governed
                pipeline: intent, impact analysis, refusal gates, dry-run, then
                a signed deploy with an audit record.
              </p>
              <div className="mt-auto flex items-start gap-2.5 pt-6">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-pass" />
                <p className="text-sm text-text-secondary">
                  Ten refusal gates before anything ships. Every record
                  HMAC-signed for the trail.
                </p>
              </div>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
