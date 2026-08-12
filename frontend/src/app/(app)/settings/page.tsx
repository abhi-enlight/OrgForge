import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import SettingsFlow from './settings-flow';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-6xl mx-auto space-y-4 animate-pulse">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-2xl border border-brand-border bg-white p-6 shadow-soft">
              <div className="h-4 w-40 rounded bg-brand-surface mb-4" />
              <div className="h-3 w-2/3 rounded bg-brand-surface/70" />
            </div>
          ))}
        </div>
      }
    >
      <SettingsFlow />
    </Suspense>
  );
}
