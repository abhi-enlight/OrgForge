import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client for Server Components, Route Handlers, and
 * Server Actions. Uses cookie storage (via next/headers) so the session
 * established by the browser client and refreshed by middleware is visible
 * server-side without any manual token plumbing.
 *
 * Call this inside an async Server Component or async Route Handler — it
 * cannot be used in Client Components (use lib/supabase.ts there).
 *
 * Note: createServerClient reads cookies() synchronously inside Next.js
 * request scope. Always call it at the top of the async function, never
 * outside a request boundary.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'public-anon-key-placeholder',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component — cookies can only be set
            // from middleware or Route Handlers. The middleware handles refresh;
            // this catch keeps Server Components from throwing.
          }
        },
      },
    }
  );
}
