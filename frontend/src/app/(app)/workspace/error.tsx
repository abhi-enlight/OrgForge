'use client';

import React, { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Workspace session error:', error);
  }, [error]);

  return (
    <div className="max-w-xl mx-auto my-12 p-8 bg-white rounded-2xl border border-rose-200 shadow-xl space-y-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mx-auto">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <h2 className="text-xl font-bold text-brand-dark">Workspace Session Exception</h2>
      <p className="text-xs text-slate-500 font-mono bg-rose-50 p-3 rounded-lg border border-rose-100">
        {error.message || 'An unexpected error occurred in the 10-stage operator session.'}
      </p>
      <Button
        variant="primary"
        size="md"
        onClick={() => reset()}
        leftIcon={<RefreshCw className="w-4 h-4" />}
      >
        Reset Workspace State
      </Button>
    </div>
  );
}
