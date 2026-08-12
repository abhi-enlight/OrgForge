'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useSyncExternalStore, type ReactNode } from 'react';
import { EASE_REVEAL } from '@/lib/motion';

const emptySubscribe = () => () => {};

type RevealVariant = 'fade-up' | 'mask-line' | 'fade';

/**
 * Scroll-reveal wrapper (Live Blueprint motion system).
 *
 * The hidden initial state is gated behind a mounted snapshot
 * (useSyncExternalStore) so the server-rendered HTML is fully visible
 * (no opacity:0 for JS-off crawlers or pre-hydration flash); after mount,
 * elements animate in on scroll. Honors prefers-reduced-motion (everything
 * renders visible, instantly).
 *
 * Variants:
 *  - 'fade-up'  (default): opacity + translateY rise, for cards and body
 *  - 'mask-line': line-mask reveal (clip-path + translateY), for headlines
 *  - 'fade':       pure opacity crossfade, for eyebrows/anchors
 */
export function Reveal({
  children,
  delay = 0,
  className,
  variant = 'fade-up',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  variant?: RevealVariant;
}) {
  const reduce = useReducedMotion();
  // Server + first client render: not mounted -> false -> content visible.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const animate = mounted && !reduce;

  const HIDDEN: Record<RevealVariant, Record<string, unknown>> = {
    'fade-up': { opacity: 0, y: 24 },
    'mask-line': { opacity: 0, y: '60%', clipPath: 'inset(0 0 100% 0)' },
    fade: { opacity: 0 },
  };
  const VISIBLE: Record<RevealVariant, Record<string, unknown>> = {
    'fade-up': { opacity: 1, y: 0 },
    'mask-line': { opacity: 1, y: '0%', clipPath: 'inset(-20px -20px -20px -20px)' },
    fade: { opacity: 1 },
  };

  return (
    <motion.div
      className={className}
      // Motion's own types reject these per-variant objects (clipPath unions
      // explode the union type); the shapes are literal and motion validates
      // them at runtime, so this cast is the documented escape hatch.
      initial={animate ? (HIDDEN[variant] as never) : false}
      whileInView={animate ? (VISIBLE[variant] as never) : undefined}
      viewport={{ once: true, amount: 0.25 }}
      transition={{
        duration: variant === 'mask-line' ? 0.8 : 0.6,
        delay,
        ease: EASE_REVEAL,
      }}
    >
      {children}
    </motion.div>
  );
}
