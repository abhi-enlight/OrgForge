import { supabase, getAccessToken } from './supabase';

interface ApiErrorIssue {
  path?: (string | number)[];
  message?: string;
}

/**
 * Error raised by apiFetch for any non-2xx response (or transport failure).
 * Carries the HTTP status plus any structured validation `issues` returned
 * by the backend so callers can render per-field messages.
 */
export class ApiError extends Error {
  status: number;
  issues?: ApiErrorIssue[];

  constructor(message: string, status: number, issues?: ApiErrorIssue[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

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
      return 'Unable to reach the Forge server. Check your connection and try again.';
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
        : 'Unable to reach the Forge server. Check your connection and try again.';
    throw new ApiError(message, 0);
  }

  if (!res.ok) {
    if (res.status === 401) {
      await supabase.auth.signOut();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new ApiError('Session expired. Please sign in again.', 401);
    }

    const body = await parseBody<{ error?: unknown; detail?: unknown; issues?: ApiErrorIssue[] }>(res);
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

    throw new ApiError(message, res.status, issues);
  }

  return (await parseBody<T>(res)) as T;
}
