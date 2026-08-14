import type { Metadata } from 'next';
import { LandingNav } from '@/components/landing/Nav';
import { Hero } from '@/components/landing/Hero';
import { Problem } from '@/components/landing/Problem';
import { Capabilities } from '@/components/landing/Capabilities';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Audience } from '@/components/landing/Audience';
import { FeatureBento } from '@/components/landing/FeatureBento';
import { Security } from '@/components/landing/Security';
import { CtaSection } from '@/components/landing/CtaSection';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Forge: One copilot for your whole Salesforce org',
  description:
    'For Salesforce admins and release managers: build and deploy Agentforce agents in natural language, and make governed org changes behind refusal gates with a signed audit trail.',
};

export default function LandingPage() {
  return (
    <main
      className="relative min-h-[100dvh] bg-white text-brand-dark antialiased"
      style={{
        // Balanced blueprint dot texture: clean, visible drafting grid
        backgroundImage:
          'radial-gradient(rgba(10, 15, 30, 0.05) 1px, transparent 1px)',
        backgroundSize: '26px 26px',
      }}
    >
      {/* Refined ambient depth layer */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'linear-gradient(rgba(10, 15, 30, 0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(10, 15, 30, 0.025) 1px, transparent 1px)',
            backgroundSize: '96px 96px',
          }}
        />
        <div
          className="absolute -left-40 top-[-10%] h-[46rem] w-[46rem] opacity-40"
          style={{
            background:
              'radial-gradient(circle, rgba(26, 107, 255, 0.07) 0%, rgba(26, 107, 255, 0.02) 45%, transparent 70%)',
          }}
        />
        <div
          className="absolute -right-48 top-[30%] h-[40rem] w-[40rem] opacity-30"
          style={{
            background:
              'radial-gradient(circle, rgba(10, 15, 30, 0.04) 0%, transparent 65%)',
          }}
        />
      </div>

      <div className="relative z-10">
        <LandingNav />
        <Hero />
        <Problem />
        <Capabilities />
        <HowItWorks />
        <Audience />
        <FeatureBento />
        <Security />
        <CtaSection />
        <Footer />
      </div>
    </main>
  );
}
