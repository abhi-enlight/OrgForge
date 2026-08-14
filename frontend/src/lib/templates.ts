import {
  Headset,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  GraduationCap,
  CalendarClock,
  Receipt,
  Database,
  FileSignature,
  ShieldCheck,
  Lock,
  Tags,
  ScrollText,
  EyeOff,
  Sigma,
  KeyRound,
  LayoutGrid,
  Unlock,
} from 'lucide-react';

/**
 * Copilot templates (§6.6) — the two catalogs shown on /templates:
 * agent templates (build a new Agentforce agent) and change & audit
 * templates (a governed org change or audit request).
 *
 * The `prompt` is what actually gets sent to the Copilot, so every template
 * is written to be a complete, self-contained brief: the goal, the exact
 * behavior, and the edge cases the build must handle. No template should
 * require the user to add detail — they can, but they shouldn't have to.
 */
export type TemplateKind = 'agent' | 'change';

export interface OrgForgeTemplate {
  id: string;
  kind: TemplateKind;
  title: string;
  description: string;
  /** The full prompt sent to the Copilot — detailed + edge-case-aware. */
  prompt: string;
  tags: string[];
  difficulty: 'Starter' | 'Intermediate' | 'Advanced';
  icon: typeof Headset;
}

export const AGENT_TEMPLATES: OrgForgeTemplate[] = [
  {
    id: 'customer-support',
    kind: 'agent',
    title: 'Customer Support Agent',
    description:
      'An always-on agent that answers FAQs, checks order status, and resolves account issues, and knows when to hand off to a human.',
    prompt:
      'Build a Customer Support Agent for my org. It should handle three jobs: (1) answer frequently-asked questions about products, shipping, and returns from our knowledge base; (2) look up order status, tracking, and order history; (3) resolve simple account issues like updating contact details or resetting a portal password. Design it with these edge cases explicitly handled: ask for the customer\u2019s email or order number before pulling any personal data, and never expose another customer\u2019s data; if the account is not found or the details don\u2019t match, say so clearly and offer a verification step instead of guessing; for anything involving refunds, cancelations, or payment-sensitive changes, escalate to a human with a short summary of what was tried; if the customer repeats the same question or expresses frustration, switch to an empathetic tone and offer a human handoff; if a question is out of scope (billing disputes, legal, sales), route it to the right team instead of answering from memory. End with a handoff path that captures the conversation context so the human agent doesn\u2019t have to start over.',
    tags: ['FAQ', 'Order status', 'Escalation'],
    difficulty: 'Intermediate',
    icon: Headset,
  },
  {
    id: 'lead-qualification',
    kind: 'agent',
    title: 'Lead Qualification Bot',
    description:
      'Scores inbound leads with BANT-style logic, detects duplicates, and routes qualified prospects to the right rep.',
    prompt:
      'Build a Lead Qualification Agent. For each inbound Lead it should: (1) score the lead 0\u2013100 on budget, authority, need, and timeline (BANT) using the fields on the Lead record; (2) enrich the score with firmographic data where available; (3) assign the lead to the account manager who owns the matching territory or segment; (4) log a clear qualification note on the record explaining the score. Handle these edge cases explicitly: if required fields are missing (no budget, no company size), score conservatively and flag the lead as needing enrichment instead of guessing; if the lead matches an existing lead or account, surface the duplicate and merge instead of creating a double; if no rep matches the territory, leave the lead unassigned and put it in a review queue rather than silently routing to the wrong owner; if the lead is a competitor, executive, or already a customer, mark it appropriately and skip normal routing; never write notes that contain invented numbers \u2014 only state what the data supports.',
    tags: ['BANT scoring', 'Routing', 'Dedup'],
    difficulty: 'Advanced',
    icon: Sparkles,
  },
  {
    id: 'case-triage',
    kind: 'agent',
    title: 'Case Triage & SLA Agent',
    description:
      'Classifies inbound support cases by severity, applies the right SLA, and watches for breaches before they happen.',
    prompt:
      'Build a Case Triage Agent that owns inbound support cases. It should: (1) classify each case as Critical / High / Medium / Low from the description and subject; (2) assign it to the correct queue or owner based on product area and current workload; (3) set the correct SLA target and deadline on the record; (4) warn the owner (and their manager) when a case is within 25% of breaching its SLA. Edge cases to handle explicitly: keywords like \u201coutage\u201d, \u201cdata loss\u201d, or \u201csecurity\u201d must force Critical regardless of confidence; if classification is ambiguous, default to the higher severity and flag it for human review; if the owner queue is full or the owner is on vacation, reroute to the backup owner; reopened cases reset the SLA from the reopen time, not the original; never modify the case priority after it has been explicitly set by a human \u2014 your classification must respect manual overrides; if the case has attachments, include their presence in the summary but don\u2019t read sensitive content.',
    tags: ['Severity', 'SLA', 'Routing'],
    difficulty: 'Advanced',
    icon: AlertTriangle,
  },
  {
    id: 'opportunity-watchdog',
    kind: 'agent',
    title: 'Opportunity Pipeline Watchdog',
    description:
      'Watches open opportunities for stagnation, flags at-risk deals, and posts a concise weekly pipeline digest.',
    prompt:
      'Build an Opportunity Pipeline Watchdog agent. It should: (1) flag any open opportunity with no activity for 14+ days as \u201cstalled\u201d and suggest the next best action; (2) identify at-risk deals (close date in the next 30 days with low probability or no next step); (3) summarize win/loss movement weekly; (4) keep a rolling digest of the top 5 deals needing attention. Edge cases: ignore opportunities that are Closed Won, Closed Lost, or in a stage marked as inactive; exclude test records (names containing \u2018test\u2019, \u2018demo\u2019, or \u2018sandbox\u2019); respect record permissions \u2014 only review records the user can actually see; if there are no opportunities at all, report that instead of failing; don\u2019t create duplicate tasks or emails on repeated runs \u2014 check whether the action already exists before writing.',
    tags: ['Pipeline', 'Forecast', 'Digest'],
    difficulty: 'Intermediate',
    icon: TrendingUp,
  },
  {
    id: 'onboarding',
    kind: 'agent',
    title: 'New Hire Onboarding Assistant',
    description:
      'Guides new employees through setup steps, answers policy questions, and tracks their first-30-days checklist.',
    prompt:
      'Build a New Hire Onboarding Assistant for my org. It should: (1) welcome new hires with their first-day checklist (accounts, laptop, badge, benefits); (2) answer policy and handbook questions from our stored documentation; (3) track checklist completion and nudge when steps are overdue; (4) point to the right person for questions it can\u2019t answer. Edge cases to handle explicitly: answers must come from our documentation \u2014 if the question isn\u2019t covered, say you don\u2019t know and route to HR rather than improvising a policy; respect role-based visibility so a contractor or intern doesn\u2019t see manager-only content; handle both formal names and preferred/nicknames without mixing them up; if a step is already complete, don\u2019t re-assign it; if the hire is remote, substitute remote-specific steps; if the new hire asks about termination or offboarding, route to HR directly.',
    tags: ['HR', 'Checklist', 'Policies'],
    difficulty: 'Starter',
    icon: GraduationCap,
  },
  {
    id: 'appointment-scheduling',
    kind: 'agent',
    title: 'Appointment Scheduling Agent',
    description:
      'Books meetings with prospects and customers from the rep\u2019s real availability \u2014 and keeps the calendar honest.',
    prompt:
      'Build an Appointment Scheduling Agent that books meetings on behalf of sales reps. It should: (1) read the rep\u2019s calendar availability and propose real open slots; (2) book the meeting when the prospect confirms a slot, creating the calendar event and linking it to the Opportunity or Contact; (3) send a confirmation with a calendar invite; (4) offer reschedule and cancel flows that keep the record in sync. Edge cases to handle explicitly: never double-book \u2014 re-check availability immediately before confirming, because another invite may have landed since the proposal; respect timezone differences and propose slots in the prospect\u2019s local time; block out the rep\u2019s lunch, focus time, and out-of-office days and never propose them; if no slot is available in the next 5 business days, say so and offer a waitlist or a different rep instead of inventing availability; when the prospect cancels, offer the next best slot in the same reply; always confirm the exact time back to the prospect in their own timezone before creating the event; if the meeting needs a room or video link, include it and fall back gracefully if the room is unavailable.',
    tags: ['Calendar', 'Booking', 'Reschedule'],
    difficulty: 'Intermediate',
    icon: CalendarClock,
  },
  {
    id: 'billing-inquiry',
    kind: 'agent',
    title: 'Billing & Invoice Inquiry Agent',
    description:
      'Answers payment questions from the billing system \u2014 status, due dates, receipts \u2014 and routes disputes cleanly.',
    prompt:
      'Build a Billing & Invoice Inquiry Agent for my org. It should: (1) look up invoice status, due dates, and payment history for a customer; (2) explain charges in plain language; (3) provide receipts or a payment link; (4) handle dispute and refund requests by capturing the reason and routing to billing with full context. Edge cases to handle explicitly: verify the customer\u2019s identity (email or account number) before revealing any invoice or payment data, and never show another account\u2019s records; if the invoice is unpaid or overdue, state the amount and due date clearly and offer the payment path instead of judging; for disputed charges, capture the specific line item and reason and escalate rather than agreeing to a refund on the spot; if the billing lookup fails or the system is unavailable, say so and offer to retry \u2014 never guess amounts; when a customer asks for a discount or waiver, route to the approval owner instead of promising anything; keep a summary of the interaction attached to the account record so the billing team has context.',
    tags: ['Invoices', 'Payments', 'Disputes'],
    difficulty: 'Intermediate',
    icon: Receipt,
  },
  {
    id: 'data-quality',
    kind: 'agent',
    title: 'Data Quality & Hygiene Agent',
    description:
      'Detects duplicates, standardizes fields, and surfaces incomplete records \u2014 with human confirmation before any merge.',
    prompt:
      'Build a Data Quality Agent that keeps my records clean. It should: (1) detect duplicate Accounts, Contacts, and Leads using name, email, phone, and domain matching; (2) standardize common field values (phone formats, country names, state abbreviations, company name casing); (3) flag records missing critical fields like industry, owner, or phone; (4) propose a merge plan for confirmed duplicates and wait for approval before executing. Edge cases to handle explicitly: never merge records automatically \u2014 always present the merge plan (which record is the master, which fields win) and require confirmation; if confidence on a match is low, list it as a possible duplicate rather than forcing a merge; preserve the audit trail \u2014 don\u2019t delete data outright, archive or merge with history; respect record ownership and permission so you only touch records the user can edit; skip test records and records already marked as duplicates; after a merge, update related records (opportunities, cases, activities) to point at the survivor and report what changed.',
    tags: ['Dedup', 'Standardization', 'Hygiene'],
    difficulty: 'Advanced',
    icon: Database,
  },
  {
    id: 'contract-renewal',
    kind: 'agent',
    title: 'Contract Renewal Watchdog',
    description:
      'Tracks upcoming renewals, flags churn risk from usage, and prepares renewal briefs before the deadline.',
    prompt:
      'Build a Contract Renewal Watchdog agent. It should: (1) track contracts expiring in the next 90 days across all accounts; (2) flag high-value renewals (above a configurable ARR threshold) for early attention; (3) surface churn risk signals \u2014 declining usage, open support cases, no executive sponsor \u2014 and attach them to the renewal brief; (4) prepare a one-page renewal brief per account (current plan, usage, contacts, risk) ready for the account owner. Edge cases to handle explicitly: ignore contracts already renewed or marked lost, and don\u2019t re-flag them; if renewal terms are auto-renewing by contract language, note that and avoid a false-positive nudge; respect territory \u2014 each renewal goes to its account owner and never gets reassigned silently; if usage data is missing for an account, flag the renewal as needing a data check rather than assuming healthy usage; schedule reminders at 90, 60, and 30 days but don\u2019t create duplicate tasks on repeated runs; for contracts with no owner assigned, surface them to the manager instead of letting them sit unactioned.',
    tags: ['Renewals', 'Churn risk', 'ARR'],
    difficulty: 'Advanced',
    icon: FileSignature,
  },
];

