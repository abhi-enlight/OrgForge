'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Eraser, Info, Paperclip, PlugZap, RotateCcw, SendHorizontal, Square, Sparkles, X } from 'lucide-react';
import { useActiveOrg } from '@/lib/org-context';
import { useOrgPackageHealth } from '@/lib/orgHealth';
import { useOrgReadiness } from '@/lib/orgReadiness';
import { resetChatSession, streamChat, type ChatMessage } from '@/lib/chat-stream';
import { FORGE_UNIFIED_FRONTEND } from '@/lib/flags';
import { classifyWithStub } from '@forge/ai/stubClassifier';
import MessageBubble from '@/components/chat/MessageBubble';
import OrgChangeCard from '@/components/chat/OrgChangeCard';
import BuildProgressCard, { PROGRESS_TYPES, type ProgressStep } from '@/components/chat/BuildProgressCard';
import CapabilityChip, { type CapabilityPin, type StubVerdict } from '@/components/chat/CapabilityChip';
import StarterCards from '@/components/chat/StarterCards';
import PackageRequiredGate from '@/components/org/PackageRequiredGate';

const GREETING =
  "Hi, I'm Forge — your Salesforce copilot. Ask me to **build or update an agent**, or to make a **governed org change** (validation rules, permission sets, fields).";

/** crypto.randomUUID is unavailable in non-secure contexts (http on LAN IP) — same fallback everywhere (review finding). */
function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

