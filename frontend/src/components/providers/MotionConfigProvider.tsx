'use client';

import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * App-wide motion safety: with reducedMotion="user", every framer-motion
 * component in the tree automatically disables transform/layout animation
 * when the OS prefers reduced motion, while keeping opacity feedback.
 * Components that already gate themselves with useReducedMotion() are
 * unaffected (this is a floor, not a ceiling).
 */
export function MotionConfigProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
