import type { NextConfig } from 'next';

/** @type {import('next').NextConfig} */
const rawBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:3001';
const backendUrl = rawBackendUrl.replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    // CSP baseline carried from OrgForge (plan §8.5 hardening checklist).
    const connectOrigins = [
      "'self'",
      'https://*.supabase.co',
      'wss://*.supabase.co',
      'https://cdn.jsdelivr.net',
    ];

    if (backendUrl && !backendUrl.startsWith('http://localhost') && !backendUrl.startsWith('http://127.0.0.1')) {
      connectOrigins.push(backendUrl);
      connectOrigins.push(backendUrl.replace(/^http/, 'ws'));
    }

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "img-src 'self' blob: data:",
      "font-src 'self' data: https://cdn.jsdelivr.net",
      "worker-src 'self' blob: https://cdn.jsdelivr.net",
      `connect-src ${Array.from(new Set(connectOrigins)).join(' ')}`,
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ];
    if (process.env.NODE_ENV === 'production') {
      csp.push('upgrade-insecure-requests');
    }

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp.join('; ') },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Origin-Agent-Cluster', value: '?1' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
        ],
      },
    ];
  },
  async rewrites() {
    // Proxies browser calls to the unified API (port 3001) — same pattern as
    // OrgForge, so apiFetch can use same-origin relative paths.
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
