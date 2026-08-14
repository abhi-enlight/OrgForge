'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from 'framer-motion';
import {
  CircleCheck,
  FileSignature,
  Radar,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { EASE_OUT } from '@/lib/motion';

/**
 * LivePipeline: a real mini-version of the Forge chat surface (honest
 * component preview, not a fake screenshot) that loops a build sequence:
 *
 *   message types -> capability routes -> gates stream -> signed record
 *
 * The loop only runs while the stage is in view, pauses on hover/focus, and
 * collapses to the final frame under prefers-reduced-motion. All motion is
 * transform/opacity only.
 */

const USER_MESSAGE = 'Add a validation rule to Opportunity, then list my agents';

const PHASES = [
  { id: 'typing', label: 'ASK', duration: 1900 },
  { id: 'routing', label: 'ROUTE', duration: 900 },
  { id: 'working', label: 'GATES', duration: 4600 },
  { id: 'signed', label: 'SIGN', duration: 4000 },
] as const;

const WORK_STEPS = [
  'Impact analysis',
  'Ten refusal gates',
  'Dry-run on sandbox',
] as const;

const HMAC_LINE = 'HMAC-SHA256 a1f8…c4d9 · sig ok';

const spring = { type: 'spring', stiffness: 100, damping: 20 } as const;

export function LivePipeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { margin: '-15% 0px -15% 0px' });
  const reduce = useReducedMotion();
  const [paused, setPaused] = useState(false);

  // Elapsed ms within the looping build sequence. The ref holds the running
  // value (readable from the interval without re-creating it); the state is
  // a mirror that triggers renders. Pause/resume works by clearing/restarting
  // the interval from the ref's current value.
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const totalCycle = PHASES.reduce((sum, p) => sum + p.duration, 0);

  useEffect(() => {
    if (reduce || !inView || paused) return;
    const startedAt = Date.now() - elapsedRef.current;
    const id = window.setInterval(() => {
      elapsedRef.current = (Date.now() - startedAt) % totalCycle;
      setElapsed(elapsedRef.current);
    }, 60);
    return () => window.clearInterval(id);
  }, [reduce, inView, paused, totalCycle]);

  // Derive the current phase from elapsed (phase boundaries fixed).
  let acc = 0;
  let index = 0;
  for (let i = 0; i < PHASES.length; i += 1) {
    if (elapsed < acc + PHASES[i].duration) {
      index = i;
      break;
    }
    acc += PHASES[i].duration;
    index = i;
  }
  const phase = PHASES[index];
  const phaseStart = acc;
  const inPhase = Math.max(0, elapsed - phaseStart);
  const phaseProgress = Math.min(1, inPhase / phase.duration);

  const staticSigned = reduce;
  const showTyping = staticSigned ? true : phase.id === 'typing';
  const showRouting = staticSigned ? false : phase.id === 'routing';
  const showWorking = staticSigned ? false : phase.id === 'working';
  const showSigned = staticSigned ? true : phase.id === 'signed';

  const typedCount = Math.floor(phaseProgress * USER_MESSAGE.length);
  const typedText = showTyping
    ? USER_MESSAGE.slice(0, typedCount)
    : USER_MESSAGE;

  const workingStep = staticSigned
    ? WORK_STEPS.length - 1
    : Math.min(
        WORK_STEPS.length - 1,
        Math.floor(phaseProgress * WORK_STEPS.length),
      );

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      // tabIndex makes the pause mechanism reachable by keyboard (WCAG 2.2.2):
      // the loop auto-starts and runs >5s, so focus-to-pause is required.
      tabIndex={0}
      aria-label="Live build preview. Focus or hover to pause."
      className="relative rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
    >
      {/* blueprint halo behind the stage */}
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[2.5rem]"
        style={{
          background:
            'radial-gradient(circle at 30% 20%, rgba(26, 107, 255, 0.14) 0%, rgba(26, 107, 255, 0.03) 55%, transparent 75%)',
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-brand-border bg-white p-5 shadow-lift sm:p-6">
        {/* window chrome: blueprint grid + header */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(rgba(10, 15, 30, 0.05) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />
        <div className="relative flex items-center justify-between border-b border-brand-border pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-blue-light">
              <Sparkles className="h-3.5 w-3.5 text-brand-blue" />
            </div>
            {/* DESIGN.md §3 micro-caption: mono uppercase wide-tracking */}
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-brand-dark">
              Forge copilot
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
            {phase.label}
          </span>
        </div>

        <div className="relative mt-5 space-y-4">
          {/* user message, types itself in the ASK phase */}
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-3xl rounded-tr-sm bg-gradient-to-br from-brand-blue to-[#0d47a1] px-4 py-2.5 text-sm text-white shadow-soft">
              {typedText}
              {showTyping && !staticSigned && (
                <span className="ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 animate-pulse bg-white/80" />
              )}
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {showRouting && (
              <motion.div
                key="routing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={spring}
                className="flex items-center gap-2 pl-1"
              >
                <span className="rounded-full border border-brand-pass/40 bg-brand-pass-bg px-2.5 py-1 text-[11px] font-semibold text-brand-pass">
                  Org change
                </span>
                <span className="flex items-center gap-1" aria-hidden>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-blue" />
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-blue"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-blue"
                    style={{ animationDelay: '300ms' }}
                  />
                </span>
              </motion.div>
            )}

            {showWorking && (
              <motion.div
                key="working"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={spring}
                className="rounded-xl border border-brand-border bg-brand-surface/60 p-4"
              >
                <div className="flex items-center gap-2">
                  <Radar className="h-4 w-4 text-brand-blue" />
                  <p className="text-sm font-semibold text-brand-dark">
                    Governed change
                  </p>
                </div>
                <ul className="mt-3 space-y-2.5">
                  {WORK_STEPS.map((step, i) => {
                    const done = i <= workingStep;
                    const isCurrent = i === workingStep && !staticSigned;
                    return (
                      <li key={step} className="flex items-center gap-2.5">
                        <CircleCheck
                          className={`h-3.5 w-3.5 shrink-0 ${
                            done ? 'text-brand-pass' : 'text-brand-border'
                          }`}
                        />
                        <span className="flex-1 text-xs text-text-secondary">
                          {step}
                        </span>
                        <span className="h-1 w-16 overflow-hidden rounded-full bg-brand-border">
                          <motion.span
                            className="block h-full origin-left rounded-full bg-brand-blue"
                            initial={{ scaleX: 0 }}
                            animate={{
                              scaleX: done ? 1 : isCurrent ? 0.55 : 0,
                            }}
                            transition={{ duration: 0.4, ease: EASE_OUT }}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            )}

            {showSigned && (
              <motion.div
                key="signed"
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6 }}
                transition={spring}
                className="rounded-xl border border-brand-pass/40 bg-white p-4 shadow-soft"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-brand-pass" />
                  <p className="text-sm font-semibold text-brand-dark">
                    Signed record
                  </p>
                  <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-brand-pass">
                    <FileSignature className="h-3 w-3" />
                    done
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                  Validation rule on Opportunity: impact low, no refusal gates
                  tripped. Deploy complete.
                </p>
                <p className="mt-3 rounded-lg border border-brand-border bg-brand-surface/60 px-3 py-2 font-mono text-[11px] text-text-secondary">
                  {HMAC_LINE}
                </p>
                <div className="mt-3 flex gap-1.5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-1 flex-1 overflow-hidden rounded-full bg-brand-border"
                    >
                      <motion.div
                        className="h-full origin-left rounded-full bg-brand-pass"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 0.5, delay: i * 0.08, ease: EASE_OUT }}
                      />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* affordance while the signed frame holds before replay */}
          {showSigned && !staticSigned && (
            <p className="pl-1 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
              Hover to pause
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
