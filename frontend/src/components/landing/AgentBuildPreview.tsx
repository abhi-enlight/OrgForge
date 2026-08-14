'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Bot, Check } from 'lucide-react';
import { EASE_OUT } from '@/lib/motion';

const CODE_LINES = [
  { text: 'name: support_agent', type: 'key-val', key: 'name:', val: ' support_agent' },
  { text: 'description: Triage and resolve support cases', type: 'key-val', key: 'description:', val: ' Triage and resolve support cases' },
  { text: 'topics:', type: 'section', key: 'topics:' },
  { text: '  - case_triage', type: 'bullet', bullet: '  -', val: ' case_triage' },
  { text: '  - order_status', type: 'bullet', bullet: '  -', val: ' order_status' },
  { text: 'instructions:', type: 'section', key: 'instructions:' },
  { text: '  - Use the case topic, never promise refunds', type: 'bullet', bullet: '  -', val: ' Use the case topic, never promise refunds' },
  { text: 'actions:', type: 'section', key: 'actions:' },
  { text: '  - case: getCaseById', type: 'action', bullet: '  -', prefix: ' case:', val: ' getCaseById' },
  { text: '  - case: updateCaseStatus', type: 'action', bullet: '  -', prefix: ' case:', val: ' updateCaseStatus' },
];

const CYCLE_DURATION = 8000; // 8s total loop
const WRITE_DURATION = 3600; // 3.6s line-by-line reveal

export function AgentBuildPreview() {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { margin: '-10% 0px -10% 0px' });
  const reduce = useReducedMotion();
  const [paused, setPaused] = useState(false);

  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (reduce || !inView || paused) return;
    const startedAt = Date.now() - elapsedRef.current;
    const id = window.setInterval(() => {
      elapsedRef.current = (Date.now() - startedAt) % CYCLE_DURATION;
      setElapsed(elapsedRef.current);
    }, 40);
    return () => window.clearInterval(id);
  }, [reduce, inView, paused]);

  // Number of visible lines based on time elapsed
  const progress = Math.min(1, elapsed / WRITE_DURATION);
  const visibleCount = reduce
    ? CODE_LINES.length
    : Math.max(1, Math.floor(progress * CODE_LINES.length));
  const isComplete = reduce || elapsed >= WRITE_DURATION;

  return (
    <article
      ref={containerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      tabIndex={0}
      aria-label="Agentforce agent builder preview. Focus or hover to pause."
      className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-brand-dark bg-brand-dark p-7 shadow-lift outline-none transition-[box-shadow,border-color] duration-300 focus-visible:ring-2 focus-visible:ring-brand-blue/50 sm:p-9"
    >
      {/* Subtle blueprint grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-40 transition-opacity duration-300 group-hover:opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative z-10">
        {/* Card Header */}
        <div className="flex items-center justify-between">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
            agentforce · .agent
          </span>
        </div>

        {/* Title & Description */}
        <h3 className="mt-6 text-2xl font-bold tracking-tight text-white">
          Build agents
        </h3>
        <p className="mt-3 max-w-lg leading-relaxed text-white/70">
          Describe a support agent in plain language and OrgForge generates
          the .agent file, wiring topics, actions, and reasoning
          instructions through the Agentforce toolchain.
        </p>

        {/* Clean, spacious Code Artifact Window */}
        <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-white/20" />
              <span className="h-2 w-2 rounded-full bg-white/20" />
              <span className="h-2 w-2 rounded-full bg-white/20" />
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/60">
                support_agent.agent
              </span>
            </div>
            {!reduce && !isComplete && (
              <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-[#85b7ff]">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-blue animate-ping" />
                generating
              </span>
            )}
          </div>

          <div className="p-4 sm:p-5 font-mono text-[12px] sm:text-[13px] leading-relaxed overflow-x-auto min-h-[230px]">
            <div className="space-y-1">
              {CODE_LINES.slice(0, visibleCount).map((line, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="flex items-center"
                >
                  {line.type === 'key-val' && (
                    <>
                      <span className="text-[#79c0ff]">{line.key}</span>
                      <span className="text-[#a5d6ff]">{line.val}</span>
                    </>
                  )}
                  {line.type === 'section' && (
                    <span className="text-[#d2a8ff] font-medium">{line.key}</span>
                  )}
                  {line.type === 'bullet' && (
                    <>
                      <span className="text-white/40">{line.bullet}</span>
                      <span className="text-[#a5d6ff]">{line.val}</span>
                    </>
                  )}
                  {line.type === 'action' && (
                    <>
                      <span className="text-white/40">{line.bullet}</span>
                      <span className="text-[#79c0ff]">{line.prefix}</span>
                      <span className="text-[#7ee787]">{line.val}</span>
                    </>
                  )}
                </motion.div>
              ))}

              {!reduce && !isComplete && visibleCount < CODE_LINES.length && (
                <span className="inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-brand-blue" />
              )}
            </div>
          </div>
        </div>

        {/* Spacious feature tags */}
        <ul className="mt-6 flex flex-wrap gap-2.5">
          <li
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs transition-colors duration-300 ${
              isComplete
                ? 'border-white/20 bg-white/10 text-white font-medium'
                : 'border-white/10 bg-white/5 text-white/70'
            }`}
          >
            {isComplete && <Check className="h-3.5 w-3.5 text-brand-pass" />}
            <span>Deploys with permission sets attached</span>
          </li>

          <li
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs transition-colors duration-300 ${
              isComplete
                ? 'border-white/20 bg-white/10 text-white font-medium'
                : 'border-white/10 bg-white/5 text-white/70'
            }`}
          >
            {isComplete && <Check className="h-3.5 w-3.5 text-brand-pass" />}
            <span>Tests against your org.</span>
          </li>
        </ul>
      </div>
    </article>
  );
}
