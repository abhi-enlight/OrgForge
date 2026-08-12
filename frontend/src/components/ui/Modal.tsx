'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE_OUT } from '@/lib/motion';

interface ModalProps {
  isOpen: boolean;
  /** Optional — when omitted, no close button is rendered and the modal is
   * not dismissible (used for required one-time steps like name capture). */
  onClose?: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-brand-dark/40 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className={cn(
              'relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-brand-border p-6 z-10 space-y-4',
              className
            )}
          >
            <div className="flex items-start justify-between">
              <div>
                {title && <h3 className="text-lg font-bold text-brand-dark">{title}</h3>}
                {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
              </div>
              {onClose && (
                <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-brand-dark transition-colors p-1 rounded-lg hover:bg-brand-surface cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <div>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
