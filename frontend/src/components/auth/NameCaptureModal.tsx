'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Modal from '@/components/ui/Modal';

/**
 * One-time full-name capture for accounts created before the signup form
 * collected a name. Mounted inside AppShell: on entry it reads the user's
 * metadata, and if `full_name` is missing it asks for it once, saves it to
 * auth.users.user_metadata, and never shows again.
 */
export default function NameCaptureModal() {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const existing = data.user?.user_metadata?.full_name;
        if (!existing) setOpen(true);
      } catch {
        // Read failed — err on the side of asking (the user can re-save).
        setOpen(true);
      } finally {
        setChecked(true);
      }
    })();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = fullName.trim();
    if (!name) {
      setError('Please enter your name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ data: { full_name: name } });
      if (updateErr) throw new Error(updateErr.message);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // No-op while the check runs — the app shell renders without flashing the modal.
  if (!checked) return null;

  return (
    <Modal
      isOpen={open}
      title="What should we call you?"
      description="Tell us your name so we can greet you personally."
    >
      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-slate-700 mb-1">
            Full name
          </label>
          <div className="relative">
            <UserRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="fullName"
              type="text"
              required
              autoComplete="name"
              autoFocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-xl border border-brand-border pl-10 pr-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue transition-shadow"
              placeholder="Alex Morgan"
            />
          </div>
        </div>

        {error && <p className="text-sm text-brand-refused">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-blue text-white font-semibold py-2.5 hover:bg-brand-blue-hover transition-colors disabled:opacity-60 cursor-pointer"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Save
        </button>
      </form>
    </Modal>
  );
}
