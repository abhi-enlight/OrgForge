'use client';

import React from 'react';
import { ShieldCheck, Mail } from 'lucide-react';
import Input from '@/components/ui/Input';

interface ApproverInputProps {
  value: string;
  onChange: (val: string) => void;
  error?: string;
}

export default function ApproverInput({ value, onChange, error }: ApproverInputProps) {
  return (
    <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-blue">
          <ShieldCheck className="w-4 h-4 text-brand-blue" />
          REF-04 Unblock: Approver Identity
        </span>
        <span className="text-[10px] font-mono bg-white text-brand-blue px-2 py-0.5 rounded font-bold border border-blue-200">
          MANDATORY FOR SECURITY CHANGES
        </span>
      </div>
      <p className="text-xs text-slate-600">
        Changes impacting PermissionSets, OWD, or Sharing Rules require a validated human approver email address.
      </p>

      <Input
        label="Authorized Approver Email"
        type="email"
        placeholder="security-lead@enlightlab.com"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        leftIcon={<Mail className="w-4 h-4 text-brand-blue" />}
        error={error}
      />
    </div>
  );
}
