'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AmbientShape } from './AmbientShape';
import { Reveal } from './Reveal';

export function CtaSection() {
  return (
    <section className="px-5 pb-16 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-brand-dark px-8 py-16 text-center sm:px-16 lg:py-24">
            {/* blueprint-on-dark dot grid */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
                backgroundSize: '26px 26px',
              }}
            />
            {/* electric glow, the lit forge */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 50% 0%, rgba(26, 107, 255, 0.3) 0%, rgba(26, 107, 255, 0.07) 45%, transparent 72%)',
              }}
            />
            {/* drifting wireframe particles (Pass 42): the lit forge breathes */}
            <AmbientShape
              shape="cube"
              size={72}
              soft
              className="left-[12%] top-[18%] hidden opacity-45 md:block"
            />
            <AmbientShape
              shape="hex"
              size={56}
              soft
              className="right-[14%] top-[30%] hidden opacity-40 md:block"
            />
            <AmbientShape
              shape="orbits"
              size={96}
              glow="ink"
              soft
              className="bottom-[16%] left-[24%] hidden opacity-40 md:block"
            />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-4xl font-bold tracking-[-0.02em] text-white sm:text-5xl">
                Your org speaks Salesforce. OrgForge speaks you.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-white/70">
                Connect your org and ask for the first change or agent. No
                setup beyond one login.
              </p>
              <div className="mt-9">
                <Link
                  href="/login"
                  className="group inline-flex items-center gap-2 rounded-full bg-brand-blue px-8 py-4 text-sm font-semibold text-white shadow-glow transition-all duration-200 hover:bg-brand-blue-hover hover:shadow-glow-lg active:scale-[0.98]"
                >
                  Open OrgForge
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
