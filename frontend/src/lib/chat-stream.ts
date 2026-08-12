'use client';

import { supabase, getAccessToken } from './supabase';

/**
 * Unified SSE event envelope (§10.2) — Agentforge's `type` vocabulary plus
 * additive `capability` / `card` fields. Unknown additive fields pass through
 * untouched (`extra`).
 */
export interface SseEvent {
  type: string;
  capability?: 'agent' | 'org_change';
  content?: string;
  summary?: string;
  errors?: { component?: string; problem?: string }[];
  card?: string;
  [key: string]: unknown;
}

/** A chat message as rendered in the Copilot (Agentforge Message shape). */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type: string;
  capability?: 'agent' | 'org_change';
  summary?: string;
  errors?: { component?: string; problem?: string }[];
  /** Inline org-change card (§6.3) — one of the SSE_CARDS types. */
  card?: string;
  payload?: unknown;
}

export interface ChatStreamRequest {
  message: string;
  orgId: string;
  /** Client-routed capability — authoritative when present (chat/stream route). */
  capability?: 'agent' | 'org_change' | 'both' | 'clarify';
  /** Why the client supplied `capability`. `'readiness_gate'` marks a send
   *  whose agent half was routed away because the org can't run agents — the
   *  server logs it to routing_log so the block is auditable. */
  capabilitySource?: 'client' | 'readiness_gate';
  /** UI-chip pin — biases routeIntent (bypasses the classifier, plan §7.1). */
  pinned?: 'agent' | 'org_change' | 'both' | 'clarify';
  sessionId?: string;
  /**
   * Optional attachment (legacy multer parity). When set, the request is sent
   * as multipart/form-data with a `file` part; otherwise plain JSON. The
   * server extracts the document text and injects it into the engine prompt.
   */
  file?: File;
}

export interface ChatStreamOptions {
  onEvent: (event: SseEvent) => void;
  signal?: AbortSignal;
}

const STREAM_TIMEOUT_MS = 180_000; // engines can run long (agent build + deploy)

/**
 * Streams the Copilot conversation over SSE. Frames are delimited by `\n\n`
 * with a `data: ` prefix and a `[DONE]` terminator (Agentforge wire contract,
 * §10.2). Returns when the stream ends or throws on non-2xx / transport
 * failures — the same error surface as `apiFetch`.
 *
 * 401 handling matches apiFetch: session cleared + redirect to /login.
 */
export async function streamChat(
  request: ChatStreamRequest,
  { onEvent, signal }: ChatStreamOptions
): Promise<void> {
  const token = await getAccessToken();

  // With a file, the body is multipart/form-data (legacy multer contract) —
  // fetch sets the boundary itself, so Content-Type must NOT be hand-set. The
  // text fields ride along as form parts.
  const multipart = Boolean(request.file);
  let body: BodyInit;
  if (multipart) {
    const form = new FormData();
    const { file, ...fields } = request;
    form.append('file', file as Blob);
    form.append('message', fields.message);
    form.append('orgId', fields.orgId);
    if (fields.capability) form.append('capability', fields.capability);
    if (fields.capabilitySource) form.append('capabilitySource', fields.capabilitySource);
    if (fields.pinned) form.append('pinned', fields.pinned);
    if (fields.sessionId) form.append('sessionId', fields.sessionId);
    body = form;
  } else {
    body = JSON.stringify(request);
  }

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  };
  if (!multipart) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const timeoutSignal = AbortSignal.timeout(STREAM_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let res: Response;
  try {
    res = await fetch('/api/v1/chat/stream', {
      method: 'POST',
      headers,
      body,
      signal: combined,
    });
  } catch (err) {
    // User-initiated abort (Stop button / unmount) stays an AbortError — the
    // caller ignores it. Only a timeout becomes a user-facing message.
    if (signal?.aborted) throw err;
    const timedOut = err instanceof Error && err.name === 'AbortError';
    throw new Error(
      timedOut
        ? 'The request timed out. Please try again.'
        : 'Unable to reach the Forge server. Check your connection and try again.'
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      await supabase.auth.signOut();
      if (typeof window !== 'undefined') window.location.href = '/login';
      throw new Error('Session expired. Please sign in again.');
    }
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === 'string') message = body.error;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(message);
  }

  if (!res.body) throw new Error('No response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // SSE line buffer — accumulates across chunk boundaries to prevent partial-JSON drops
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Process all complete frames in the buffer (delimited by \n\n)
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? ''; // last element is empty or an incomplete frame

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data: ')) continue;
      const data = line.slice('data: '.length);
      if (data === '[DONE]') continue;
      try {
        onEvent(JSON.parse(data) as SseEvent);
      } catch {
        /* ignore unparseable frames — never kill the stream */
      }
    }
  }
}

/**
 * Explicitly resets a conversation server-side — DELETE /api/v1/chat/:contextId
 * (legacy Agentforge parity, plan §10.1). Wipes the whole conversation:
 * aborts any in-flight generation, drops the live ConversationManager, and
 * clears the Redis busy-lock + persisted state. The lock clear is the escape
 * hatch a crash-stuck request needs — without it, a dead run blocks the
 * conversation with 409s for up to the 10-minute lock TTL.
 *
 * Throws on non-2xx; best-effort callers catch and ignore (the guaranteed
 * reset is rotating to a fresh session id). A 401 here is intentionally NOT
 * redirected — Clear is a local action and must not log the user out mid-
 * action; the next streamChat call handles session expiry as usual.
 */
export async function resetChatSession(contextId: string, orgId: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(
    `/api/v1/chat/${encodeURIComponent(contextId)}?orgId=${encodeURIComponent(orgId)}`,
    {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }
  );
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === 'string') message = body.error;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(message);
  }
}
