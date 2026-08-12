'use client';

import { AlertTriangle, CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import Markdown from './Markdown';
import type { ChatMessage } from '@/lib/chat-stream';

/**
 * One chat bubble (ported from Agentforge chat, re-tokenized). Renders by
 * message type: user / deploy_success / deploy_warning / error / default
 * assistant. `capability` from the unified envelope shows as a small badge.
 */
export default function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="relative px-5 py-4 rounded-3xl rounded-tr-sm max-w-[85%] shadow-[0_8px_24px_rgba(26,107,255,0.2)] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-blue to-[#0D47A1] opacity-95" />
          <div className="relative z-10 text-white text-sm leading-relaxed">
            <Markdown text={msg.content} isUser />
          </div>
        </div>
      </div>
    );
  }

  if (msg.type === 'deploy_success') {
    return (
      <div className="flex justify-start">
        <div className="bg-emerald-50 border border-emerald-200/60 rounded-2xl px-5 py-4 max-w-[85%] shadow-sm w-full">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="p-1.5 bg-emerald-100 rounded-full text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
            </span>
            <span className="font-bold text-emerald-900 text-sm">Deployed successfully</span>
          </div>
          {msg.summary && (
            <div className="text-emerald-800/90 mb-4">
              <Markdown text={msg.summary} />
            </div>
          )}
          {msg.content && (
            <a
              href={msg.content}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-500 transition-colors"
            >
              Open in Salesforce <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    );
  }

  if (msg.type === 'deploy_warning') {
    return (
      <div className="flex justify-start">
        <div className="bg-amber-50 border border-amber-200/70 rounded-2xl px-4 py-3.5 max-w-[85%] shadow-sm">
          <div className="flex items-start gap-3">
            <span className="p-1.5 bg-amber-100 rounded-full text-amber-600 shrink-0 mt-0.5">
              <AlertTriangle className="w-3.5 h-3.5" />
            </span>
            <div className="flex flex-col gap-1 min-w-0">
              {/* The engine sends a per-warning summary (e.g. "Blocked by 2
                  refusal gates") — use it as the header instead of a blanket
                  "Permission assignment issue". */}
              <span className="text-xs font-semibold text-amber-900">{msg.summary || 'Attention needed'}</span>
              {/* whitespace-pre-line keeps the engine's enumerated refusal
                  lines (one per refused gate) on their own rows. */}
              <span className="text-xs text-amber-800/90 leading-relaxed whitespace-pre-line">{msg.content}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (msg.type === 'error') {
    return (
      <div className="flex justify-start">
        <div className="bg-red-50 border border-red-200/60 rounded-2xl px-4 py-3.5 max-w-[85%] shadow-sm">
          <div className="flex items-start gap-3">
            <span className="p-1 bg-red-100 rounded-full text-red-500 shrink-0 mt-0.5">
              <XCircle className="w-3.5 h-3.5" />
            </span>
            <span className="text-sm font-medium text-red-900 leading-relaxed">{msg.content}</span>
          </div>
        </div>
      </div>
    );
  }

  // Default assistant message
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-brand-border rounded-2xl rounded-tl-sm px-5 py-4 max-w-[85%] shadow-sm">
        {msg.capability && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide mb-2 ${
              msg.capability === 'agent'
                ? 'bg-brand-blue-light text-brand-blue'
                : 'bg-emerald-50 text-emerald-600'
            }`}
          >
            {msg.capability === 'agent' ? 'Agent' : 'Org change'}
          </span>
        )}
        <Markdown text={msg.content} />
      </div>
    </div>
  );
}
