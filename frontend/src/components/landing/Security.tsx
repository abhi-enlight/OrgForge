'use client';

import { FileKey2, Fingerprint, ShieldCheck, TerminalSquare } from 'lucide-react';
import { AmbientShape } from './AmbientShape';
import { BlueprintCorners } from './BlueprintCorners';
import { Reveal } from './Reveal';

const GUARDRAILS = [
  {
    icon: FileKey2,
    label: 'AUTH',
    title: 'Supabase auth with tenant isolation',
    body: 'Every query passes the verified user id explicitly. Row-level security is defense in depth, not the only layer.',
  },
  {
    icon: Fingerprint,
    label: 'SIGN',
    title: 'Signed records you can verify',
    body: 'Change records carry an HMAC-SHA256 signature so the audit trail is tamper-evident end to end.',
  },
  {
    icon: TerminalSquare,
    label: 'INPUT',
    title: 'Guardrails on every input',
    body: 'Zod validation, SSRF-guarded instance URLs, and a strict file allowlist keep the surface small.',
  },
] as const;

export function Security() {
  return (
    <section id="security" className="scroll-mt-20 py-16 lg:py-20">
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <BlueprintCorners />
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-5 lg:gap-16">
          <Reveal className="lg:col-span-2" variant="mask-line">
            <div>
              <h2 className="text-4xl font-bold tracking-[-0.02em] text-brand-dark sm:text-5xl">
                Security is the baseline, not a feature
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-text-secondary">
                Forge was built for teams that treat Salesforce as production
                infrastructure. The guarantees are structural, not cosmetic.
              </p>
            </div>
          </Reveal>

          <div className="relative lg:col-span-3">
            {/* faint shield outline in the right whitespace (Pass 42) */}
            <AmbientShape
              shape="arch"
              size={180}
              glow="ink"
              soft
              className="-right-8 top-6 hidden opacity-45 lg:block"
            />
            {/* guardrail schematic: three vertical bars with connector rail */}
            <div className="relative">
              <div
                aria-hidden
                className="absolute bottom-6 left-4 top-6 w-px bg-blueprint-line"
              />
              <div className="space-y-8">
                {GUARDRAILS.map((g, i) => (
                  <Reveal key={g.label} delay={i * 0.08}>
                    <div className="relative flex gap-5">
                      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blueprint-line-strong bg-white shadow-soft">
                        <g.icon className="h-4 w-4 text-brand-blue" />
                      </div>
                      <div className="flex-1 border-b border-brand-border pb-7">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-blue">
                            {g.label}
                          </span>
                          <h3 className="text-base font-bold tracking-tight text-brand-dark">
                            {g.title}
                          </h3>
                        </div>
                        <p className="mt-2 leading-relaxed text-text-secondary">
                          {g.body}
                        </p>
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>

            {/* verification chip: the signature is real and checkable */}
            <Reveal delay={0.2}>
              <div className="mt-8 flex items-center gap-3 rounded-xl border border-brand-pass/40 bg-brand-pass-bg px-4 py-3">
                <ShieldCheck className="h-4 w-4 shrink-0 text-brand-pass" />
                <code className="truncate font-mono text-[11px] text-text-secondary">
                  verify: hmac-sha256(record) = 1f8a…e0c4 · signature valid
                </code>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
