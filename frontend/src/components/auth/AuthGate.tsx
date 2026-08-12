'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Auth gate for the authenticated route group — client-side safety net that
 * backs up the middleware layer. Resolves the Supabase session on mount; without
 * one, redirects to /login. Subscribes to auth state changes so expiry or
 * sign-out from another tab immediately redirects without waiting for the next
 * API call to fail with 401.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ok'>('loading');

  useEffect(() => {
    let cancelled = false;

    // Initial session check
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
      setStatus('ok');
    })();

    // Real-time auth state listener — catches session expiry, sign-out from
    // another tab, token refresh failures, etc.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        router.replace('/login');
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-surface/40">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 rounded-full border-2 border-brand-blue border-t-transparent animate-spin" />
          <p className="text-sm font-medium">Loading your workspace…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

