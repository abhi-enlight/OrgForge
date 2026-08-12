'use client';

import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'pass' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  className?: string;
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-xl transition-[background-color,color,border-color,box-shadow,transform] duration-200 focus:outline-none focus:ring-4 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer select-none';

  const variants = {
    primary: 'bg-brand-blue text-white hover:bg-brand-blue-hover shadow-lg shadow-brand-blue/25 focus:ring-brand-blue/20 active:scale-[0.98]',
    secondary: 'bg-brand-surface text-brand-dark hover:bg-brand-border border border-brand-border focus:ring-brand-dark/10 active:scale-[0.98]',
    outline: 'bg-white text-brand-dark border border-brand-border hover:border-brand-blue hover:text-brand-blue focus:ring-brand-blue/15 active:scale-[0.98]',
    danger: 'bg-brand-refused text-white hover:bg-red-600 shadow-md shadow-brand-refused/20 focus:ring-brand-refused/20 active:scale-[0.98]',
    pass: 'bg-brand-pass text-white hover:bg-emerald-600 shadow-md shadow-brand-pass/20 focus:ring-brand-pass/20 active:scale-[0.98]',
    ghost: 'bg-transparent text-brand-dark hover:bg-brand-surface hover:text-brand-blue focus:ring-brand-blue/10',
  };

  const sizes = {
    sm: 'text-xs px-3 py-1.5 gap-1.5 rounded-lg',
    md: 'text-sm px-4 py-2.5 gap-2 rounded-xl',
    lg: 'text-base px-6 py-3.5 gap-2.5 rounded-2xl font-semibold',
  };

  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-current" />
      ) : leftIcon ? (
        <span className="shrink-0">{leftIcon}</span>
      ) : null}
      <span>{children}</span>
      {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </motion.button>
  );
}
