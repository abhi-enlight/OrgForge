/**
 * Dashboard data-viz types + status bucketing.
 *
 * These are the minimal shapes the dashboard charts read. They mirror the
 * richer records/agents fetched by the Changes & Audit and Agents pages — the
 * dashboard only needs the fields the panels render, and keeping the types
 * local avoids coupling the charts to page-level interfaces.
 */

/** Minimal change-record shape the dashboard charts read. */
export interface ChangeRecordLite {
  id?: string;
  title?: string;
  summary?: string;
  intent?: string;
  status?: string;
  createdAt?: string;
  kind?: string;
}

/** Minimal deployed-agent shape the dashboard reads. */
export interface AgentLite {
  id?: string;
  name?: string;
  developerName?: string;
  status?: string;
  description?: string;
}

export type StatusBucket = 'deployed' | 'pending' | 'refused' | 'other';

/**
 * Normalizes a record status into the same buckets the Changes & Audit page
 * uses for its badges — one shared visual language for statuses.
 */
export function bucketForStatus(status?: string): StatusBucket {
  const s = String(status || '').toLowerCase();
  if (['deployed', 'succeeded', 'success', 'approved'].includes(s)) return 'deployed';
  if (['refused', 'failed', 'error', 'rejected'].includes(s)) return 'refused';
  if (['pending', 'awaiting_approval', 'draft', 'in_progress'].includes(s)) return 'pending';
  return 'other';
}

export const STATUS_BUCKETS: {
  key: StatusBucket;
  label: string;
  /** Token class for SVG strokes / text (colors flow from the theme). */
  textClass: string;
  /** Token class for legend dots and chips. */
  dotClass: string;
}[] = [
  { key: 'deployed', label: 'Deployed', textClass: 'text-brand-pass', dotClass: 'bg-brand-pass' },
  { key: 'pending', label: 'Pending', textClass: 'text-brand-warning', dotClass: 'bg-brand-warning' },
  { key: 'refused', label: 'Refused', textClass: 'text-brand-refused', dotClass: 'bg-brand-refused' },
  { key: 'other', label: 'Recorded', textClass: 'text-slate-400', dotClass: 'bg-slate-300' },
];

/** Accessible "OK" vs "Needs setup" tone for an agent status. */
export function agentStatusTone(status?: string): 'ok' | 'warn' | 'muted' {
  const s = String(status || '').toLowerCase();
  if (['active', 'activated', 'online'].includes(s)) return 'ok';
  if (['draft', 'inactive', 'offline', 'archived'].includes(s)) return 'warn';
  return 'muted';
}
