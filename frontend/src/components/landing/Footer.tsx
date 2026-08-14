import Link from 'next/link';
import { OrgForgeLogo } from '@/components/brand/OrgForgeLogo';

export function Footer() {
  return (
    <footer className="border-t border-brand-border bg-white/70">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-5 py-10 sm:flex-row sm:px-8">
        <OrgForgeLogo href="/" size="sm" />

        <p className="text-xs text-text-muted">
          OrgForge by Enlight Lab. A conversational copilot for Salesforce.
        </p>

        <div className="flex items-center gap-6">
          <a
            href="#capabilities"
            className="text-xs font-medium text-text-secondary transition-colors duration-200 hover:text-brand-blue"
          >
            Capabilities
          </a>
          <a
            href="#security"
            className="text-xs font-medium text-text-secondary transition-colors duration-200 hover:text-brand-blue"
          >
            Security
          </a>
          <Link
            href="/login"
            className="text-xs font-medium text-text-secondary transition-colors duration-200 hover:text-brand-blue"
          >
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
