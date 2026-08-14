import { NextRequest, NextResponse } from 'next/server';

/**
 * Fallback redirect for GitHub App post-install callback:
 * If the GitHub App Setup URL points to /settings/github?installation_id=...
 * this route catches it and redirects to /settings?github=install&installation_id=...
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const installationId = searchParams.get('installation_id');
  const setupAction = searchParams.get('setup_action') || 'install';

  const redirectUrl = new URL('/settings', request.url);
  if (installationId) {
    redirectUrl.searchParams.set('github', 'install');
    redirectUrl.searchParams.set('installation_id', installationId);
    redirectUrl.searchParams.set('action', setupAction);
  } else {
    redirectUrl.searchParams.set('github', 'error');
    redirectUrl.searchParams.set('reason', 'missing_installation');
  }

  return NextResponse.redirect(redirectUrl);
}
