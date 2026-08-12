'use client';

import { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';

/**
 * Fenced-code block renderer (ported from Agentforge chat). Dark mono panel
 * with a language tag and a copy-to-clipboard button.
 */
export default function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-[#1E2740] bg-[#0A0F1E] shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-white/[0.06]">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400">
          <Terminal className="w-3 h-3" />
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[12.5px] leading-relaxed font-mono text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
