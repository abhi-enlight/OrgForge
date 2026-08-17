'use client';

import { Bot, Headset, ShieldCheck, Sparkles, Workflow } from 'lucide-react';

const STARTERS = [
  {
    id: 'customer-support',
    title: 'Customer Support Agent',
    description: 'Create an automated assistant to handle FAQs, look up orders, and answer customer questions.',
    prompt:
      'Build a Customer Support Agent that handles customer inquiries, FAQs, order status checks, and account updates in my org.',
    icon: Headset,
    kind: 'agent',
  },
  {
    id: 'lead-qualification',
    title: 'Lead Qualification Bot',
    description: 'Score inbound leads and route top prospects to the right sales reps.',
    prompt:
      'Build a Lead Qualification Agent that scores B2B leads based on budget and company size, and assigns qualified leads to account managers.',
    icon: Sparkles,
    kind: 'agent',
  },
  {
    id: 'validation-rule',
    title: 'Require Business Case on $1M+ Deals',
    description: 'Add a safety rule on Opportunities that checks deal size before closing.',
    prompt:
      'Add a validation rule to the Opportunity object that prevents closing deals above $1M without an approved business case.',
    icon: ShieldCheck,
    kind: 'org_update',
  },
  {
    id: 'field-permissions',
    title: 'Grant Support Team Field Access',
    description: 'Create a permission set giving your support team access to Case Status.',
    prompt:
      'Create a permission set giving my support team read-write access to the Case Status field.',
    icon: Workflow,
    kind: 'org_update',
  },
];

/**
 * Empty-state starter prompts — simple, clear, and business-focused.
 */
export default function StarterCards({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
      {STARTERS.map((card) => {
        const Icon = card.icon;
        const isAgent = card.kind === 'agent';
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onPick(card.prompt)}
            className="p-4 bg-white rounded-2xl border border-brand-border shadow-sm hover:border-brand-blue/50 hover:shadow-md hover:-translate-y-0.5 transition-[transform,box-shadow,border-color] group cursor-pointer"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <span className="p-2 rounded-xl border border-brand-blue/10 bg-brand-blue-light group-hover:bg-brand-blue/10 transition-colors">
                <Icon className="w-4 h-4 text-brand-blue" />
              </span>
              <span className="text-xs font-bold text-brand-dark group-hover:text-brand-blue transition-colors">
                {card.title}
              </span>
              <span
                className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                  isAgent ? 'bg-brand-blue-light text-brand-blue' : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                }`}
              >
                <Bot className="w-2.5 h-2.5" />
                {isAgent ? 'Agent' : 'Org Update'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">{card.description}</p>
          </button>
        );
      })}
    </div>
  );
}
