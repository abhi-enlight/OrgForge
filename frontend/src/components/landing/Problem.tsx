'use client';

import { Check, X } from 'lucide-react';
import { AmbientShape } from './AmbientShape';
import { BlueprintCorners } from './BlueprintCorners';
import { Reveal } from './Reveal';

const TODAY = [
  {
    title: 'Changes land with unknown blast radius',
    body: 'Fields, validation rules, flows, and permission sets change daily without automated dependency checks.',
  },
  {
    title: 'No shared record across tools & teams',
    body: 'When a change ships, there is no single tamper-evident trail of what was modified, who approved it, and why.',
  },
  {
    title: 'Release tools check tickets, not impact',
    body: 'Pipelines gate on manual approvals, never verifying what downstream integrations will break in production.',
  },
] as const;

const WITH_FORGE = [
  {
    title: 'Impact analysis before anything moves',
    body: 'Every request is analyzed for blast radius across data, permissions, and external integrations first.',
  },
  {
    title: 'Ten refusal gates stop high-risk work',
    body: 'Destructive metadata and risky deploys are blocked upfront with plain-language explanations.',
  },
  {
    title: 'Dry-run, signed deploy, tamper-evident trail',
    body: 'Tested on sandbox, deployed with an HMAC signature, and permanently recorded in an auditable ledger.',
  },
] as const;

export function Problem() {
  return (
    <section id="problem" className="scroll-mt-20 py-16 lg:py-24">
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <BlueprintCorners />
        <AmbientShape
          shape="brackets"
          size={96}
          glow="ink"
          soft
          className="-left-4 top-40 hidden opacity-40 lg:block"
        />

        {/* Clean Header */}
        <div className="max-w-2xl">
          <Reveal variant="fade">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand-blue">
              The governance gap
            </p>
          </Reveal>
          <Reveal variant="mask-line" delay={0.08}>
            <h2 className="mt-4 text-3xl font-bold tracking-[-0.02em] text-brand-dark sm:text-4xl lg:text-5xl">
              One edit can break a revenue integration
            </h2>
          </Reveal>
          <Reveal delay={0.15}>
            <p className="mt-4 text-base leading-relaxed text-text-secondary sm:text-lg">
              Salesforce orgs change faster than any team can safely govern. The
              fix isn&apos;t more process—it&apos;s making every change prove its
              impact before it ships.
            </p>
          </Reveal>
        </div>

        {/* Clean, Spacious 2-Column Comparison */}
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:gap-8">
          {/* Card 1: Today */}
          <Reveal delay={0.08}>
            <div className="flex h-full flex-col rounded-2xl border border-brand-border bg-white p-7 shadow-soft sm:p-8">
              <div className="flex items-center justify-between border-b border-brand-border pb-4">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-rose-600">
                  Today
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
                  Ungoverned
                </span>
              </div>

              <ul className="mt-6 space-y-6">
                {TODAY.map((item) => (
                  <li key={item.title} className="flex items-start gap-3">
                    <div className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                      <X className="h-3 w-3" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-brand-dark">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                        {item.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          {/* Card 2: With Forge */}
          <Reveal delay={0.16}>
            <div className="flex h-full flex-col rounded-2xl border border-brand-blue/30 bg-brand-blue-light/30 p-7 shadow-soft sm:p-8">
              <div className="flex items-center justify-between border-b border-brand-blue/15 pb-4">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-brand-blue">
                  With Forge
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-brand-pass font-bold">
                  Governed
                </span>
              </div>

              <ul className="mt-6 space-y-6">
                {WITH_FORGE.map((item) => (
                  <li key={item.title} className="flex items-start gap-3">
                    <div className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-brand-pass">
                      <Check className="h-3 w-3" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-brand-dark">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                        {item.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
