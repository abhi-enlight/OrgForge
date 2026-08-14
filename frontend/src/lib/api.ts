import { supabase, getAccessToken } from './supabase';

interface ApiErrorIssue {
  path?: (string | number)[];
  message?: string;
}

/**
 * Error raised by apiFetch for any non-2xx response (or transport failure).
 * Carries the HTTP status plus any structured validation `issues` returned
 * by the backend so callers can render per-field messages.
 *
 * `code` is the backend's machine-readable discriminator — most importantly
 * `ORG_RECONNECT_REQUIRED` (a 401 that means the *Salesforce org* needs
 * reconnecting, NOT that the user's app session expired). Callers check
 * `err.code` to render a "Reconnect Salesforce" CTA instead of generic
 * failure text.
 */
export class ApiError extends Error {
  status: number;
  issues?: ApiErrorIssue[];
  code?: string;

  constructor(message: string, status: number, issues?: ApiErrorIssue[], code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
    this.code = code;
  }
}

export const ORG_RECONNECT_REQUIRED = 'ORG_RECONNECT_REQUIRED';

const REQUEST_TIMEOUT_MS = 45_000; // generous for AI-powered endpoints
// Heavy endpoints (intent parse, metadata generation, impact analysis, gate
// evaluation, deploy) fan out to Gemini + multiple Salesforce API calls.
export const HEAVY_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Turns a thrown value into a human-readable message.
 */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error && err.message) {
    if (err.name === 'AbortError') return 'The request timed out. Please try again.';
    if (/failed to fetch|fetch failed/i.test(err.message)) {
      return 'Unable to reach the OrgForge server. Check your connection and try again.';
    }
    return err.message;
  }
  return typeof err === 'string' && err.trim() ? err : fallback;
}

/** Flattens a Zod `issues` array into one readable sentence. */
function formatIssues(issues: ApiErrorIssue[] | undefined, fallback: string): string {
  if (!Array.isArray(issues) || issues.length === 0) return fallback;
  const parts = issues.map((issue) => {
    const field =
      Array.isArray(issue.path) && issue.path.length > 0
        ? String(issue.path[issue.path.length - 1])
        : null;
    return field ? `${field}: ${issue.message || 'invalid value'}` : issue.message || 'invalid value';
  });
  return parts.join('; ');
}

async function parseBody<T>(res: Response): Promise<T | undefined> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * Authenticated fetch wrapper (relative paths — next.config rewrites /api/* to
 * the unified backend). Attaches the Supabase JWT as a Bearer token. On 401 the
 * session is cleared and the user is sent to /login. Network failures, timeouts
 * and structured validation errors are normalized into ApiError instances.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  let res: Response;
  try {
    res = await fetch(path, { ...options, headers, signal });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'The request timed out. Please try again.'
        : 'Unable to reach the OrgForge server. Check your connection and try again.';
    throw new ApiError(message, 0);
  }

  if (!res.ok) {
    const body = await parseBody<{ error?: unknown; detail?: unknown; issues?: ApiErrorIssue[]; code?: string }>(res);
    const code = typeof body?.code === 'string' ? body.code : undefined;

    // A 401 with code ORG_RECONNECT_REQUIRED means the *Salesforce org*
    // connection needs reconnecting (the stored refresh token was rejected) —
    // the user's app session is still valid, so we must NOT log them out.
    // Only a session-auth 401 (from the auth middleware, no code) expires the
    // session and redirects to /login. Previously any 401 here signed the
    // user out, so a dead Salesforce refresh token looked like a forced
    // logout on every page load.
    if (res.status === 401 && code !== ORG_RECONNECT_REQUIRED) {
      await supabase.auth.signOut();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new ApiError('Session expired. Please sign in again.', 401);
    }

    const rawError = typeof body?.error === 'string' ? body.error : undefined;
    const detail = typeof body?.detail === 'string' && body.detail ? body.detail : undefined;
    const issues = body?.issues;

    let message: string;
    if (issues && Array.isArray(issues) && issues.length > 0) {
      message = formatIssues(issues, rawError || `Request failed (${res.status})`);
    } else if (rawError) {
      message = rawError;
    } else {
      message = `Request failed (${res.status})`;
    }
    // Backends may attach a longer explanation (e.g. the agent-YAML 404's
    // "may have been built outside Agentforce or deleted") — surface it.
    if (detail) {
      message = `${message} ${detail}`;
    }

    throw new ApiError(message, res.status, issues, code);
  }

  return (await parseBody<T>(res)) as T;
}
