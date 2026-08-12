'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { EASE_OUT } from '@/lib/motion';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  error: <XCircle className="w-4 h-4 text-rose-500" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-500" />,
  info: <Info className="w-4 h-4 text-brand-blue" />,
};

const BORDER = {
  success: 'border-emerald-200',
  error: 'border-rose-200',
  warning: 'border-amber-200',
  info: 'border-blue-200',
};

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((type: Toast['type'], title: string, message?: string) => {
    const id = `toast-${++toastCounter}`;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    // Errors need longer to read than ephemeral confirmations.
    const duration = type === 'error' ? 10000 : 6000;
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value: ToastContextValue = {
    toasts,
    success: (title, msg) => push('success', title, msg),
    error: (title, msg) => push('error', title, msg),
    warning: (title, msg) => push('warning', title, msg),
    info: (title, msg) => push('info', title, msg),
    dismiss,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container — fixed bottom-right */}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none w-80 sm:w-96"
      >
        {toasts.length > 1 && (
          <button
            onClick={() => setToasts([])}
            className="self-end pointer-events-auto text-[11px] font-semibold text-slate-500 bg-white/90 backdrop-blur border border-brand-border rounded-full px-3 py-1 shadow-soft hover:text-brand-blue transition-colors cursor-pointer"
          >
            Dismiss all
          </button>
        )}
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              role="alert"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className={`pointer-events-auto flex items-start gap-3 bg-white border ${BORDER[t.type]} rounded-xl shadow-lg p-4`}
            >
              <div className="mt-0.5 shrink-0">{ICONS[t.type]}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-brand-dark leading-tight">{t.title}</p>
                {t.message && (
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{t.message}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
