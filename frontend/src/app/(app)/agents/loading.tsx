import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="flex h-[80vh] w-full flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin text-brand-blue" />
        <p className="text-sm font-medium animate-pulse">Loading workspace…</p>
      </div>
    </div>
  );
}
