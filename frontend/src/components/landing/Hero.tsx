'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { IsometricGrid } from './IsometricGrid';
import { LivePipeline } from './LivePipeline';
import { Reveal } from './Reveal';

export function Hero() {
  const reduce = useReducedMotion();
  // Depth parallax: ambient layers drift slower than content as the hero scrolls away.
  const { scrollY } = useScroll();
  const gridY = useTransform(scrollY, [0, 900], [0, 90]);
  const glowY = useTransform(scrollY, [0, 900], [0, 50]);
  // Scroll-scrubbed tilt: drafting plane falls back gently and fades smoothly
  const gridTilt = useTransform(scrollY, [0, 900], [10, 25]);
  const gridOpacity = useTransform(scrollY, [0, 900], [0.55, 0.22]);

  return (
    <section className="relative overflow-hidden">
      {/* blueprint texture: radial brand glow */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-72"
        style={{
          background:
            'linear-gradient(180deg, #f5f6fa 0%, rgba(255,255,255,0) 100%)',
        }}
      />
      {/* drafting table behind the stage: faint isometric plane drifting at depth */}
      <motion.div
        aria-hidden
        className="absolute inset-0 overflow-hidden"
        style={{ y: reduce ? 0 : gridY }}
      >
        <motion.div
          aria-hidden
          className="hidden h-full w-full lg:block"
          style={{
            transformPerspective: 1200,
            transformOrigin: 'top center',
            rotateX: reduce ? 10 : gridTilt,
            opacity: reduce ? 0.55 : gridOpacity,
          }}
        >
          <IsometricGrid strong={false} />
        </motion.div>
      </motion.div>
      <motion.div
        aria-hidden
        className="absolute -right-32 top-10 h-96 w-96 opacity-45 pointer-events-none"
        style={{
          y: reduce ? 0 : glowY,
          background:
            'radial-gradient(circle, rgba(26, 107, 255, 0.08) 0%, transparent 70%)',
        }}
      />

      <div className="relative mx-auto grid min-h-[100dvh] max-w-7xl grid-cols-1 items-center gap-12 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:pb-20 lg:pt-16">
        <div className="lg:col-span-5">
          <Reveal variant="fade">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand-blue">
              Forge by Enlight Lab
            </p>
          </Reveal>
          <Reveal variant="fade-up" delay={0.08}>
            <h1 className="mt-4 pb-2 text-5xl font-bold leading-[1.12] tracking-[-0.03em] text-brand-dark sm:text-6xl lg:text-7xl">
              One copilot for your whole Salesforce org
            </h1>
          </Reveal>
          <Reveal delay={0.2}>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-text-secondary">
              Build Agentforce agents and ship governed org changes from one
              conversation. Two skills, one assistant, fully signed.
            </p>
          </Reveal>
          <Reveal delay={0.3}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="group inline-flex items-center gap-2 rounded-full bg-brand-blue px-7 py-3.5 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:bg-brand-blue-hover hover:shadow-lift active:scale-[0.98]"
              >
                Open Forge
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#capabilities"
                className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-white px-7 py-3.5 text-sm font-semibold text-brand-dark transition-colors duration-200 hover:border-brand-blue hover:text-brand-blue"
              >
                See what it does
              </a>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.15} className="lg:col-span-7">
          <LivePipeline />
        </Reveal>
      </div>
    </section>
  );
}