export const CHANGE_TEMPLATES: OrgForgeTemplate[] = [
  {
    id: 'validation-rule',
    kind: 'change',
    title: 'Validation Rule \u2014 Closing Deal Guard',
    description:
      'Reject impossible or unapproved deals at save time with a clear error message, run through the governed change pipeline.',
    prompt:
      'Add a validation rule to the Opportunity object that prevents closing a deal above $1,000,000 without an approved business case. Requirements: the rule should fire only when the stage is set to Closed Won; it should block the save with a clear, user-friendly error message explaining what\u2019s missing; the rule must not break when the business case field is blank on lower-value deals. Edge cases to handle: the amount field may be blank \u2014 the formula must not error on null values; the business case approval field may live on a related record \u2014 use the correct relationship and guard against a missing related record; consider record types so the rule applies only where it should; make sure the formula is syntactically valid Salesforce formula syntax and I\u2019d like to see the blast radius (which profiles and records are affected) before anything is deployed.',
    tags: ['Formula', 'Opportunity', 'Guardrail'],
    difficulty: 'Intermediate',
    icon: ShieldCheck,
  },
  {
    id: 'field-permissions',
    kind: 'change',
    title: 'Field-Level Security Update',
    description:
      'Grant or restrict field access on a permission set with the effective-access implications spelled out.',
    prompt:
      'Create a permission set (or update an existing one) that grants my support team read access to the Case Subject, Status, and Priority fields, and read-write access to the Case Comment field \u2014 while keeping access to internal notes and account financial fields restricted. Before finalizing, show me the current field-level security on those fields so we don\u2019t accidentally widen access on a field that is already readable by more people than intended. Edge cases: flag any field where the profile already grants broader access than the permission set (so the permission set change is a no-op or a hidden widening); keep the change additive \u2014 don\u2019t revoke anything on other fields; if a field doesn\u2019t exist or is spelled differently, tell me instead of guessing; confirm the permission set is assigned to the intended users and show the blast radius of the change.',
    tags: ['Permission set', 'FLS', 'Access'],
    difficulty: 'Starter',
    icon: Lock,
  },
  {
    id: 'custom-field',
    kind: 'change',
    title: 'Custom Field \u2014 Escalation Level',
    description:
      'Add a governed picklist field with defaults, validation, and safe values \u2014 ready for reports and automation.',
    prompt:
      'Add a custom picklist field called \u201cEscalation Level\u201d to the Case object with the values Standard, Priority, and Urgent, defaulting to Standard. Requirements: the API name should be Escalation_Level__c; the field should be visible on the case layout; it must be filterable in reports; make it optional (not required) so existing records don\u2019t break. Edge cases: if a field with that API name already exists, tell me and propose an alternative instead of failing; if the org uses record types, ensure the field is added to the right record types; choose sensible picklist ordering; don\u2019t make the field required; verify the field doesn\u2019t collide with a managed package field; show the blast radius before deploying.',
    tags: ['Picklist', 'Case', 'Field'],
    difficulty: 'Starter',
    icon: Tags,
  },
  {
    id: 'audit-summary',
    kind: 'change',
    title: 'Audit Trail Summary',
    description:
      'Summarize the recent governed change history \u2014 what changed, who approved it, and whether anything is flagged.',
    prompt:
      'Summarize my recent governed change history from the change records. I want to know: (1) how many changes were made in the last 30 days and their statuses; (2) what was deployed and by whom; (3) any changes that were refused and why; (4) the blast radius of the largest changes. Keep the summary concise and grouped, then offer to export the full audit log. Edge cases: if there are no records in the window, say so explicitly rather than implying an empty report is a problem; if some records are missing approver identity or signatures, flag those as incomplete evidence; don\u2019t show records from other users; keep the summary readable in chat \u2014 one line per change, grouped by status.',
    tags: ['Governance', 'Summary', 'Export'],
    difficulty: 'Starter',
    icon: ScrollText,
  },
  {
    id: 'sensitive-restriction',
    kind: 'change',
    title: 'Sensitive Data Restriction',
    description:
      'Lock down PII and financial fields to the smallest group that needs them, with a full access audit first.',
    prompt:
      'Restrict access to sensitive fields (e.g. Account Number, SSN/National ID, Bank Details, and any field marked as containing personally identifiable information) so that only the Finance and HR permission sets can read them. Before making the change, audit who currently has access to these fields \u2014 show me the profiles and permission sets that can read them today \u2014 so we understand the blast radius. Edge cases: use field-level security, not record sharing, to keep the restriction tight; don\u2019t touch fields that are required by managed packages or installed apps without calling them out; if restricting breaks a running flow or automation that reads the field, flag it; keep the change reversible and additive where possible; after the change, verify that users outside Finance and HR no longer see the fields, and report what was changed.',
    tags: ['PII', 'FLS', 'Compliance'],
    difficulty: 'Advanced',
    icon: EyeOff,
  },
  {
    id: 'formula-field',
    kind: 'change',
    title: 'Formula Field \u2014 Days Open',
    description:
      'A governed formula field that computes days open on a case, with null-safe syntax and layout placement.',
    prompt:
      'Add a formula field called \u201cDays Open\u201d (API name Days_Open__c) to the Case object that computes the number of days a case has been open, using a null-safe formula such as IF(ISBLANK(ClosedDate), TODAY() - DATEVALUE(CreatedDate), DATEVALUE(ClosedDate) - DATEVALUE(CreatedDate)). Requirements: the formula must be syntactically valid Salesforce formula syntax; it should return a number; place the field on the case layout in the Details section; make sure it is filterable in reports. Edge cases to handle explicitly: if a field with that API name already exists, tell me and propose an alternative instead of failing; the formula must handle null CreatedDate and ClosedDate without erroring (ISBLANK guards); if the org uses record types, add the field to the layouts that matter; don\u2019t make the field required or unique \u2014 formula fields have restrictions, so call out what they are; show the blast radius and a dry run before deploying.',
    tags: ['Formula', 'Case', 'Field'],
    difficulty: 'Intermediate',
    icon: Sigma,
  },
  {
    id: 'auditor-permission-set',
    kind: 'change',
    title: 'Read-Only Auditor Permission Set',
    description:
      'A minimal, read-only permission set for auditors \u2014 objects and FLS without any edit or delete rights.',
    prompt:
      'Create a new permission set called \u201cAuditor Read-Only\u201d that grants read-only access to the Account, Contact, Opportunity, and Case objects. Requirements: the permission set must grant read access only \u2014 no create, edit, or delete on any object; keep field-level security read-only as well; the permission set should be assigned to the two auditors I specify. Edge cases to handle explicitly: verify the object permissions don\u2019t accidentally include \u201cView All Data\u201d or \u201cModify All Data\u201d \u2014 those bypass sharing and must not be granted; check whether these objects have record types and confirm the read access covers them; if the auditors already have a permission set with broader access, flag the overlap and don\u2019t silently widen anything; don\u2019t touch any existing permission sets or profiles; after creation, show the blast radius and confirm the assignment before deploying.',
    tags: ['Permission set', 'Read-only', 'Audit'],
    difficulty: 'Starter',
    icon: KeyRound,
  },
  {
    id: 'page-layout-update',
    kind: 'change',
    title: 'Page Layout Update \u2014 Case Details',
    description:
      'Add fields to the Case layout in the right section, respecting record types and existing visibility.',
    prompt:
      'Update the Case layout to add the Escalation Level field and the Days Open field to the Details section, visible and editable for the standard Case layout. Requirements: place the fields in a sensible order after Status and Priority; they should be visible to the support profile and editable where appropriate (Escalation Level editable, Days Open read-only since it is a formula). Edge cases to handle explicitly: if the org has multiple Case record types with separate layouts, confirm which layouts need the fields and apply the change to all that matter; if a field is already on the layout, don\u2019t duplicate it; check field-level security first \u2014 if the support profile lacks read on a field, the layout change alone won\u2019t make it visible, so flag that; don\u2019t remove, reorder, or otherwise disturb existing layout sections; show the blast radius before deploying.',
    tags: ['Layout', 'Case', 'Visibility'],
    difficulty: 'Starter',
    icon: LayoutGrid,
  },
  {
    id: 'unblock-refusal',
    kind: 'change',
    title: 'Unblock a Refused Change',
    description:
      'Explain why a governed change was refused and walk through the exact evidence needed to retry it cleanly.',
    prompt:
      'Help me unblock the most recent refused change in my org. Find the refusal record and explain in plain language: (1) which gate refused it and why; (2) exactly what evidence or condition is missing; (3) the specific fix (for example, add an approver identity, provide a business rationale, or adjust the intent). Then guide me through re-requesting the change correctly. Edge cases to handle explicitly: if there are multiple refusals, summarize them by gate code first so I can prioritize; if the missing evidence isn\u2019t something I can provide (for example it requires another user\u2019s approval), tell me who needs to act and what they should do; don\u2019t re-submit the change without my explicit confirmation; when retrying, preserve the original intent and add only what was missing rather than rewriting the request; if the refusal reason references a system or policy I should know about, explain it in plain language; if there are no refusals, say so clearly.',
    tags: ['Refusal', 'Gates', 'Unblock'],
    difficulty: 'Intermediate',
    icon: Unlock,
  },
];


