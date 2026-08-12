'use client';

import React, { useState } from 'react';
import { HelpCircle, Check, ArrowRight, RotateCcw, MessageSquareText, AlertCircle } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface AmbiguityOption {
  id: string;
  title: string;
  desc: string;
  recommended: boolean;
}

interface AmbiguityCardProps {
  ambiguities?: AmbiguityOption[];
  onResolve: (selectedOption: string) => void;
  /** Submits a free-text resolution the AI options didn't cover. */
  onCustomResolve: (customText: string) => void;
  /** Sends the user back to Stage 2 to rephrase the original intent. */
  onRephrase: () => void;
  isResolving?: boolean;
}

const MIN_CUSTOM_LENGTH = 10;

type EscapeChoice = 'rephrase' | 'custom' | null;

export default function AmbiguityCard({
  ambiguities = [],
  onResolve,
  onCustomResolve,
  onRephrase,
  isResolving = false,
}: AmbiguityCardProps) {
  const [selectedOption, setSelectedOption] = useState<string>(ambiguities.length > 0 ? ambiguities[0].id : '');
  const [escapeChoice, setEscapeChoice] = useState<EscapeChoice>(null);
  const [customText, setCustomText] = useState('');
  const [customError, setCustomError] = useState(false);

  const options = ambiguities;

  const selectAiOption = (id: string) => {
    setSelectedOption(id);
    setEscapeChoice(null);
    setCustomError(false);
  };

  // Keep selectedOption intact — it's ignored while escapeChoice is set (the
  // AI option isSelected check gates on !escapeChoice), so backing out of an
  // escape hatch restores the pre-selected option instead of a dead state.
  const selectEscape = (choice: 'rephrase' | 'custom') => {
    setEscapeChoice(choice);
    setCustomError(false);
  };

  const handleCustomSubmit = () => {
    if (customText.trim().length < MIN_CUSTOM_LENGTH) {
      setCustomError(true);
      return;
    }
    setCustomError(false);
    onCustomResolve(customText.trim());
  };

  const isRephrase = escapeChoice === 'rephrase';
  const isCustom = escapeChoice === 'custom';

  return (
    <Card variant="glass" className="space-y-6 border-brand-border p-6 md:p-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-[0.14em] text-amber-600">
            <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
            STAGE 3: RESOLVE INTENT AMBIGUITY
          </span>
          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
            1 CLARIFICATION REQUIRED
          </span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-brand-dark">
          Clarify Validation Rule Trigger Scope
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          The AI detected an ambiguity in how the formula condition should evaluate existing vs new edits.
        </p>
      </div>

      <div className="space-y-3" role="radiogroup" aria-label="Ambiguity options">
        {options.map((opt) => {
          const isSelected = selectedOption === opt.id && !escapeChoice;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => selectAiOption(opt.id)}
              className={cn(
                'w-full text-left p-4 rounded-xl border transition-[background-color,border-color,box-shadow,color] duration-200 space-y-1 cursor-pointer',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:ring-offset-1',
                isSelected
                  ? 'bg-blue-50/70 border-brand-blue ring-2 ring-brand-blue/20 shadow-sm'
                  : 'bg-white border-brand-border hover:border-slate-300'
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'h-4 w-4 shrink-0 rounded-full border flex items-center justify-center transition-colors',
                    isSelected ? 'border-brand-blue bg-brand-blue text-white' : 'border-slate-300 bg-white'
                  )}
                >
                  {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                </span>
                <span className="text-sm font-bold text-brand-dark">{opt.title}</span>
                {opt.recommended && (
                  <span className="text-[10px] font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold">
                    RECOMMENDED
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 pl-[26px] leading-relaxed">{opt.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Escape hatch — the AI options don't cover the user's real intent */}
      <div className="pt-1">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="h-px flex-1 bg-brand-border" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-slate-400">
            None of these match your intent?
          </span>
          <span className="h-px flex-1 bg-brand-border" />
        </div>

        <div className="space-y-3" role="radiogroup" aria-label="Alternative actions">
          {/* Rephrase */}
          <button
            type="button"
            role="radio"
            aria-checked={isRephrase}
            onClick={() => selectEscape('rephrase')}
            className={cn(
              'w-full text-left p-4 rounded-xl border border-dashed transition-[background-color,border-color,box-shadow,color] duration-200 cursor-pointer',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:ring-offset-1',
              isRephrase
                ? 'bg-amber-50/80 border-amber-400 ring-2 ring-amber-400/20 shadow-sm'
                : 'bg-white border-slate-300 hover:border-amber-300'
            )}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  'h-4 w-4 shrink-0 rounded-full border flex items-center justify-center transition-colors',
                  isRephrase ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-300 bg-white'
                )}
              >
                {isRephrase && <Check className="w-3 h-3 stroke-[3]" />}
              </span>
              <RotateCcw className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-sm font-bold text-brand-dark">None of these — rephrase my intent</span>
            </div>
            <p className="text-xs text-slate-600 pl-[26px] leading-relaxed mt-1">
              Return to Stage 2 with your original prompt preserved and refine the wording so the AI
              parses it correctly.
            </p>
          </button>

          {/* Free-text custom resolution */}
          <div
            onClick={() => !isCustom && selectEscape('custom')}
            className={cn(
              'rounded-xl border border-dashed transition-[background-color,border-color] duration-200 p-4',
              isCustom
                ? 'bg-blue-50/60 border-brand-blue'
                : 'bg-white border-slate-300 hover:border-brand-blue cursor-pointer'
            )}
          >
            <button
              type="button"
              role="radio"
              aria-checked={isCustom}
              onClick={() => selectEscape('custom')}
              className="w-full text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 rounded-lg"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'h-4 w-4 shrink-0 rounded-full border flex items-center justify-center transition-colors',
                    isCustom ? 'border-brand-blue bg-brand-blue text-white' : 'border-slate-300 bg-white'
                  )}
                >
                  {isCustom && <Check className="w-3 h-3 stroke-[3]" />}
                </span>
                <MessageSquareText className="w-4 h-4 text-brand-blue shrink-0" />
                <span className="text-sm font-bold text-brand-dark">My intent is something else</span>
              </div>
              <p className="text-xs text-slate-600 pl-[26px] leading-relaxed mt-1">
                Describe exactly what you want OrgForge to change, and the AI will generate metadata
                from your resolution instead.
              </p>
            </button>

            {isCustom && (
              <div className="mt-3 pl-[26px] space-y-2">
                <label htmlFor="custom-resolution" className="sr-only">
                  Describe your actual intent
                </label>
                <textarea
                  id="custom-resolution"
                  rows={3}
                  value={customText}
                  onChange={(e) => {
                    setCustomText(e.target.value);
                    if (customError) setCustomError(false);
                  }}
                  placeholder="e.g. Make the field required only when the ticket status is Closed, not at the database level..."
                  className="w-full bg-white text-brand-dark text-xs rounded-lg p-3 border border-brand-border placeholder:text-slate-400 focus:outline-none focus:border-brand-blue focus:ring-4 focus:ring-brand-blue/15 font-sans transition-shadow"
                />
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>Be specific about the scope, condition, or behavior you actually want</span>
                  <span>{customText.length} chars</span>
                </div>
                {customError && (
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                    Please describe your intent in at least {MIN_CUSTOM_LENGTH} characters.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {escapeChoice && (
          <Button variant="ghost" size="md" onClick={() => { setEscapeChoice(null); setCustomError(false); }} disabled={isResolving}>
            Back to Options
          </Button>
        )}

        {isRephrase ? (
          <Button
            variant="secondary"
            size="md"
            onClick={onRephrase}
            leftIcon={<RotateCcw className="w-4 h-4" />}
          >
            Rephrase My Intent
          </Button>
        ) : isCustom ? (
          <Button
            variant="primary"
            size="md"
            onClick={handleCustomSubmit}
            isLoading={isResolving}
            disabled={isResolving}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Generate Metadata with My Resolution
          </Button>
        ) : (
          <Button
            variant="primary"
            size="md"
            onClick={() => onResolve(selectedOption)}
            isLoading={isResolving}
            disabled={isResolving || !selectedOption}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Confirm Selection & Generate Metadata
          </Button>
        )}
      </div>
    </Card>
  );
}
