import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'public-anon-key-placeholder';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn(
    'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in frontend/.env.local. ' +
      'Using build-safe placeholders (auth calls will fail until configured).'
  );
}

/**
 * Client-side Supabase client using @supabase/ssr createBrowserClient.
 * Cookie-based session storage (recommended for Next.js 16) — works across
 * SSR boundaries and the middleware refresh layer. Sessions survive the
 * Salesforce OAuth redirect round-trip because cookies are sent with every
 * request, unlike localStorage which is unavailable server-side.
 *
 * Placeholder fallbacks keep static prerenders and CI builds from crashing
 * on missing env; real values come from .env.local.
 */
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

/** Returns the current access token, or null when not signed in. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

