'use client';

import {
  Activity,
  FileSignature,
  LockKeyhole,
  Radar,
  Radio,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import { AmbientShape } from './AmbientShape';
import { BlueprintCorners } from './BlueprintCorners';
import { Reveal } from './Reveal';

const GATE_ROWS = [
  { id: 'REF-01', name: 'Destructive metadata', state: 'refused' },
  { id: 'REF-04', name: 'Critical object touched', state: 'pass' },
  { id: 'REF-07', name: 'License unsupported', state: 'pass' },
  { id: 'REF-09', name: 'Sandbox blocked deploy', state: 'pass' },
] as const;

export function FeatureBento() {
  return (
    <section className="bg-brand-surface/60 py-16 lg:py-20">
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <BlueprintCorners />
        {/* ambient depth (Pass 42): orbit rings in the top-right whitespace +
            a soft brand glow behind the dark encrypted-credentials cell */}
        <AmbientShape
          shape="orbits"
          size={150}
          soft
          className="-right-4 top-16 hidden opacity-45 md:block"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-40 right-[20%] hidden h-72 w-72 md:block"
          style={{
            background:
              'radial-gradient(circle, rgba(26, 107, 255, 0.1) 0%, transparent 70%)',
          }}
        />
        <Reveal variant="mask-line">
          <h2 className="max-w-2xl text-4xl font-bold tracking-[-0.02em] text-brand-dark sm:text-5xl">
            Every change, from idea to signed deploy
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-text-secondary">
            Impact analysis, refusal gates, dry-runs, and a signed record,
            without leaving the chat.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {/* 2-col hero cell: refusal gates with a live gate-table artifact */}
          <Reveal className="lg:col-span-2" delay={0.05}>
            <article className="flex h-full flex-col rounded-2xl border border-brand-border bg-white p-7 transition-shadow duration-300 hover:shadow-lift sm:p-8">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-blue-light">
                  <Radar className="h-5 w-5 text-brand-blue" />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-brand-dark">
                  Refusal gates, not warnings
                </h3>
              </div>
              <p className="mt-4 leading-relaxed text-text-secondary">
                Ten named gates (REF-01 to REF-10) evaluate every change.
                Destructive or high-impact work is refused with a plain-language
                reason and a path forward.
              </p>
              <div className="mt-5 overflow-hidden rounded-xl border border-brand-border">
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 border-b border-brand-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  <span>Gate</span>
                  <span>Check</span>
                  <span>State</span>
                </div>
                {GATE_ROWS.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 px-4 py-2.5"
                  >
                    <span className="font-mono text-[11px] text-text-secondary">
                      {row.id}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {row.name}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${
                        row.state === 'refused'
                          ? 'bg-brand-refused-bg text-brand-refused'
                          : 'bg-brand-pass-bg text-brand-pass'
                      }`}
                    >
                      {row.state === 'refused' ? 'refused' : 'pass'}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </Reveal>

          {/* signed audit trail with an HMAC artifact line */}
          <Reveal delay={0.12}>
            <article className="flex h-full flex-col rounded-2xl border border-brand-border bg-white p-7 transition-shadow duration-300 hover:shadow-lift sm:p-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-blue-light">
                <FileSignature className="h-5 w-5 text-brand-blue" />
              </div>
              <h3 className="mt-5 text-lg font-bold tracking-tight text-brand-dark">
                Signed audit trail
              </h3>
              <p className="mt-2.5 leading-relaxed text-text-secondary">
                Every deploy is HMAC-signed. Review records, refusals, and
                evidence on the Changes and Audit page or export to CSV.
              </p>
              <div className="mt-auto pt-5">
                <div className="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-surface/60 px-3 py-2.5">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand-pass" />
                  <code className="truncate font-mono text-[10px] text-text-secondary">
                    hmac=sha256:a1f8c4d9…c2b7e0a3
                  </code>
                </div>
              </div>
            </article>
          </Reveal>

          {/* self-healing diagnostics */}
          <Reveal delay={0.05}>
            <article className="flex h-full flex-col rounded-2xl border border-brand-border bg-white p-7 transition-shadow duration-300 hover:shadow-lift sm:p-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-blue-light">
                <Activity className="h-5 w-5 text-brand-blue" />
              </div>
              <h3 className="mt-5 text-lg font-bold tracking-tight text-brand-dark">
                Self-healing diagnostics
              </h3>
              <p className="mt-2.5 leading-relaxed text-text-secondary">
                Package, license, and provisioning checks run in the background
                and re-check themselves when the org changes.
              </p>
            </article>
          </Reveal>

          {/* one routing brain, tinted */}
          <Reveal delay={0.12}>
            <article className="flex h-full flex-col rounded-2xl border border-brand-blue/20 bg-brand-blue-light/70 p-7 transition-shadow duration-300 hover:shadow-lift sm:p-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
                <Waypoints className="h-5 w-5 text-brand-blue" />
              </div>
              <h3 className="mt-5 text-lg font-bold tracking-tight text-brand-dark">
                Automatic routing
              </h3>
              <p className="mt-2.5 leading-relaxed text-text-secondary">
                A classifier decides between agent work, org changes, or both,
                and you can pin the capability manually. Every decision is
                logged.
              </p>
            </article>
          </Reveal>

          {/* 2-col dark anchor: encrypted credentials */}
          <Reveal className="lg:col-span-2" delay={0.05}>
            <article className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-brand-dark bg-brand-dark p-7 transition-shadow duration-300 hover:shadow-lift sm:p-8">
              <div
                aria-hidden
                className="absolute inset-0 opacity-50"
                style={{
                  backgroundImage:
                    'radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              />
              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                  <LockKeyhole className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-white">
                    Encrypted credentials
                  </h3>
                  <p className="mt-2.5 leading-relaxed text-white/70">
                    Salesforce tokens are AES-256-GCM encrypted and refreshed
                    per org with tenant-isolated access on every query.
                  </p>
                </div>
              </div>
            </article>
          </Reveal>

          {/* live streaming */}
          <Reveal delay={0.12}>
            <article className="flex h-full flex-col rounded-2xl border border-brand-border bg-white p-7 transition-shadow duration-300 hover:shadow-lift sm:p-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-blue-light">
                <Radio className="h-5 w-5 text-brand-blue" />
              </div>
              <h3 className="mt-5 text-lg font-bold tracking-tight text-brand-dark">
                Live streaming
              </h3>
              <p className="mt-2.5 leading-relaxed text-text-secondary">
                Builds stream to the chat in real time: progress cards, dry-run
                results, and deploy status as they happen.
              </p>
              <div className="mt-auto flex gap-1.5 pt-5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-1 flex-1 rounded-full bg-brand-border"
                  >
                    <div
                      className={`h-full rounded-full ${
                        i < 3 ? 'bg-brand-blue' : ''
                      }`}
                    />
                  </div>
                ))}
              </div>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
