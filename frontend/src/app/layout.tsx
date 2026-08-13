import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { MotionConfigProvider } from '@/components/providers/MotionConfigProvider';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  display: 'swap',
});



export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: {
    default: 'OrgForge — Salesforce AI Agents & Governed Org Changes',
    template: '%s | OrgForge',
  },
  description:
    'OrgForge is the unified Enlight Lab platform: build and deploy Salesforce Agentforce agents in natural language, and make governed org changes with impact analysis and refusal gates.',
  applicationName: 'OrgForge',
  authors: [{ name: 'Enlight Lab' }],
  creator: 'Enlight Lab',
  publisher: 'Enlight Lab',
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
  openGraph: {
    title: 'OrgForge — Salesforce AI Agents & Governed Org Changes',
    description:
      'OrgForge is the unified Enlight Lab platform: build and deploy Salesforce Agentforce agents in natural language, and make governed org changes with impact analysis and refusal gates.',
    siteName: 'OrgForge by Enlight Lab',
    images: [{ url: '/enlight-logo.png', width: 1200, height: 630, alt: 'OrgForge by Enlight Lab' }],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OrgForge — Salesforce AI Agents & Governed Org Changes',
    description:
      'OrgForge is the unified Enlight Lab platform: build and deploy Salesforce Agentforce agents in natural language, and make governed org changes with impact analysis and refusal gates.',
  },
};

export const viewport: Viewport = {
  themeColor: '#1A6BFF',
  colorScheme: 'light',
  // viewport-fit=cover lets the CSS env(safe-area-inset-*) variables resolve so
  // the sticky headers can clear the iPhone notch / home indicator (pt-safe /
  // pb-safe utilities in globals.css). No-op in normal browser tabs.
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jetbrainsMono.variable}`}>
      {/*
       * suppressHydrationWarning: some Chrome extensions (e.g. ones that add
       * keyboard shortcuts) inject attributes like cz-shortcut-listen="true"
       * into <body> after SSR but before hydration — a benign attribute-only
       * mismatch that would otherwise spam the console every load. The warning
       * is suppressed on this node only; children still hydrate strictly.
       */}
      <body className="font-sans bg-white min-h-screen" suppressHydrationWarning>
        <MotionConfigProvider>{children}</MotionConfigProvider>
      </body>
    </html>
  );
}
