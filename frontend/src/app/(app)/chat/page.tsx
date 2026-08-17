'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Eraser, History, Info, Paperclip, PlugZap, RotateCcw, SendHorizontal, Square, Sparkles, X } from 'lucide-react';
import { useActiveOrg } from '@/lib/org-context';
import { useOrgPackageHealth } from '@/lib/orgHealth';
import { useOrgReadiness, agentsUnavailableHint } from '@/lib/orgReadiness';
import {
  resetChatSession,
  streamChat,
  listChatSessions,
  getChatSessionDetail,
  type ChatMessage,
  type SessionDetail,
  type SessionSummary,
} from '@/lib/chat-stream';
import { supabase } from '@/lib/supabase';
import { ORGFORGE_UNIFIED_FRONTEND } from '@/lib/flags';
import { classifyWithStub } from '@/lib/stubClassifier';
import MessageBubble from '@/components/chat/MessageBubble';
import OrgChangeCard from '@/components/chat/OrgChangeCard';
import BuildProgressCard, { PROGRESS_TYPES, type ProgressStep } from '@/components/chat/BuildProgressCard';
import CapabilityChip, { type CapabilityPin, type StubVerdict } from '@/components/chat/CapabilityChip';
import StarterCards from '@/components/chat/StarterCards';
import PackageRequiredGate from '@/components/org/PackageRequiredGate';

const GREETING =
  "Hi, I'm OrgForge 👋 Tell me what you'd like to do — build an agent, add a rule, update permissions, or make changes to your Salesforce org.";

// Answers to the agent's clarifying questions. Rendered as quick-reply
// buttons under an agent question, and each one is sent PINNED to the agent
// capability — a terse answer like "yes" must never be re-classified by the
// router in isolation (the classifier-forgets-context failure mode). "You
// decide" is the agent's own suggested phrasing for handing it the choice.
const QUICK_AGENT_REPLIES = ['Yes', 'No', 'You decide'];

/** crypto.randomUUID is unavailable in non-secure contexts (http on LAN IP) — same fallback everywhere (review finding). */
function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

const makeSessionId = makeId;

/** Compact relative timestamp for the History list ("2h ago"). */
function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Documents + images — mirrors the server allowlist
// (api/src/lib/fileAttachments.js): pdf/docx/txt/md inject extracted text;
// png/jpeg/webp go to Gemini as inlineData (agent) / a vision description
// (org change). The server re-validates regardless. 10MB matches
// MAX_FILE_BYTES there.
const ACCEPTED_ATTACHMENT_TYPES = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * The Copilot (§6.3). Streams the unified SSE envelope from
 * POST /api/v1/chat/stream, groups consecutive progress events into
 * BuildProgressCards, and exposes the capability chip (Auto/Agent/Org
 * Change/Both) that pins routeIntent.
 */
