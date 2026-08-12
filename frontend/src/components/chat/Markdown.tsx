'use client';

import { Fragment } from 'react';
import CodeBlock from './CodeBlock';

/**
 * Lightweight markdown renderer (ported from Agentforge chat, re-tokenized):
 * headings, ordered/unordered lists, rules, fenced code, blockquotes, and
 * inline links / bold / italic / code. Deliberately dependency-free — the
 * agent output vocabulary is a small, known subset.
 */
export default function Markdown({ text, isUser = false }: { text: string; isUser?: boolean }) {
  if (!text) return <span className="italic text-slate-400">Thinking…</span>;

  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  const parseInline = (line: string): React.ReactNode =>
    line
      .split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
      .map((part, idx) => {
        if (!part) return null;

        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          const href = linkMatch[2];
          // Protocol allowlist — model output is untrusted; never allow
          // javascript: / data: hrefs (review finding). Unsafe links render
          // as plain text.
          if (/^(https?:|mailto:)/i.test(href)) {
            return (
              <a
                key={idx}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-blue hover:underline font-medium"
              >
                {linkMatch[1]}
              </a>
            );
          }
          return <Fragment key={idx}>{part}</Fragment>;
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={idx}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <em key={idx}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={idx}>{part.slice(1, -1)}</code>;
        }
        return <Fragment key={idx}>{part}</Fragment>;
      });

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('### ')) {
      nodes.push(<h3 key={i}>{parseInline(line.slice(4))}</h3>);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(<h2 key={i}>{parseInline(line.slice(3))}</h2>);
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      nodes.push(<h1 key={i}>{parseInline(line.slice(2))}</h1>);
      i++;
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const match = lines[i].match(/^(\d+)\.\s/);
        items.push(
          <li key={i} value={match ? parseInt(match[1], 10) : undefined}>
            {parseInline(lines[i].replace(/^\d+\.\s/, ''))}
          </li>
        );
        i++;
      }
      nodes.push(<ol key={`ol-${i}`}>{items}</ol>);
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(<li key={i}>{parseInline(lines[i].slice(2))}</li>);
        i++;
      }
      nodes.push(<ul key={`ul-${i}`}>{items}</ul>);
      continue;
    }

    if (line.trim() === '---' || line.trim() === '***') {
      nodes.push(<hr key={i} className="border-brand-border my-3" />);
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      const lang = line.slice(3).trim();
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(<CodeBlock key={i} lang={lang} code={codeLines.join('\n')} />);
      if (i < lines.length && lines[i].startsWith('```')) i++;
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.startsWith('> ')) {
      nodes.push(
        <blockquote
          key={i}
          className="border-l-4 border-brand-blue/30 pl-4 py-1 my-2 bg-brand-blue-light text-slate-700 italic rounded-r-lg"
        >
          {parseInline(line.slice(2))}
        </blockquote>
      );
      i++;
      continue;
    }

    nodes.push(<p key={i}>{parseInline(line)}</p>);
    i++;
  }

  return <div className={isUser ? 'space-y-2' : 'space-y-2 text-sm leading-relaxed text-slate-700'}>{nodes}</div>;
}
