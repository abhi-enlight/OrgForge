'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Trash2, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

interface RepoOption {
  name: string;
  owner: string;
}

interface GithubStatus {
  connected: boolean;
  installationId?: number | null;
  repoOwner?: string | null;
  repoName?: string | null;
  connectedAt?: string | null;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Shared GitHub audit-destination flow (plan §12.3, D8) — used by Settings
 * ("Integrations") and the onboarding step 3. Extracted from settings-flow so
 * both entry points behave identically:
 *
 *   status (GET /api/v1/auth/github/status) → install-url (new tab) → GitHub
 *   callback bounces to /settings?github=install&installation_id=… → repo
 *   picker (claim-gated /repos) → connect → persistent D8 indicator.
 *
 * The callback lands on /settings by design; this component ALSO reacts to the
 * `?github=` query params on any route it's mounted on, so a future
 * redirect-target change keeps the picker working everywhere.
 *
 * @param {'section'|'card'} [variant] - section: full-width (Settings);
 *   card: compact embedded panel (login step 3)
 * @param {() => void} [onConnected] - fired after a successful connect
 * @param {number} [recheckKey] - bump to force a status re-check (Settings
 *   "Reload settings" refreshes the card through this)
 */
export default function GithubConnectCard({
  variant = 'section',
  onConnected,
  recheckKey = 0,
}: {
  variant?: 'section' | 'card';
  onConnected?: () => void;
  recheckKey?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gettingInstallUrl, setGettingInstallUrl] = useState(false);
  // GitHub install callback (?github=install&installation_id=…): read the id
  // SYNCHRONOUSLY on first paint so the repo picker renders immediately on
  // the callback landing — instead of flashing the "Install" button for a
  // tick while the effect below fetches the repo list (same no-flash pattern
  // as the login/workspace OAuth snapshots). The mount effect still performs
  // the repo fetch and scrubs the query params.
  const [pendingInstallId, setPendingInstallId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const sp = new URLSearchParams(window.location.search);
    return sp.get('github') === 'install' ? sp.get('installation_id') : null;
  });
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [reposLoading, setReposLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const s = await apiFetch<GithubStatus>('/api/v1/auth/github/status');
      setStatus(s);
      setError(null);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : 'Failed to load GitHub status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so state settles after mount (react-hooks/set-state-in-effect);
    // re-runs when the parent bumps recheckKey (Settings reload).
    const timer = setTimeout(() => {
      loadStatus();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadStatus, recheckKey]);

  // GitHub install callback: ?github=install&installation_id=... → load repos.
  const githubParam = searchParams.get('github');
  const installIdParam = searchParams.get('installation_id');
  // Preserve other meaningful params (e.g. ?step=3 on /login) when cleaning up.
  const stepParam = searchParams.get('step');
  useEffect(() => {
    const run = async () => {
      if (githubParam === 'error') {
        setError('GitHub returned an error during installation. Please try again.');
        return;
      }
      if (githubParam !== 'install' || !installIdParam) return;
      setPendingInstallId(installIdParam);
      setError(null);
      setReposLoading(true);
      try {
        const body = await apiFetch<{ repos: RepoOption[] }>(
          `/api/v1/auth/github/repos?installationId=${encodeURIComponent(installIdParam)}`
        );
        setRepos(body.repos || []);
        setSelectedRepo(body.repos?.[0] ? `${body.repos[0].owner}/${body.repos[0].name}` : '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to list repositories for this installation');
      } finally {
        setReposLoading(false);
      }
      // Clean the query params so a refresh doesn't re-trigger the flow
      // (usePathname — App Router useRouter has no pathname property). Keep
      // unrelated params like ?step= on /login so onboarding position survives.
      const cleanTarget = stepParam ? `${pathname}?step=${stepParam}` : pathname || '/settings';
      router.replace(cleanTarget);
    };
    run();
  }, [githubParam, installIdParam, stepParam, pathname, router]);

  const handleInstallClick = async () => {
    setGettingInstallUrl(true);
    setError(null);
    try {
      const body = await apiFetch<{ installUrl: string }>('/api/v1/auth/github/install-url');
      window.open(body.installUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start GitHub connection');
    } finally {
      setGettingInstallUrl(false);
    }
  };

  const handleConnect = async () => {
    if (!pendingInstallId || !selectedRepo) return;
    const [repoOwner, repoName] = selectedRepo.split('/');
    if (!repoOwner || !repoName) {
      setError('Please choose a repository.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await apiFetch('/api/v1/auth/github/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId: Number(pendingInstallId), repoOwner, repoName }),
      });
      setPendingInstallId(null);
      setRepos([]);
      setSelectedRepo('');
      await loadStatus();
      onConnected?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect GitHub repository');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect the GitHub audit destination? Future change records will fall back to local files.')) return;
    try {
      await apiFetch('/api/v1/auth/github/connect', { method: 'DELETE' });
      setStatus(null);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect GitHub');
    }
  };

  const connected = status?.connected;
  const compact = variant === 'card';

  if (loading) {
    return (
      <div className={cn('space-y-3 animate-pulse', compact && 'py-1')}>
        <div className={cn('h-4 rounded bg-brand-surface', compact ? 'w-2/3' : 'w-1/2')} />
        <div className={cn('h-3 rounded bg-brand-surface/70', compact ? 'w-full' : 'w-2/3')} />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      {connected ? (
        <>
          <div className="flex items-start gap-3 rounded-xl border border-brand-pass/30 bg-brand-pass/5 px-4 py-3.5">
            <CheckCircle2 className={cn('w-5 h-5 text-brand-pass shrink-0 mt-0.5', compact && 'w-4 h-4')} />
            <div className="min-w-0 flex-1">
              {/* D8: persistent audit-status indicator */}
              <p className={cn('text-sm font-semibold text-brand-dark', compact && 'text-xs')}>
                Audit records committed to{' '}
                <span className="font-mono text-brand-blue">
                  {status.repoOwner}/{status.repoName}
                </span>
              </p>
              <p className={cn('text-xs text-slate-500 mt-0.5', compact && 'text-[11px]')}>
                {status.connectedAt ? `Connected ${timeAgo(status.connectedAt)}` : 'Connected'}. Every signed change
                record is pushed here automatically.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDisconnect}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:text-brand-danger hover:bg-brand-danger/5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" /> Disconnect
          </button>
        </>
      ) : (
        <>
          <div className={cn('flex items-start gap-3 rounded-xl border border-brand-border bg-brand-surface/40 px-4 py-3.5', compact && 'px-3.5 py-3')}>
            <ShieldCheck className={cn('w-5 h-5 text-slate-400 shrink-0 mt-0.5', compact && 'w-4 h-4')} />
            <div>
              <p className={cn('text-sm font-medium text-brand-dark', compact && 'text-xs')}>Audit records are saved locally</p>
              <p className={cn('text-xs text-slate-500 mt-0.5', compact && 'text-[11px]')}>
                Connect a repository to get a tamper-evident, committed audit trail. The GitHub App needs Contents:
                read &amp; write on the repo you choose.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleInstallClick}
            disabled={gettingInstallUrl}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl text-white text-sm font-semibold px-5 py-2.5 shadow-glow transition-colors cursor-pointer disabled:opacity-60',
              compact ? 'w-full justify-center py-2 bg-brand-dark hover:opacity-90' : 'bg-brand-blue hover:bg-brand-blue-hover'
            )}
          >
            {gettingInstallUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            Install the OrgForge Audit Logger
          </button>
          <p className={cn('text-xs text-slate-400', compact && 'text-[11px]')}>
            Opens GitHub in a new tab. After installing, choose the repo on the Settings page that opens, then come
            back here.
          </p>

          {/* Repo picker after the install callback */}
          {pendingInstallId && (
            <div className={cn('rounded-xl border border-brand-border p-4 space-y-3 animate-fade-in', compact && 'p-3.5')}>
              <p className={cn('text-sm font-medium text-brand-dark', compact && 'text-xs')}>Choose the audit repository</p>
              {reposLoading ? (
                <div className="h-9 rounded-lg bg-brand-surface animate-pulse" />
              ) : repos.length > 0 ? (
                <>
                  <select
                    value={selectedRepo}
                    onChange={(e) => setSelectedRepo(e.target.value)}
                    className="w-full rounded-xl border border-brand-border bg-white px-3.5 py-2.5 text-sm text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue/50"
                  >
                    {repos.map((r) => (
                      <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
                        {r.owner}/{r.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleConnect}
                    disabled={connecting || !selectedRepo}
                    className="inline-flex items-center gap-2 rounded-xl bg-brand-blue text-white text-sm font-semibold px-5 py-2.5 shadow-glow hover:bg-brand-blue-hover transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {connecting && <Loader2 className="w-4 h-4 animate-spin" />} Connect repository
                  </button>
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  No repositories found for this installation. Grant the app access to a repository on GitHub and try
                  again.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <p className={cn('text-sm text-brand-danger bg-brand-danger/5 rounded-lg px-3.5 py-2.5', compact && 'text-xs')}>{error}</p>
      )}
    </div>
  );
}