export default function ChatPage() {
  const { org } = useActiveOrg();
  // Package-install health for the active org — drives the chat access gate
  // below (the Copilot is locked until the connector package is installed).
  // Shared via the layout-level OrgPackageHealthProvider: checked once per
  // org per page session (Redis-cached 10 min server-side), re-checks on
  // demand — opening the chat page never re-runs the org check itself.
  const pkg = useOrgPackageHealth();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const [pin, setPin] = useState<CapabilityPin>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Brief inline confirmation after Stop & reset (its visible effect is
  // subtle — the transcript stays), auto-dismissed.
  const [resetNote, setResetNote] = useState<string | null>(null);
  const resetNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // History picker (resume-from-closed-tab): the session list panel, its
  // load/error state, and a brief "Conversation resumed." confirmation.
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [resumeNote, setResumeNote] = useState<string | null>(null);
  const resumeNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The currently-active session id (state mirror of sessionIdRef so the
  // History list can mark the current conversation without reading a ref in
  // render). Kept in sync on init, on Clear/Stop&reset rotation, and on resume.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // The attach ERROR is a transient notification (auto-dismissed like the
  // reset note) — the attachment CHIP, by contrast, is persistent state the
  // user manages with its X and must never silently vanish.
  const attachErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Canary-only (ORGFORGE_UNIFIED_FRONTEND=on): the stub rule-based routing
  // preview for the current draft — free, offline, zero AI calls (plan §14.2
  // Phase 1). Pure computation on the input, never sent to the server.
  const stubVerdict: StubVerdict | null = useMemo(
    () => (ORGFORGE_UNIFIED_FRONTEND && input.trim() ? classifyWithStub(input) : null),
    [input]
  );

  // Stable session key (S-2 chat_sessions) — hardened for isolation
  // (context-memory pass): stored per TAB in sessionStorage, so two open
  // chats never share one server conversation, and scoped by user + org so a
  // shared browser can't hand one account's session id to another. A refresh
  // in the same tab still resumes the same session spine; closing the tab
  // starts a fresh session (the old one's durable memory stays inert in
  // chat_sessions — unreachable without its id). Effect-scoped
  // (react-hooks/refs forbids render-phase access).
  const sessionIdRef = useRef<string | null>(null);
  const sessionOrgRef = useRef<string | null>(null);
  // The exact storage key in use, so Clear/Stop&reset rotates under the SAME
  // key the session effect initialized (set once getUser resolves).
  const sessionKeyRef = useRef<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUserId(data.session?.user?.id ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!org || !userId || sessionOrgRef.current === org.id) return;
    sessionOrgRef.current = org.id;
    const storageKey = `forge.chat.session.${userId}.${org.id}`;
    sessionKeyRef.current = storageKey;
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      sessionIdRef.current = stored && stored.length <= 200 ? stored : makeSessionId();
      window.sessionStorage.setItem(storageKey, sessionIdRef.current);
    } catch {
      // Storage unavailable — fall back to an in-memory session id.
      sessionIdRef.current = sessionIdRef.current ?? makeSessionId();
    }
    setActiveSessionId(sessionIdRef.current);
  }, [org, userId]);
  const abortRef = useRef<AbortController | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const greetingMessage: ChatMessage = useMemo(
    () => ({ id: 'greeting', role: 'assistant', content: GREETING, type: 'message' }),
    []
  );
  const showEmptyState = messages.length === 0 && !isBuilding;

  // Org readiness (SHARED via the provider — same fetch, same data): when the
  // preflight says the org can't run agents (Agentforce + Einstein settings,
  // license, provisioning), the Agent and Both chip options are disabled and
  // any previously-pinned agent/both choice downgrades to Auto so a disabled
  // option can never sit in an active state. The flags are org-attributed by
  // the provider, so they're always about the ACTIVE org.
  const readiness = useOrgReadiness();
  const agentsUnavailable = readiness.agentsUnavailable;
  // A FAILED readiness fetch (transient network/token blip) leaves the chip
  // enabled — surface that the availability is unknown and let the user retry
  // in-place (failed orgs are unmarked, so retry() re-runs without a remount).
  const readinessFailed = readiness.checkFailed;
  const safePin = agentsUnavailable && (pin === 'agent' || pin === 'both') ? null : pin;

  // Deep links (?prompt=) — from the dashboard tiles, templates, and the
  // agents/changes pages — prefill the composer so the user can review and
  // send. Keyed on the prompt VALUE (not the searchParams object identity,
  // which can change across a client-side navigation even when the URL is
  // stable): React StrictMode's dev double-invoke runs effect → cleanup →
  // effect, and a once-only ref guard would let the cleanup cancel the pending
  // fill while the re-run skips it — dropping the prompt entirely (the
  // templates "Use in Copilot" button prefills nothing on client-side nav).
  // Keying on the value makes the re-run simply re-schedule. User edits never
  // change the URL param, so typing in the textarea can't be clobbered.
  const promptParam = searchParams.get('prompt');
  useEffect(() => {
    if (!promptParam) return;
    // Deferred so state settles after mount (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      setInput(promptParam);
      textareaRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [promptParam]);

  // Quick replies: when the agent just asked a question — the last message is
  // an agent turn ending in "?" and nothing else is running — render
  // Yes/No/You decide buttons under it. Each sends its answer pinned to the
  // agent capability, so answers to the agent's clarifying questions bypass
  // the router entirely. Hidden while the user has pinned another chip mode
  // (that choice wins) and while agents are unavailable (the send would be
  // gated anyway).
  const awaitingAgentAnswer = useMemo(() => {
    if (isBuilding || agentsUnavailable || safePin !== null) return false;
    const last = messages[messages.length - 1];
    return Boolean(
      last &&
        last.role === 'assistant' &&
        last.capability === 'agent' &&
        last.type === 'message' &&
        /\?\s*$/.test(last.content)
    );
  }, [messages, isBuilding, agentsUnavailable, safePin]);

  // Auto-scroll to the bottom unless the user scrolled up (300px threshold).
  const handleScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    setIsUserScrolledUp(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
  }, []);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el || isUserScrolledUp) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isBuilding, isUserScrolledUp]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(
    () => () => {
      if (resetNoteTimerRef.current) clearTimeout(resetNoteTimerRef.current);
      if (attachErrorTimerRef.current) clearTimeout(attachErrorTimerRef.current);
    },
    []
  );

  useEffect(() => {
    const handleFill = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (typeof customEvent.detail === 'string') {
        setInput(customEvent.detail);
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 50);
      }
    };
    window.addEventListener('orgforge:fill-prompt', handleFill);
    return () => window.removeEventListener('orgforge:fill-prompt', handleFill);
  }, []);

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const startChat = useCallback(
    async (overridePrompt?: string, overridePin?: CapabilityPin) => {
      const text = overridePrompt ?? input;
      if (!text.trim() || isBuilding || !org) return;
      if (!overridePrompt) {
        setInput('');
        setAttachment(null);
        setAttachError(null);
        // Deliberately inline the timer clear instead of calling
        // clearAttachError() — that helper is declared BELOW this useCallback
        // (TDZ on first render) and adding it to deps would defeat the memo.
        if (attachErrorTimerRef.current) {
          clearTimeout(attachErrorTimerRef.current);
          attachErrorTimerRef.current = null;
        }
      }

      appendMessage({ id: makeId(), role: 'user', content: text, type: 'message' });

      // A new message supersedes any reset confirmation — clear the note AND
      // its auto-dismiss timer so it can't fire later. Runs BEFORE the gate so
      // a blocked send also dismisses a lingering note.
      setResetNote(null);
      if (resetNoteTimerRef.current) {
        clearTimeout(resetNoteTimerRef.current);
        resetNoteTimerRef.current = null;
      }

      // ── Send-time agents gate ────────────────────────────────────────
      // When the active org can't run agents (the same shared readiness that
      // disables the chip), an AUTO-routed message the rule-based classifier
      // reads as agent intent must never reach the agent engine:
      //   - `agent` verdict → blocked with a cause-aware error bubble (no
      //     engine call at all — this is the send-time redirect).
      //   - `both` verdict → the org-change half is routed away explicitly
      //     (`capability` is authoritative server-side); the agent half is
      //     skipped with a warning bubble. The backend repeats this gate for
      //     direct API callers, so a stub false-negative still can't run the
      //     agent engine on an attention org.
      // An explicit org_change pin is the user's deliberate choice and is
      // never gated; a `clarify` verdict flows through (the server asks).
      // The effective pin: a per-send override (quick replies to the agent's
      // questions carry `agent`) wins over the chip for this one send.
      const effectivePin = overridePin ?? safePin;
      let sendCapability: CapabilityPin = null;
      let sendCapabilitySource: 'client' | 'readiness_gate' | undefined;
      if (agentsUnavailable && effectivePin !== 'org_change') {
        const verdict = classifyWithStub(text);
        if (verdict.capability === 'agent') {
          // Richer block notice (type gate_block): an amber card with the
          // cause-aware reason AND a Fix in Settings link — see
          // MessageBubble's gate_block branch.
          appendMessage({
            id: makeId(),
            role: 'assistant',
            content: `Agent building isn't available in this org: ${agentsUnavailableHint(readiness.diag)}. I stopped this request before it ran.`,
            type: 'gate_block',
            summary: "Agent building isn't available",
          });
          return;
        }
        if (verdict.capability === 'both') {
          sendCapability = 'org_change';
          // Mark the send as readiness-gated so the server logs it to
          // routing_log (capability: org_change, override readiness_gate) —
          // the routed-away agent half must stay auditable even though the
          // client made the routing decision.
          sendCapabilitySource = 'readiness_gate';
          appendMessage({
            id: makeId(),
            role: 'assistant',
            content: `Agent building isn't available in this org: ${agentsUnavailableHint(readiness.diag)}. Skipping the agent half and applying the org change.`,
            type: 'deploy_warning',
            summary: 'Agent half skipped',
          });
        }
      }

      setIsBuilding(true);
      setIsUserScrolledUp(false);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamChat(
          {
            message: text,
            orgId: org.id,
            capability: sendCapability ?? undefined,
            capabilitySource: sendCapabilitySource,
            pinned: effectivePin ?? undefined,
            sessionId: sessionIdRef.current ?? undefined,
            file: overridePrompt ? undefined : (attachment ?? undefined),
          },
          {
            signal: controller.signal,
            onEvent: (event) => {
              const { type, content = '', summary, errors, capability, card, payload } = event;

              // Inline org-change card (§6.3) — rendered before the type
              // branches so deploy/status events carrying a card show the card
              // (with its payload) instead of only a bubble.
              if (card && payload !== undefined) {
                appendMessage({
                  id: makeId(),
                  role: 'assistant',
                  content,
                  type: 'card',
                  summary,
                  capability,
                  card,
                  payload,
                });
                return;
              }

              if (type === 'message') {
                appendMessage({ id: makeId(), role: 'assistant', content, type: 'message', summary, capability });
                return;
              }

              if (type === 'error') {
                appendMessage({ id: makeId(), role: 'assistant', content, type: 'error' });
                return;
              }

              if (type === 'deploy_success') {
                appendMessage({ id: makeId(), role: 'assistant', content, type: 'deploy_success', summary, capability });
                return;
              }

              if (type === 'deploy_warning') {
                appendMessage({ id: makeId(), role: 'assistant', content, type: 'deploy_warning', summary });
                return;
              }

              // Everything else (status / action / deploy / build_widget /
              // deploy_error / stream_chunk / unknown) becomes a progress step,
              // grouped into BuildProgressCards by the renderer.
              appendMessage({
                id: makeId(),
                role: 'assistant',
                content,
                type: PROGRESS_TYPES.includes(type) ? type : 'status',
                errors,
                capability,
              });
            },
          }
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        appendMessage({
          id: makeId(),
          role: 'assistant',
          content: err instanceof Error ? err.message : "Your request didn't go through. Please try again.",
          type: 'error',
        });
      } finally {
        setIsBuilding(false);
      }
    },
    [appendMessage, attachment, input, isBuilding, org, safePin, agentsUnavailable, readiness]
  );

  const stopChat = () => {
    abortRef.current?.abort();
    setIsBuilding(false);
  };

  // Wipes the conversation server-side and rotates to a fresh session id — the
  // guaranteed-clean path for the next message. The DELETE (/api/v1/chat/
  // :contextId, legacy parity) aborts anything still in-flight, drops the live
  // manager, and clears the Redis busy-lock + state so a crash-stuck lock or
  // a resurrected snapshot on the OLD key can't leak into the next
  // conversation. Fire-and-forget — never block on the network; the rotation
  // alone guarantees the fresh start (a cleared conversation must not keep
  // accumulating capability segments on the old spine).
  const resetConversationState = () => {
    if (!org) return;
    const oldSessionId = sessionIdRef.current;
    if (oldSessionId) {
      resetChatSession(oldSessionId, org.id).catch(() => {});
    }
    sessionIdRef.current = makeSessionId();
    setActiveSessionId(sessionIdRef.current);
    // Persist the rotation under the same key the session effect chose; if
    // the user isn't resolved yet (key unknown), the in-memory ref alone is
    // enough — the effect will pick a keyed id once it runs.
    try {
      if (sessionKeyRef.current) {
        window.sessionStorage.setItem(sessionKeyRef.current, sessionIdRef.current);
      }
    } catch {
      // Storage unavailable — the in-memory ref was still rotated above.
    }
  };

  const clearChat = () => {
    if (isBuilding) return;
    setMessages([]);
    setPin(null);
    setResetNote(null);
    resetConversationState();
  };

  // Stop AND reset — the mid-build sibling of Clear (which refuses while a run
  // is in flight because it doesn't abort): kills the stream (server sees the
  // disconnect → agent.abort), wipes the server-side conversation via DELETE
  // (/api/v1/chat/:contextId — lock + persisted state), and rotates to a fresh
  // session id so the next message can't 409 on a crash-stuck lock or hydrate
  // a stale snapshot. Per product decision the transcript AND pin are KEPT —
  // this is Stop plus a guaranteed-clean restart, not a fresh conversation.
  const stopAndResetChat = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    resetConversationState();
    setIsBuilding(false);
    // Brief inline confirmation — the reset's visible effect is subtle (the
    // transcript is kept), so make the server-side wipe legible, then
    // auto-dismiss.
    setResetNote('Conversation reset. Next message starts fresh.');
    if (resetNoteTimerRef.current) clearTimeout(resetNoteTimerRef.current);
    resetNoteTimerRef.current = setTimeout(() => setResetNote(null), 4000);
  };

  // ── History picker (resume from closed tabs) ───────────────────────────
  const refreshSessions = useCallback(async () => {
    if (!org) return;
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      setSessions(await listChatSessions(org.id));
    } catch (err) {
      setSessionsError(
        err instanceof Error && err.message ? err.message : 'Could not load past conversations.'
      );
    } finally {
      setSessionsLoading(false);
    }
  }, [org]);

  // Toggle the panel. The list is org-scoped and tiny, so every open fetches
  // fresh — no cache invalidation to get wrong when the user switches orgs.
  const toggleSessions = () => {
    if (sessionsOpen) {
      setSessionsOpen(false);
      return;
    }
    setSessionsOpen(true);
    refreshSessions();
  };

  // Rebuilds the visible conversation from a session's spine: a marker for
  // the flash-compressed head (when present) + the verbatim transcript tail.
  const buildMessagesFromSpine = (detail: SessionDetail): ChatMessage[] => {
    const out: ChatMessage[] = [];
    if (detail.contextSummary) {
      out.push({
        id: makeId(),
        role: 'assistant',
        content: 'Earlier in this conversation has been summarized and continues from memory.',
        type: 'message',
        summary: 'Resumed from memory',
      });
    }
    for (const turn of detail.transcript) {
      const text = turn?.text?.trim();
      if (!text) continue;
      out.push({
        id: makeId(),
        role: turn.role === 'user' ? 'user' : 'assistant',
        content: text,
        type: 'message',
      });
    }
    return out;
  };

  // Resumes a past session: adopts its session id (sessionStorage persists it
  // so a refresh keeps the same spine), rebuilds the transcript from the
  // durable memory, and clears the pin. The NEXT send continues the same
  // session — the engine resumes from Redis or the chat_sessions spine.
  const resumeSession = async (sessionId: string) => {
    if (!org || isBuilding) return;
    try {
      const detail = await getChatSessionDetail(sessionId, org.id);
      const adoptedId = detail.sessionId || sessionId;
      sessionIdRef.current = adoptedId;
      setActiveSessionId(adoptedId);
      try {
        if (sessionKeyRef.current) {
          window.sessionStorage.setItem(sessionKeyRef.current, adoptedId);
        }
      } catch {
        // Storage unavailable — the in-memory ref is enough for this tab.
      }
      setMessages(buildMessagesFromSpine(detail));
      setPin(null);
      setSessionsOpen(false);
      setResumeNote('Conversation resumed.');
      if (resumeNoteTimerRef.current) clearTimeout(resumeNoteTimerRef.current);
      resumeNoteTimerRef.current = setTimeout(() => setResumeNote(null), 4000);
    } catch (err) {
      setSessionsError(
        err instanceof Error && err.message ? err.message : 'Could not resume this conversation.'
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      startChat();
    }
  };

  // Auto-grow the composer with content: sync the textarea height to its
  // scrollHeight, clamped at max-h-40 (160px — the textarea's CSS cap). A
  // long prompt expands as it wraps instead of scrolling inside a one-line
  // box; clearing the input (send / reset) shrinks it back via the same path.
  //
  // scrollHeight includes the WRAPPED PLACEHOLDER: on narrow widths (e.g. a
  // docked preview pane) the placeholder wraps to several lines, inflating
  // the empty composer to its max so pasted templates show no growth. Measure
  // with the placeholder suppressed so height tracks real content only.
  const resizeComposer = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const placeholder = el.placeholder;
    el.placeholder = '';
    const contentHeight = el.scrollHeight;
    el.placeholder = placeholder;
    el.style.height = `${Math.min(contentHeight, 160)}px`;
  }, []);

  useEffect(() => {
    resizeComposer();
  }, [input, resizeComposer]);

  const pickStarter = (prompt: string) => {
    setInput(prompt);
    textareaRef.current?.focus();
  };

  // Transient notification — auto-dismiss after 4s (consistency with the
  // reset note). Re-arming clears any prior timer; a valid pick or a send
  // clears the error and its timer outright.
  const showAttachError = (message: string) => {
    setAttachError(message);
    if (attachErrorTimerRef.current) clearTimeout(attachErrorTimerRef.current);
    attachErrorTimerRef.current = setTimeout(() => setAttachError(null), 4000);
  };

  const clearAttachError = () => {
    setAttachError(null);
    if (attachErrorTimerRef.current) {
      clearTimeout(attachErrorTimerRef.current);
      attachErrorTimerRef.current = null;
    }
  };

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachment(null);
      showAttachError('Files must be 10MB or smaller.');
      return;
    }
    clearAttachError();
    setAttachment(file);
  };

  // Group consecutive progress events into single cards (Agentforge pattern),
  // splitting at capability boundaries: a `both` run renders ONE card per
  // segment (agent card, then org-change card — EC-23 per-segment progress
  // cards) instead of merging everything into a single wall of steps. The
  // handoff status is tagged org_change server-side, so it opens the org card.
  const groups = useMemo(() => {
    const out: Array<{
      key: string;
      isProgress: boolean;
      messages: ChatMessage[];
      capability?: ChatMessage['capability'];
    }> = [];
    for (const msg of messages) {
      const isProgress =
        msg.role === 'assistant' && PROGRESS_TYPES.includes(msg.type) && msg.type !== 'deploy_warning';
      const last = out[out.length - 1];
      // Untagged frames inherit the current segment (forward-compat: a future
      // engine emitting frames without a capability tag continues the card
      // instead of splitting a lonely one).
      const capability = msg.capability ?? last?.capability;
      if (isProgress && last?.isProgress && last.capability === capability) {
        last.messages.push(msg);
      } else {
        out.push({ key: msg.id, isProgress, messages: [msg], capability });
      }
    }
    return out;
  }, [messages]);

  if (!org) {
    return (
      <div className="max-w-xl mx-auto pt-16 text-center animate-fade-in">
        <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-blue-light mb-5">
          <PlugZap className="w-6 h-6 text-brand-blue" />
        </span>
        <h1 className="text-2xl font-bold text-brand-dark tracking-tight">Connect a Salesforce org to chat</h1>
        <p className="mt-2 text-slate-500">
          The Copilot builds agents and runs governed org changes against your connected org.
        </p>
        <Link
          href="/login?step=2"
          className="mt-7 inline-flex items-center gap-2 rounded-xl bg-brand-blue text-white text-sm font-semibold px-5 py-2.5 shadow-glow hover:bg-brand-blue-hover transition-colors"
        >
          Connect Salesforce <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  // Chat access gate: unless the OrgForge Connector package is installed in
  // the active org, the user gets a full-screen setup card instead of the
  // composer (both engines need the package — agent builds AND governed org
  // changes). Status transitions: idle/checking → spinner card; missing →
  // install steps + re-check; error → reconnect/retry; installed → chat.
  if (pkg.status !== 'installed') {
    return (
      <PackageRequiredGate
        health={pkg.health}
        status={pkg.status}
        onRecheck={pkg.forceRecheck}
        orgAlias={org.name}
      />
    );
  }

  return (
    <div className="h-[calc(100dvh-7rem)] md:h-[calc(100dvh-8rem)] flex flex-col max-w-4xl mx-auto w-full">
      {/* Conversation panel */}
      <div className="flex-1 min-h-0 flex flex-col bg-white/80 border border-brand-border rounded-2xl shadow-sm overflow-hidden">
        {/* Header row */}
        <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-brand-border bg-white/60">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Sparkles className="w-3.5 h-3.5 text-brand-blue" />
            OrgForge Copilot
            <span className="hidden sm:inline text-slate-300">·</span>
            <span className="hidden sm:inline text-slate-400">{org.name}</span>
          </div>
          <div className="relative flex items-center gap-2">
            {/* History picker — resume conversations from closed tabs. */}
            <button
              type="button"
              onClick={toggleSessions}
              disabled={isBuilding}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-slate-500 hover:text-brand-blue hover:bg-slate-100/80 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <History className="w-3.5 h-3.5" /> History
            </button>

            <span className="h-3.5 w-px bg-slate-200" aria-hidden="true" />

            <button
              type="button"
              onClick={clearChat}
              disabled={isBuilding}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Eraser className="w-3.5 h-3.5" /> Clear
            </button>
            {sessionsOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-brand-border rounded-xl shadow-lg overflow-hidden z-20">
                <div className="flex items-center justify-between px-3 py-2 border-b border-brand-border bg-white/60">
                  <span className="text-xs font-semibold text-slate-500">Past conversations</span>
                  <button
                    type="button"
                    onClick={() => setSessionsOpen(false)}
                    className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    aria-label="Close history"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto p-1.5">
                  {sessionsLoading ? (
                    <p className="px-3 py-4 text-xs text-slate-400">Loading…</p>
                  ) : sessionsError ? (
                    <p className="px-3 py-4 text-xs text-red-500">{sessionsError}</p>
                  ) : sessions && sessions.length > 0 ? (
                    sessions.map((s) => (
                      <button
                        key={s.sessionId}
                        type="button"
                        onClick={() => resumeSession(s.sessionId)}
                        disabled={isBuilding}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-brand-surface disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-700 truncate">
                            {s.lastSummary || 'Conversation'}
                          </span>
                          <span className="shrink-0 text-[10px] text-slate-400">
                            {timeAgo(s.updatedAt)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          {s.sessionId === activeSessionId ? 'Current · ' : ''}
                          session {s.sessionId.slice(0, 8)}
                          {s.hasSummary ? ' · summarized' : ''}
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-xs text-slate-400">
                      No past conversations in this org yet.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <div
          ref={chatContainerRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 bg-gradient-to-b from-brand-surface/40 to-brand-surface/70"
        >
          {showEmptyState ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto">
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-blue-light mb-4 border border-brand-blue/10">
                <Sparkles className="w-6 h-6 text-brand-blue" />
              </span>
              <h2 className="text-xl font-bold text-brand-dark mb-1">What should we build or change?</h2>
              <p className="text-xs font-medium text-slate-500 max-w-md mb-7">
                Build agents or make governed org changes in natural language. Pick a starter below or type your own.
              </p>
              <StarterCards onPick={pickStarter} />
            </div>
          ) : (
            <>
              <MessageBubble msg={greetingMessage} />
              {groups.map((group, index) => {
                if (group.isProgress) {
                  const isLast = index === groups.length - 1;
                  const steps: ProgressStep[] = group.messages.map((m) => ({
                    id: m.id,
                    type: m.type,
                    content: m.content,
                    errors: m.errors,
                  }));
                  return (
                    <div key={group.key} className="flex justify-start">
                      <BuildProgressCard
                        steps={steps}
                        isBuilding={isBuilding && isLast}
                        capability={group.capability}
                      />
                    </div>
                  );
                }
                const msg = group.messages[0];
                if (msg.type === 'card') {
                  return <OrgChangeCard key={msg.id} msg={msg} />;
                }
                return <MessageBubble key={msg.id} msg={msg} />;
              })}

              {/* Quick replies to the agent's clarifying question — sent pinned
                  to the agent so a terse answer is never re-routed. */}
              {awaitingAgentAnswer && (
                <div className="flex justify-end">
                  <div className="flex flex-wrap justify-end gap-2 max-w-[85%]">
                    {QUICK_AGENT_REPLIES.map((reply) => (
                      <button
                        key={reply}
                        type="button"
                        onClick={() => startChat(reply, 'agent')}
                        className="inline-flex items-center rounded-full border border-brand-blue/30 bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-blue hover:bg-brand-blue hover:text-white transition-colors cursor-pointer"
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {resetNote && (
                <div className="flex justify-center" role="status">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-brand-border px-3 py-1 text-xs text-slate-500 shadow-sm animate-fade-in">
                    <RotateCcw className="w-3 h-3 text-brand-blue" />
                    {resetNote}
                  </span>
                </div>
              )}
              {resumeNote && (
                <div className="flex justify-center" role="status">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-brand-border px-3 py-1 text-xs text-slate-500 shadow-sm animate-fade-in">
                    <History className="w-3 h-3 text-brand-blue" />
                    {resumeNote}
                  </span>
                </div>
              )}
              {isBuilding && (
                <div className="flex justify-start">
                  <div className="bg-white border border-brand-border rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm">
                    <span className="flex items-center gap-1.5 text-sm text-slate-400">
                      <span className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-blue animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-blue animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-blue animate-bounce" />
                      </span>
                      Thinking…
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-brand-border bg-white/80 p-3 sm:p-4">
          <div className="mb-2">
            <CapabilityChip
              value={safePin}
              onChange={setPin}
              disabled={isBuilding}
              disabledOptions={agentsUnavailable ? ['agent', 'both'] : []}
              disabledOptionsReason="Agent building isn't available in this org. Enable Agentforce Agent and Einstein in Setup → Agentforce"
              canary={ORGFORGE_UNIFIED_FRONTEND}
              stubVerdict={stubVerdict}
            />
          </div>
          {/* Readiness fetch failed — availability is unknown, offer an
              in-place retry instead of waiting for a page remount. */}
          {readinessFailed && (
            <p
              role="note"
              className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"
            >
              <Info className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span className="flex-1">
                Couldn&apos;t check whether agent building is available in this org.
              </span>
              <button
                type="button"
                onClick={readiness.retry}
                className="shrink-0 font-semibold text-brand-blue hover:underline cursor-pointer"
              >
                Retry
              </button>
            </p>
          )}
          {/* Agents-unavailable notice — driven by the same preflight data as
              the sign-in banner; names the exact fix instead of silently
              disabling the chip. */}
          {agentsUnavailable && (
            <p
              role="note"
              className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              <Info className="w-3.5 h-3.5 shrink-0 mt-px text-amber-600" />
              <span>
                Agent building is unavailable in this org. Enable{' '}
                <strong className="font-semibold">Agentforce Agent</strong> and{' '}
                <strong className="font-semibold">Einstein</strong> in{' '}
                <span className="font-mono text-[11px]">Setup → Agentforce</span>.{' '}
                <Link href="/settings" className="font-semibold underline underline-offset-2 hover:text-amber-900">
                  Fix in Settings
                </Link>
              </span>
            </p>
          )}
          {/* Attached file chip (legacy multer parity) */}
          {attachError && (
            <p className="mb-2 text-xs text-red-600" role="alert">
              {attachError}
            </p>
          )}
          {attachment && (
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue-light/70 border border-brand-blue/15 text-brand-blue px-3 py-1 font-medium max-w-[16rem] truncate">
                <Paperclip className="w-3 h-3 shrink-0" />
                <span className="truncate">{attachment.name}</span>
              </span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                disabled={isBuilding}
                aria-label={`Remove attachment ${attachment.name}`}
                className="text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_ATTACHMENT_TYPES}
              onChange={handlePickFile}
              className="hidden"
              aria-hidden
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBuilding}
              aria-label="Attach a file (PDF, DOCX, TXT, MD, or an image)"
              title="Attach a file (PDF, DOCX, TXT, MD, or an image)"
              className="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-xl border border-brand-border text-slate-400 hover:text-brand-blue hover:border-brand-blue/40 hover:bg-brand-surface transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            {/* 44px matches the h-11 (44px) attach/send/stop buttons so the
                composer row stays on one clean baseline. */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask OrgForge to build an agent or make an org change…"
              className="flex-1 resize-none rounded-xl border border-brand-border bg-brand-surface/60 px-4 py-3 text-sm text-brand-dark placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-shadow max-h-40"
              style={{ minHeight: 44 }}
            />
            {isBuilding ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={stopAndResetChat}
                  aria-label="Stop the run and reset this conversation's server state (lock + context). The transcript stays; the next message starts fresh"
                  title="Stop & reset. Abort the run and wipe this conversation's server lock + context; the transcript stays and the next message starts fresh"
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-brand-refused/40 text-brand-refused text-sm font-semibold px-3 h-11 hover:border-red-500 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Stop &amp; reset</span>
                </button>
                <button
                  type="button"
                  onClick={stopChat}
                  title="Stop the run but keep this conversation"
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-refused text-white text-sm font-semibold px-4 h-11 hover:bg-red-600 transition-colors cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" /> Stop
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => startChat()}
                disabled={!input.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-blue text-white text-sm font-semibold px-4 h-11 shadow-glow hover:bg-brand-blue-hover disabled:opacity-40 disabled:shadow-none transition-[background-color,box-shadow,transform] cursor-pointer active:scale-[0.98]"
              >
                <SendHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline">Send</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
