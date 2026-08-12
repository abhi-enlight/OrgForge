'use client';

import { useEffect } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Optionally log the error to an error reporting service
    console.error('Route boundary caught error:', error);
  }, [error]);

  return (
    <div className="flex h-[80vh] flex-col items-center justify-center p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500 mb-4">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-slate-900">
        Something went wrong
      </h2>
      <p className="mb-6 max-w-md text-sm text-slate-500">
        We ran into an unexpected issue while loading this page. Our team has been notified.
      </p>
      <button
        onClick={() => reset()}
        className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
      >
        <RotateCcw className="h-4 w-4" />
        Try again
      </button>
      {process.env.NODE_ENV === 'development' && (
        <pre className="mt-8 max-w-2xl overflow-auto rounded-lg bg-slate-950 p-4 text-left text-xs text-slate-300">
          {error.message}
          {error.stack && `\n\n${error.stack}`}
        </pre>
      )}
    </div>
  );
}
