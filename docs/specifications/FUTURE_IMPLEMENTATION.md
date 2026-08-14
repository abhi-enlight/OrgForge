# Forge — Future Implementation

> **Purpose:** index of work scheduled for the **next version (Phase 6+)** — the
> things the current version intentionally does not ship. Every item links to a
> self-contained plan (any agent with zero context can execute it) or to the
> tracker where it is recorded. Items are added here when they are scoped, not
> when they are merely imagined.
>
> **Trackers:** [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (current
> version master plan) · [`tasks/todo.md`](../../tasks/todo.md) +
> [`tasks/remaining_tasks.md`](../../tasks/remaining_tasks.md) (pass trackers) ·
> [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (requirements traceability).
>
> **Status legend:** 🟡 planned (scoped, not started) · 🟠 in progress ·
> 🟢 done · 🔷 SUPABASE TASK (applied later via Supabase MCP).

---

## Index

| # | Item | Status | Pointer |
|---|------|--------|---------|
| F-1 | **Dry-run auto-repair + honest limitation widget** — a failed check-only Metadata API deploy is auto-repaired by a bounded AI loop (max 2 attempts) or the agent states *why it can't* (schema-blindness, dependency ordering, human data decisions, org constraints) in a chat widget/toast + workspace "Repair with AI" flow | 🟡 planned | [`DRY_RUN_AUTO_REPAIR.md`](./DRY_RUN_AUTO_REPAIR.md) |
| F-2 | **change_records `kind` + agent-deploy snapshot** (EC-37): extend change records to agent deploys (`kind: 'org_change' | 'agent_deploy'`, pre-deploy YAML/Apex snapshot columns) so agent builds get the same signed-record audit trail as org changes | 🟢 code done 2026-08-14 (migration 014 drafted; agent engine writes a signed record on deploy_success; Changes page shows the kind badge) — 🔷 apply migration 014 via MCP | `supabase/migrations/014_change_records_agent_kind.sql` |
| F-3 | **EC-35 serialize + queue when both capabilities touch the same metadata** — a `both` run whose agent half and org half edit overlapping metadata must serialize instead of racing | 🟡 planned | `docs/architecture/unification_plan.md` |
| F-4 | **Live-agent e2e against a real sandbox** — the org pipeline's 7 chat stages (build → gates → dry-run → deploy → signed record) executed end-to-end through `POST /api/v1/chat/stream` | 🟡 planned (blocked: real sandbox + Supabase user) | `tasks/remaining_tasks.md` (P2) + `docs/operations/PHASE5_PLAN.md` |
| F-5 | ~~**EC-39 legacy read-only display mode** — legacy apps point reads at `forge.*` views with a "continue in Forge" banner~~ — **closed (2026-08-14)**: the legacy apps were decommissioned, so there is nothing to point at views | ~~🟡 planned~~ **moot** | `IMPLEMENTATION_PLAN.md` §3 |
| F-6 | **P2 schema grounding for dry-run repairs** — best-effort live org-schema fetch into the repair prompt so `needs_schema` cases ("No such column…") are resolved or stated precisely; degrade to the honest reason when the fetch fails | 🟡 planned (stretch, part of F-1) | [`DRY_RUN_AUTO_REPAIR.md`](./DRY_RUN_AUTO_REPAIR.md) §2.2 / §6 |

---

## F-1 — Dry-run auto-repair + honest limitation widget (flagship)

**The question it answers:** when the agent runs a check-only Metadata API
deploy (the dry run) and Salesforce reports a schema error or schema change,
can the agent fix it?

**Short answer (current version):** no — a dry-run failure is a dead end in
both the chat (`orgEngine.js` step 5 stops with "Org change dry run failed.")
and the workspace (`DryRunPanel` retries the identical broken artifacts). Two
latent gaps make it worse: the chat card maps `status.errors ??
status.errorMessage` while the real MDAPI returns `componentFailures` (so the
failed card shows **zero errors** in production), and chat dry-run failures
never reach `forge.ai_logs`.

**Next version:** a bounded repair loop (classify → regenerate with the MDAPI
errors as context → validate locally → re-run check-only, max 2 attempts)
fixes "simple" issues (malformed XML, `Text Area` → `TextArea` type drift,
formula syntax). What can't be fixed is stated honestly via a limitation
taxonomy — `needs_schema` / `dependency` / `human_decision` /
`org_constraint` / `unsupported` — surfaced in an in-card chat widget (+
toast) and a workspace "Repair with AI" flow. Every repair stays inside the
signed audit record and never silently weakens a rule.

**Plan:** [`DRY_RUN_AUTO_REPAIR.md`](./DRY_RUN_AUTO_REPAIR.md) — fully
self-contained (backend service, engine loop, endpoint, chat widget, workspace
panel, tests, sequencing P0 → P1 → P2).

---

## How work lands here

1. An idea is scoped into a **self-contained plan** (repo convention:
   numbered/executable docs — see `DRY_RUN_AUTO_REPAIR.md` and
   `docs/operations/` for the pattern).
2. A row is added to the **Index** above with a status.
3. Tracker entries are added to `tasks/todo.md` (priority section) and
   `tasks/remaining_tasks.md` (Remaining Tasks section) pointing at the plan.
4. When implementation starts, the row flips 🟠 → 🟢 and the pass is recorded
   in the trackers per the `OrgForge/tasks/` convention.
