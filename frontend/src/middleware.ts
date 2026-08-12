import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js middleware — runs on every request before rendering.
 *
 * Two responsibilities:
 * 1. Session refresh: keeps the Supabase session alive by reading and
 *    re-writing the auth cookie on every request. Without this, the cookie
 *    would expire mid-session even though the user is still active.
 *
 * 2. Route protection: unauthenticated requests to any route inside the
 *    authenticated group /(app)/* are redirected to /login. Authenticated
 *    users who hit /login are redirected to /chat (the default landing page
 *    inside the app).
 *
 * This is the server-side enforcement layer. AuthGate.tsx is kept as a
 * client-side safety net, but the middleware is the authoritative guard.
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'public-anon-key-placeholder',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Phase 1: write cookies onto the request (for the current handler)
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Phase 2: write cookies onto the response (to the browser)
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not add any logic between createServerClient and
  // supabase.auth.getUser(). A middleware-level call to getUser() is the
  // mechanism that triggers the session refresh — skipping it breaks refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Protected routes: anything under /(app) — captured as /chat, /templates,
  // /agents, /changes, /dashboard, /settings, /workspace (no (app) segment
  // in URL).
  const isProtectedRoute =
    pathname.startsWith('/chat') ||
    pathname.startsWith('/templates') ||
    pathname.startsWith('/agents') ||
    pathname.startsWith('/changes') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/workspace');

  if (!user && isProtectedRoute) {
    // Unauthenticated → redirect to /login, preserving the intended destination
    // so login can redirect back after sign-in.
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === '/login') {
    // Already authenticated → send to the app
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/chat';
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all routes EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, favicon.png, sitemap.xml, robots.txt
     * - public folder assets (enlight-logo.png, etc.)
     */
    '/((?!_next/static|_next/image|favicon|enlight-logo|robots.txt|sitemap.xml).*)',
  ],
};
