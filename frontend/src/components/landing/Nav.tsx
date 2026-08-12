'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { ForgeLogo } from '@/components/brand/ForgeLogo';

const LINKS = [
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#security', label: 'Security' },
] as const;

export function LandingNav() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-brand-border bg-white/85 pt-safe backdrop-blur-md">
      {/* blueprint hairline: the motif enters at frame one */}
      <div
        aria-hidden
        className="h-0.5 w-full"
        style={{
          backgroundImage:
            'radial-gradient(rgba(26, 107, 255, 0.5) 1.5px, transparent 1.5px)',
          backgroundSize: '12px 100%',
        }}
      />
      <nav
        className="mx-auto flex min-h-16 max-w-7xl items-center justify-between px-5 sm:px-8"
        aria-label="Primary"
      >
        <ForgeLogo href="/" size="md" className="min-w-0" />

        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-text-secondary transition-colors duration-200 hover:text-brand-blue"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <Link
            href="/login"
            className="rounded-full bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:bg-brand-blue-hover hover:shadow-lift active:scale-[0.98]"
          >
            Sign in
          </Link>

          {/* Mobile menu toggle — the section links move behind a hamburger
              below `md` so the nav stays a single compact row on phones. */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
            className="md:hidden -mr-1 p-2 rounded-lg text-slate-600 hover:bg-brand-surface hover:text-brand-dark transition-colors cursor-pointer"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile slide-down panel — full-width rows, ≥40px touch targets */}
      {menuOpen && (
        <nav
          id="landing-mobile-menu"
          aria-label="Mobile"
          className="md:hidden border-t border-brand-border bg-white/95 backdrop-blur-md animate-slide-up"
        >
          <ul className="mx-auto max-w-7xl space-y-0.5 px-5 py-3 sm:px-8">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors duration-200 hover:bg-brand-surface hover:text-brand-blue"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
