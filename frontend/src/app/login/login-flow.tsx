'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, Cloud, FlaskConical, Check, ArrowRight, ArrowLeft, Github, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { apiFetch, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ForgeLogo } from '@/components/brand/ForgeLogo';
import GithubConnectCard from '@/components/settings/GithubConnectCard';

const LEGACY_TOKEN_KEY = 'auth_token'; // Agentforge legacy session token (EC-02)

const ORG_TYPES = [
  {
    id: 'production' as const,
    label: 'Production',
    description: 'A live Salesforce org',
    icon: Zap,
  },
  {
    id: 'sandbox' as const,
    label: 'Sandbox',
    description: 'test.salesforce.com org',
    icon: Cloud,
  },
  {
    id: 'scratch' as const,
    label: 'Scratch',
    description: 'Temporary dev org',
    icon: FlaskConical,
  },
];

/**
 * Step 1 of onboarding: one-time legacy token re-link (plan §8.4, EC-02).
 * If a legacy `auth_token` is in localStorage, POST it to link-legacy once
 * (best-effort) and destroy it — re-parenting the user's org connections.
 */
async function linkLegacyOnce(): Promise<void> {
  try {
    const legacyToken = window.localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!legacyToken) return;
    try {
      await apiFetch('/api/v1/auth/link-legacy', {
        method: 'POST',
        body: JSON.stringify({ legacyToken }),
      });
    } catch {
      /* the re-link is best-effort by design — never blocks onboarding */
    } finally {
      window.localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
  } catch {
    /* storage unavailable */
  }
}

async function hasConnectedOrgs(): Promise<boolean> {
  try {
    const { orgs } = await apiFetch<{ orgs: unknown[] }>('/api/v1/orgs');
    return Array.isArray(orgs) && orgs.length > 0;
  } catch {
    return false;
  }
}

/**
 * 3-step onboarding (§12.2): sign in (Supabase) → connect Salesforce
 * (Production/Sandbox/Scratch OAuth) → ready, optional GitHub.
 */
