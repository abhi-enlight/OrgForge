'use client';

import { useRef } from 'react';
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'framer-motion';
import { PlugZap, MessageSquareText, BadgeCheck } from 'lucide-react';
import { AmbientShape } from './AmbientShape';
import { BlueprintCorners } from './BlueprintCorners';
import { IsometricGrid } from './IsometricGrid';
import { Reveal } from './Reveal';

const STAGES = [
  {
    icon: PlugZap,
    title: 'Connect your org',
    body: 'One OAuth login to Salesforce. Pick Production, Sandbox, or Scratch and OrgForge indexes your org context.',
  },
  {
    icon: MessageSquareText,
    title: 'Ask in plain language',
    body: 'Describe what you want built or changed. The copilot routes to the right engine and shows its plan as it works.',
  },
  {
    icon: BadgeCheck,
    title: 'Review and ship',
    body: 'Review the safety impact, confirm any clarifications, and deploy with one click. Every change is recorded in your audit log.',
  },
] as const;

/**
 * Blueprint pipeline rail. The connector line draws itself as the rail enters
 * the viewport (pathLength scrub), the page's one scroll-linked draw, and the
 * only place the blueprint motif carries meaning (progress through stages).
 */
export function HowItWorks() {
  const railRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: railRef,
    offset: ['start 0.85', 'end 0.35'],
  });
  const draw = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section id="how-it-works" className="scroll-mt-20 bg-brand-surface/60 py-16 lg:py-20">
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <BlueprintCorners />
        {/* faint drafting plane beneath the rail (Pass 42): the pipeline sits
            on a blueprint sheet instead of blank white */}
        <div className="pointer-events-none absolute inset-x-0 top-8 hidden h-80 overflow-hidden opacity-35 lg:block">
          <IsometricGrid />
        </div>
        <AmbientShape
          shape="brackets"
          size={96}
          glow="ink"
          soft
          className="-left-4 top-52 hidden opacity-45 lg:block"
        />
        <Reveal variant="mask-line">
          <h2 className="max-w-2xl text-4xl font-bold tracking-[-0.02em] text-brand-dark sm:text-5xl">
            From request to signed record
          </h2>
        </Reveal>

        <div ref={railRef} className="relative mt-14 lg:mt-20">
          {/* connector rail: left-aligned vertical line, desktop and mobile */}
          <div
            aria-hidden
            className="absolute bottom-4 left-[22px] top-2 w-px bg-brand-border lg:left-[30px]"
          />
          <motion.svg
            aria-hidden
            className="absolute bottom-4 left-[22px] top-2 w-px lg:left-[30px]"
            viewBox="0 0 2 100"
            preserveAspectRatio="none"
          >
            <motion.line
              x1="1"
              y1="0"
              x2="1"
              y2="100"
              stroke="var(--color-brand-blue)"
              strokeWidth="2"
              style={{ pathLength: reduce ? 1 : draw }}
            />
          </motion.svg>

          <ol className="space-y-10 lg:space-y-14">
            {STAGES.map((stage, i) => (
              <Reveal key={stage.title} delay={i * 0.08}>
                <li className="relative pl-16 lg:pl-24">
                  <div className="absolute left-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl border border-brand-border bg-white shadow-soft lg:h-[60px] lg:w-[60px]">
                    <stage.icon className="h-5 w-5 text-brand-blue lg:h-6 lg:w-6" />
                  </div>
                  <h3 className="text-xl font-bold tracking-tight text-brand-dark lg:text-2xl">
                    {stage.title}
                  </h3>
                  <p className="mt-2.5 max-w-xl leading-relaxed text-text-secondary">
                    {stage.body}
                  </p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