const makeSessionId = makeId;

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
  // Auto-checks on org change (Redis-cached 10 min), re-checks on demand.
  const pkg = useOrgPackageHealth(org?.id ?? null);
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
  // The attach ERROR is a transient notification (auto-dismissed like the
  // reset note) — the attachment CHIP, by contrast, is persistent state the
  // user manages with its X and must never silently vanish.
  const attachErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Canary-only (FORGE_UNIFIED_FRONTEND=on): the stub rule-based routing
  // preview for the current draft — free, offline, zero AI calls (plan §14.2
  // Phase 1). Pure computation on the input, never sent to the server.
  const stubVerdict: StubVerdict | null = useMemo(
    () => (FORGE_UNIFIED_FRONTEND && input.trim() ? classifyWithStub(input) : null),
    [input]
  );

  // Stable per-org session key (S-2 chat_sessions): persisted in localStorage
  // so a refresh (or an org switch) resumes the same session spine on the
  // server. Effect-scoped (react-hooks/refs forbids render-phase access).
  const sessionIdRef = useRef<string | null>(null);
  const sessionOrgRef = useRef<string | null>(null);
  useEffect(() => {
    if (!org || sessionOrgRef.current === org.id) return;
    sessionOrgRef.current = org.id;
    const storageKey = `forge.chat.session.${org.id}`;
    try {
      const stored = window.localStorage.getItem(storageKey);
      sessionIdRef.current = stored && stored.length <= 200 ? stored : makeSessionId();
      window.localStorage.setItem(storageKey, sessionIdRef.current);
    } catch {
      // Storage unavailable — fall back to an in-memory session id.
      sessionIdRef.current = sessionIdRef.current ?? makeSessionId();
    }
  }, [org]);
  const abortRef = useRef<AbortController | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const greetingMessage: ChatMessage = useMemo(
    () => ({ id: 'greeting', role: 'assistant', content: GREETING, type: 'message' }),
    []
  );
  const showEmptyState = messages.length === 0 && !isBuilding;

  // Org readiness (SHARED with the sign-in banner — same fetch, same data):
  // when the preflight says the org can't run agents (Agentforce + Einstein
  // settings, license, provisioning), the Agent and Both chip options are
  // disabled and any previously-pinned agent/both choice downgrades to Auto so
  // a disabled option can never sit in an active state.
  const readiness = useOrgReadiness();
  const agentsUnavailable =
    readiness.orgId === org?.id && readiness.diag?.capability?.agents === 'attention';
  // A FAILED readiness fetch (transient network/token blip) leaves the chip
  // enabled — surface that the availability is unknown and let the user retry
  // in-place (the hook unmarks failed orgs, so retry() re-runs without a
  // remount).
  const readinessFailed =
    readiness.orgId === org?.id && readiness.error != null && !readiness.diag;
  const safePin = agentsUnavailable && (pin === 'agent' || pin === 'both') ? null : pin;

  // Deep links (?prompt=) — from the dashboard tiles, templates, and the
  // agents/changes pages — prefill the composer so the user can review and
  // send. Re-runs when the param changes (client-side navigation may re-render
  // the same mounted page instead of remounting it), but only applies a given
  // prompt once so editing the textarea isn’t clobbered by a re-render.
  const appliedPromptRef = useRef<string | null>(null);
  useEffect(() => {
    const promptParam = searchParams.get('prompt');
    if (!promptParam || appliedPromptRef.current === promptParam) return;
    appliedPromptRef.current = promptParam;
    // Deferred so state settles after mount (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      setInput(promptParam);
      textareaRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [searchParams]);

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

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const startChat = useCallback(
    async (overridePrompt?: string) => {
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
      setIsBuilding(true);
      setIsUserScrolledUp(false);
      // A new message supersedes any reset confirmation — clear the note AND
      // its auto-dismiss timer so it can't fire later.
      setResetNote(null);
      if (resetNoteTimerRef.current) {
        clearTimeout(resetNoteTimerRef.current);
        resetNoteTimerRef.current = null;
      }

      appendMessage({ id: makeId(), role: 'user', content: text, type: 'message' });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamChat(
          {
            message: text,
            orgId: org.id,
            pinned: safePin ?? undefined,
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
          content: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
          type: 'error',
        });
      } finally {
        setIsBuilding(false);
      }
    },
    [appendMessage, attachment, input, isBuilding, org, safePin]
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
    try {
      const storageKey = `forge.chat.session.${org.id}`;
      sessionIdRef.current = makeSessionId();
      window.localStorage.setItem(storageKey, sessionIdRef.current);
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
    setResetNote('Conversation reset — next message starts fresh.');
    if (resetNoteTimerRef.current) clearTimeout(resetNoteTimerRef.current);
    resetNoteTimerRef.current = setTimeout(() => setResetNote(null), 4000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      startChat();
    }
  };

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
            Forge Copilot
            <span className="hidden sm:inline text-slate-300">·</span>
            <span className="hidden sm:inline text-slate-400">{org.name}</span>
          </div>
          <button
            type="button"
            onClick={clearChat}
            disabled={isBuilding}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-red-500 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Eraser className="w-3.5 h-3.5" /> Clear
          </button>
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
              <h2 className="text-xl font-bold text-brand-dark mb-1">Ask Forge anything</h2>
              <p className="text-xs font-medium text-slate-500 max-w-md mb-7">
                Build agents or make governed org changes in natural language — pick a starter below or type your own.
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
              {resetNote && (
                <div className="flex justify-center" role="status">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-brand-border px-3 py-1 text-xs text-slate-500 shadow-sm animate-fade-in">
                    <RotateCcw className="w-3 h-3 text-brand-blue" />
                    {resetNote}
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
              disabledOptionsReason="Agent building isn't available in this org — enable Agentforce Agent and Einstein in Setup → Agentforce"
              canary={FORGE_UNIFIED_FRONTEND}
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
                Agent building is unavailable in this org — enable{' '}
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
              placeholder="Ask Forge to build an agent or make an org change…"
              className="flex-1 resize-none rounded-xl border border-brand-border bg-brand-surface/60 px-4 py-3 text-sm text-brand-dark placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-shadow max-h-40"
              style={{ minHeight: 44 }}
            />
            {isBuilding ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={stopAndResetChat}
                  aria-label="Stop the run and reset this conversation's server state (lock + context) — the transcript stays; the next message starts fresh"
                  title="Stop & reset — abort the run and wipe this conversation's server lock + context; the transcript stays and the next message starts fresh"
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
