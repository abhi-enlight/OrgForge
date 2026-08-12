'use client';

import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import { EASE_OUT } from '@/lib/motion';

interface CardProps extends HTMLMotionProps<'div'> {
  children: React.ReactNode;
  variant?: 'default' | 'glass' | 'dashed' | 'pass' | 'refused' | 'interactive';
  className?: string;
  isHoverable?: boolean;
}

export default function Card({
  children,
  variant = 'default',
  className,
  isHoverable = false,
  ...props
}: CardProps) {
  const variants = {
    default: 'bg-white border border-brand-border shadow-soft rounded-2xl',
    glass: 'glass-panel rounded-2xl shadow-soft',
    dashed: 'bg-white border border-dashed border-brand-border-dashed rounded-2xl',
    pass: 'bg-emerald-50/70 border border-emerald-300/80 shadow-pass rounded-2xl',
    refused: 'bg-rose-50/70 border border-rose-300/80 shadow-refused rounded-2xl',
    interactive: 'bg-white border border-brand-border hover:border-brand-blue hover:shadow-card-hover transition-[box-shadow,border-color] duration-300 rounded-2xl cursor-pointer',
  };

  return (
    <motion.div
      whileHover={isHoverable ? { y: -3, transition: { duration: 0.2, ease: EASE_OUT } } : undefined}
      className={cn(variants[variant], 'p-6 relative overflow-hidden', (isHoverable || props.onClick) && 'cursor-pointer', className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}