export default function LoginFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedStep = Number(searchParams.get('step')) || 1;
  const oauthError = searchParams.get('error');

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectedOrgName, setConnectedOrgName] = useState<string | null>(null);
  const [checkingOrgs, setCheckingOrgs] = useState(false);

  // Recover position: signed-in users jump past step 1; ?step=2/3 (from the
  // header / connect CTA) jumps straight to that step.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (requestedStep === 2 || requestedStep === 3) setStep(requestedStep);
        return;
      }
      const connected = await hasConnectedOrgs();
      if (connected) {
        setStep(3);
        router.replace('/login?step=3');
      } else {
        setStep(requestedStep === 3 ? 3 : 2);
      }
    })();
  }, [requestedStep, router]);

  // After the Salesforce OAuth round-trip lands back here, detect the new org
  // and advance to step 3 automatically.
  useEffect(() => {
    if (step !== 2 || connectedOrgName) return;
    let cancelled = false;
    const poll = async () => {
      setCheckingOrgs(true);
      try {
        const { orgs } = await apiFetch<{ orgs: Array<{ alias?: string }> }>('/api/v1/orgs');
        if (cancelled) return;
        if (Array.isArray(orgs) && orgs.length > 0) {
          setConnectedOrgName(orgs[0].alias || 'your org');
        }
      } catch {
        /* still connecting */
      } finally {
        if (!cancelled) setCheckingOrgs(false);
      }
    };
    poll();
    const timer = setInterval(poll, 4000);
    const stop = setTimeout(() => clearInterval(timer), 60_000); // give up after 1 min
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [step, connectedOrgName]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setAuthError(null);
    try {
      if (isSignUp) {
        // Guard whitespace-only input — the browser `required` attribute
        // accepts "   ", and an empty stored name would re-trigger the
        // one-time capture modal on next sign-in.
        const trimmedName = fullName.trim();
        if (!trimmedName) {
          setAuthError('Please enter your full name.');
          return;
        }
        // Store the full name on the auth user (user_metadata → auth.users) so
        // the dashboard can greet them personally on every future sign-in.
        const { error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: trimmedName } },
        });
        if (signUpErr) throw new Error(signUpErr.message);
        // Supabase email confirmation may be required — attempt the session anyway.
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      await linkLegacyOnce(); // EC-02 — one-time re-link, then destroy the token
      const connected = await hasConnectedOrgs();
      setStep(connected ? 3 : 2);
    } catch (err) {
      setAuthError(getErrorMessage(err, 'Could not sign in. Check your email and password.'));
    } finally {
      setBusy(false);
    }
  };

  const startConnect = async (orgType: 'production' | 'sandbox' | 'scratch') => {
    setConnecting(orgType);
    setConnectError(null);
    try {
      const { authUrl } = await apiFetch<{ authUrl: string; state: string }>('/api/v1/auth/salesforce/connect', {
        method: 'POST',
        body: JSON.stringify({ orgType }),
      });
      if (!authUrl) throw new Error('No OAuth URL returned');
      window.location.assign(authUrl);
    } catch (err) {
      setConnectError(
        getErrorMessage(err, 'Could not start Salesforce sign-in. Make sure the backend is running (port 3001).')
      );
    } finally {
      setConnecting(null);
    }
  };

  const Steps = [1, 2, 3];

  return (
    <div className="min-h-screen bg-hero-gradient flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* Logo → back to the landing page */}
          <ForgeLogo href="/" size="lg" className="justify-center mb-4" />
          <p className="text-sm text-slate-500 mt-1">
            Salesforce AI agents &amp; governed org changes
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {Steps.map((s) => (
            <div key={s} className="flex items-center gap-2">
              {s > 1 && <div className={cn('w-8 h-px', step >= s ? 'bg-brand-blue' : 'bg-brand-border')} />}
              <span
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors',
                  step > s
                    ? 'bg-brand-blue text-white'
                    : step === s
                      ? 'bg-brand-blue text-white shadow-glow'
                      : 'bg-brand-surface text-slate-400'
                )}
              >
                {step > s ? <Check className="w-3 h-3" /> : s}
              </span>
            </div>
          ))}
        </div>

        {oauthError && (
          <div className="mb-6 rounded-xl border border-brand-refused/30 bg-brand-refused-bg px-4 py-3 text-sm text-brand-refused animate-fade-in">
            Salesforce sign-in failed: {oauthError}
          </div>
        )}

        {/* ── Step 1: sign in ─────────────────────────────────────────────── */}
        {step === 1 && (
          <form
            onSubmit={signIn}
            className="bg-white rounded-2xl border border-brand-border shadow-lift p-6 space-y-4 animate-slide-up"
          >
            <div>
              <h2 className="font-semibold text-brand-dark">Sign in</h2>
              <p className="text-sm text-slate-500 mt-0.5">Continue to your workspace.</p>
            </div>

            {isSignUp && (
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium text-slate-700 mb-1">
                  Full name
                </label>
                <input
                  id="fullName"
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-xl border border-brand-border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-shadow"
                  placeholder="Alex Morgan"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-brand-border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-shadow"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-brand-border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-shadow"
                placeholder="••••••••"
              />
            </div>

            {authError && <p className="text-sm text-brand-refused">{authError}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-blue text-white font-semibold py-2.5 hover:bg-brand-blue-hover transition-colors disabled:opacity-60 cursor-pointer"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSignUp ? 'Create account' : 'Sign in'}
            </button>

            <p className="text-sm text-slate-500 text-center">
              {isSignUp ? 'Already have an account?' : "New to OrgForge?"}{' '}
              <button
                type="button"
                onClick={() => setIsSignUp((v) => !v)}
                className="text-brand-blue font-medium hover:underline cursor-pointer"
              >
                {isSignUp ? 'Sign in' : 'Create account'}
              </button>
            </p>
          </form>
        )}

        {/* ── Step 2: connect Salesforce ──────────────────────────────────── */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-brand-border shadow-lift p-6 space-y-4 animate-slide-up">
            <div>
              <h2 className="font-semibold text-brand-dark">Connect Salesforce</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Pick the org type. OrgForge signs you in with Salesforce and checks everything else in the background.
              </p>
            </div>

            {connectedOrgName ? (
              <div className="rounded-xl border border-brand-pass/30 bg-brand-pass-bg px-4 py-3 flex items-center gap-3 animate-fade-in">
                <Check className="w-4 h-4 text-brand-pass shrink-0" />
                <p className="text-sm text-slate-700 flex-1">
                  Connected <span className="font-semibold">{connectedOrgName}</span>.
                </p>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="text-sm font-semibold text-brand-pass hover:underline cursor-pointer"
                >
                  Continue
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                {ORG_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      disabled={!!connecting}
                      onClick={() => startConnect(type.id)}
                      className="group flex items-center gap-3.5 rounded-xl border border-brand-border px-4 py-3.5 text-left hover:border-brand-blue/40 hover:shadow-soft transition-[border-color,box-shadow] disabled:opacity-60 cursor-pointer"
                    >
                      <span className="w-9 h-9 rounded-xl bg-brand-blue-light flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <Icon className="w-4.5 h-4.5 text-brand-blue" />
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-semibold text-brand-dark">{type.label}</span>
                        <span className="block text-xs text-slate-400">{type.description}</span>
                      </span>
                      {connecting === type.id ? (
                        <Loader2 className="w-4 h-4 text-brand-blue animate-spin" />
                      ) : (
                        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-brand-blue transition-colors" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {checkingOrgs && !connectedOrgName && (
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Waiting for Salesforce callback…
              </p>
            )}

            {connectError && <p className="text-sm text-brand-refused">{connectError}</p>}

            <div className="pt-1 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="text-sm font-medium text-brand-blue hover:underline cursor-pointer"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: ready — optional GitHub (§12.3) ─────────────────────── */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-brand-border shadow-lift p-6 space-y-4 animate-slide-up">
            <div className="text-center pt-2">
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-pass-bg mb-3">
                <Check className="w-6 h-6 text-brand-pass" />
              </span>
              <h2 className="font-semibold text-brand-dark">You&apos;re all set</h2>
              <p className="text-sm text-slate-500 mt-1">Ask OrgForge to build an agent or make an org change.</p>
            </div>

            <div className="rounded-xl border border-brand-border bg-brand-surface/50 p-4">
              <div className="flex items-start gap-3 mb-3">
                <span className="w-8 h-8 rounded-lg bg-brand-dark flex items-center justify-center shrink-0">
                  <Github className="w-4 h-4 text-white" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-brand-dark">Connect GitHub audit log (optional)</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Your signed change records get committed to a repo you choose. You can always connect it
                    later from Settings → Integrations.
                  </p>
                </div>
              </div>

              {/* Real install → repo picker → connect flow (§12.3) — shared with Settings */}
              <GithubConnectCard variant="card" />

              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="mt-3 w-full rounded-lg border border-brand-border bg-white text-sm font-medium py-2 hover:bg-brand-surface transition-colors cursor-pointer"
              >
                Skip for now
              </button>
            </div>

            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-blue text-white font-semibold py-2.5 hover:bg-brand-blue-hover transition-colors cursor-pointer"
            >
              Go to dashboard <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          OrgForge · Enlight Lab · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
