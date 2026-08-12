import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import LoginFlow from './login-flow';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-brand-blue border-t-transparent animate-spin" />
        </div>
      }
    >
      <LoginFlow />
    </Suspense>
  );
}
