'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, leftIcon, rightIcon, type = 'text', ...props }, ref) => {
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label className="block text-xs font-semibold uppercase tracking-wider text-brand-dark/70">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="absolute left-3.5 text-slate-400 pointer-events-none">
              {leftIcon}
            </span>
          )}
          <input
            type={type}
            className={cn(
              'w-full bg-white text-brand-dark text-sm rounded-xl py-3 px-4 border border-brand-border placeholder:text-slate-400 transition-[border-color,box-shadow] duration-200 focus:outline-none focus:border-brand-blue focus:ring-4 focus:ring-brand-blue/15 disabled:bg-brand-surface disabled:cursor-not-allowed',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              error && 'border-brand-refused focus:border-brand-refused focus:ring-brand-refused/15',
              className
            )}
            ref={ref}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3.5 text-slate-400 flex items-center">
              {rightIcon}
            </span>
          )}
        </div>
        {error ? (
          <p className="text-xs text-brand-refused font-medium">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-slate-500">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
