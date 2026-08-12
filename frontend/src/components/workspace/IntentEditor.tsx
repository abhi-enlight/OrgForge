'use client';

import React, { useState } from 'react';
import { Sparkles, ArrowRight, AlertCircle, RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

interface IntentEditorProps {
  onGenerate: (intent: string, rationale: string) => void;
  isGenerating?: boolean;
  /** Preserved original intent text (e.g. after a Stage 3 rephrase). */
  initialIntent?: string;
  /** Preserved original rationale text. */
  initialRationale?: string;
}

export default function IntentEditor({
  onGenerate,
  isGenerating = false,
  initialIntent = '',
  initialRationale = '',
}: IntentEditorProps) {
  const [intent, setIntent] = useState(
    initialIntent ||
      'Create a ValidationRule on Opportunity named Require_Loss_Reason_On_Closed_Lost that requires Loss_Reason__c field to be populated whenever an Opportunity is moved to Closed Lost stage.'
  );
  const [rationale, setRationale] = useState(
    initialRationale ||
      'Enforces mandatory win/loss analysis compliance requested by VP of Sales Ops for Q3 pipeline hygiene reporting.'
  );
  const [showError, setShowError] = useState(false);

  // Shown when the user returns here from the Stage 3 rephrase escape hatch.
  const isRephrasing = initialIntent.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || !rationale.trim()) {
      setShowError(true);
      return;
    }
    setShowError(false);
    onGenerate(intent, rationale);
  };

  return (
    <Card variant="glass" className="space-y-6 border-brand-border p-6 md:p-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-[0.14em] text-brand-blue">
            <Sparkles className="w-3.5 h-3.5 text-brand-blue" />
            STAGE 2: STATE INTENT &amp; RATIONALE
          </span>
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.12em]">
            Mandatory governance pair
          </span>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-brand-dark">
          What change do you want to make?
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          Describe the target component and business justification. Both fields are recorded in the SHA-256 change audit log.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {isRephrasing && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <RotateCcw className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
            <span>
              <strong>Refining your previous intent.</strong> Your original prompt is preserved below —
              edit it to disambiguate, then re-parse. A fresh intent record will be created.
            </span>
          </div>
        )}

        {/* Intent Area */}
        <div className="space-y-2">
          <label htmlFor="intent" className="block text-xs font-bold uppercase tracking-wider text-brand-dark/80">
            Natural Language Request / Intent
          </label>
          <textarea
            id="intent"
            rows={4}
            className="w-full bg-white text-brand-dark text-sm rounded-xl p-4 border border-brand-border placeholder:text-slate-400 focus:outline-none focus:border-brand-blue focus:ring-4 focus:ring-brand-blue/15 font-sans leading-relaxed transition-shadow"
            placeholder="e.g. Add a custom field to Account called Risk_Score__c as a number field..."
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
          />
          <div className="flex justify-between text-[11px] font-mono text-slate-500">
            <span>Be specific about SObject name and validation rule logic</span>
            <span>{intent.length} characters</span>
          </div>
        </div>

        {/* Business Rationale Area */}
        <div className="space-y-2 p-4 bg-brand-surface/70 rounded-xl border border-brand-border">
          <div className="flex items-center justify-between">
            <label htmlFor="rationale" className="block text-xs font-bold uppercase tracking-wider text-brand-dark flex items-center gap-1.5">
              <span>Business Rationale</span>
              <span className="text-rose-600 font-bold">*</span>
            </label>
          </div>
          <textarea
            id="rationale"
            rows={2}
            className="w-full bg-white text-brand-dark text-xs rounded-lg p-3 border border-brand-border placeholder:text-slate-400 focus:outline-none focus:border-brand-blue focus:ring-4 focus:ring-brand-blue/15 font-sans transition-shadow"
            placeholder="Why is this change necessary? Mention ticket # or business stakeholder request..."
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </div>

        {showError && (
          <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>Both Intent and Business Rationale are strictly required before proceeding.</span>
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full sm:w-auto"
          isLoading={isGenerating}
          rightIcon={<ArrowRight className="w-5 h-5" />}
        >
          Parse Intent & Resolve Skills
        </Button>
      </form>
    </Card>
  );
}
