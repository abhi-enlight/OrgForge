# OrgForge — Product Requirements Document (PRD)

**Product:** Enlight OrgForge ("OrgForge")
**Owner:** Enlight Lab
**Version:** v1.0 (unified product)
**Status:** Phases 1–4 code complete (backend **402/402** tests, `frontend` tsc/lint/build green); Phase 5 (canary/soak) pending
**Sources of truth:** [`unification_plan.md`](./unification_plan.md) (design), [`DECISIONS.md`](./DECISIONS.md) (locked decisions D1–D8), [`api_contract.md`](./api_contract.md) (frozen API surface), [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (legacy-PRD audit: OrgForge v1.0 + Agentforge v6.0).
**Docs set (one product):** [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (tracker) · [`API.md`](./API.md) (reference) · [`APP_FLOW.md`](./APP_FLOW.md) (flows) · [`TECH_STACK.md`](./TECH_STACK.md) (stack) · [`DESIGN.md`](./DESIGN.md) (design system) · [`PHASE5_PLAN.md`](./PHASE5_PLAN.md) (phase 5) · [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (audit) · legacy PRDs ([`OrgForge`](./legacy/OrgForge_PRD.md) · [`Agentforge`](./legacy/Agentforge_PRD.md))

---

## 1. Product summary

> **One conversational copilot for the whole Salesforce org.** Ask OrgForge to *"list all my agents"* and it reaches into Agentforce. Ask it to *"modify an Account layout"* and it opens a governed, refusal-gated change workflow. Building AI agents and safely changing the org are two skills of the **same assistant** — never two websites.

OrgForge is the unification of two sibling products:

| Legacy product | What it did | Role inside OrgForge |
|---|---|---|
| **Agentforge** (v6.4) | Build, deploy, and test Salesforce Agentforce agents from natural language | the **Agents** capability |
| **OrgForge** (v1.0) | Governed, refusal-gated, fully-documented Salesforce org customization | the **Org Changes** capability |

Both shared ~80% of their plumbing (Gemini AI, SSE streaming, OAuth to Salesforce, AES-GCM encrypted tokens, the same Supabase project). OrgForge merges them into **one frontend, one API, one auth system, one org-connection store, and one chat** that routes each request to the right engine without the user ever sensing two products.

### 1.1 One-liner by role

- **Salesforce admin / architect** — "Build me a support agent," "List my agents," iterate and deploy from chat.
- **Release / change manager** — governed changes with refusal gates, approvals, signed audit trail.
- **DevOps / platform engineer** — org connections, indexing health, GitHub audit integration.
- **Exec / reviewer** — read-only overview: agent count, open changes, risk posture.

---

## 2. Problem statement

1. **Two products, one job.** A Salesforce team today juggles two websites, two logins, two sets of credentials, and two mental models for what is fundamentally one job: *changing the org.*
2. **Agentforge friction:** custom JWT auth (weaker than Supabase), in-memory conversation state (lost on restart), and no org-governance story.
3. **OrgForge friction:** a manual *"install the connector package first"* gate blocks onboarding; package health is checked late, with a tri-state chip, and doesn't self-heal.
4. **Divergent plumbing:** different schemas (`public` vs `orgforge.*`) in the **same** Supabase project, different AI clients, different streaming envelopes — duplicated maintenance and security surface.

### 2.1 Non-goals (v1)

- No new AI engines — the two legacy engines are ported as capability plugins, not rewritten.
- No cross-project data movement — a single-schema unification inside the existing Supabase project.
- No breaking of existing customers — additive-only API contract until Phase 5 sign-off; legacy URLs never 404 during the transition (D5).
- No re-encryption of legacy tokens — one-time org re-connect instead (D4).
- GitHub remains **optional** — never a blocker (D8).

---

## 3. Goals & success metrics

### 3.1 Product goals

| # | Goal | Evidence in v1 |
|---|---|---|
| G1 | **One product feel** — no "two websites" sensation | Single AppShell, one chat, one sidebar (5 items), one design token set |
| G2 | **Connect-first onboarding** — Salesforce connect is one click; everything else is background | 3-step onboarding; no install-first gate (replaces OrgForge's manual gate) |
| G3 | **Copilot-first work** — agent building and org changes both happen in chat | Starter prompts, capability chip, inline org-change cards, no duplicated forms |
| G4 | **Self-healing diagnostics** — package/license/provisioning problems surface as one calm banner with one action | Server-side pre-flight (24h cache) + EC-14 auto-invalidate/re-check; banner, never a modal wall |
| G5 | **No breakage** — existing consumers keep working through the transition | Frozen additive contract (`api_contract.md`), transition aliases `/api/auth` + `/api/org`, legacy apps stay deployed until Phase 5 |

### 3.2 Success metrics (post-launch)

- Onboarding completion: % of signed-in users who connect a Salesforce org within one session (target: ≥ 90%, connect-first removes the gate).
- Time-to-first-agent and time-to-first-governed-change (from connect).
- % of change requests resolved in chat without opening the Advanced workspace.
- Diagnostics self-heal rate: package-missing verdicts that clear without a manual re-check.
- Mis-routing rate of the intent classifier (capability chip = the manual escape hatch, EC-22).
- Regression baseline: backend suite **402/402**, OrgForge Playwright e2e **3/3**, `frontend` tsc/lint/build clean.

---

## 4. Personas & core scenarios

| Persona | Primary surface | Scenario |
|---|---|---|
| **Salesforce Admin / Architect** | Chat + Agents | "Build a support agent that routes by case priority" → agent engine builds + deploys Agentforce agent; iterate in chat; manage in read-only Agents list |
| **Release / Change manager** | Dashboard + Changes & Audit | "Add a validation rule to Opportunity" → org-change engine: intent → blast radius → refusal gates → dry-run → deploy → signed record; audit trail on Changes & Audit |
| **DevOps / Platform eng** | Dashboard + Settings | Connect orgs, watch indexing health, wire the GitHub audit repo |
| **Exec / reviewer** | Dashboard | Agent count, open changes, recent activity — read-only, calm |

**The two headline flows** (both in the same chat input):

1. *Agent build:* natural language → capability `agent` → Agentforge ConversationManager (Gemini + ~24 Salesforce tools, ReAct loop) → build progress cards → deploy → test.
2. *Governed change:* natural language → capability `org_change` → intent pipeline → refusal gates (REF-01..10) → dry-run → deploy → HMAC-signed change record → audit.

When a request spans both, capability `both` runs agent → org sequentially with per-segment progress cards (EC-23).

---

## 5. Feature requirements

### FR-1 Onboarding (3 steps)

| Step | Surface | Requirement |
|---|---|---|
| 1. Sign in | `/login` | Supabase auth; production uses **httpOnly, SameSite=Lax, Secure cookies** (D2); dev may use localStorage for parity |
| 2. Connect Salesforce | `/login?step=2` | OAuth PKCE; pick Production / Sandbox / Scratch; **connect-first** — background pre-flight starts immediately; **no install-first gate** |
| 3. (Optional) GitHub audit | `/login?step=3` | "Connect GitHub audit log?" with **[Connect] [Skip]**; one-click App install + repo picker; skippable without punishment (D8); hidden if the App isn't configured server-side (EC-44) |
| Legacy re-link | `POST /api/v1/auth/link-legacy` | One-time convenience for leftover Agentforge JWTs; **best-effort, never a blocker** (EC-02/EC-38); the guaranteed path is the one OAuth flow |

### FR-2 Global shell

- Sticky top bar: **ORGFORGE** wordmark, live **org pill** (type-aware: Production/Sandbox/Scratch; global switcher with confirm on switch — EC-25), avatar menu (profile, sign out).
- Sidebar, 5 items: **Dashboard · Copilot · Agents · Changes & Audit · Settings**. Org connections live in Settings + the org pill — not a top-level page.
- Mobile: hamburger → slide-over drawer (Escape / backdrop close).

### FR-3 Dashboard (the calm home)

- One hero action: **Ask OrgForge** (deep-links to chat).
- Three clickable stat tiles → **Agents** (count + last deployed), **Open changes** (count + awaiting approval), **Audit trail** (recent record). Each deep-links into chat with a pre-filled prompt.
- **One attention banner**, only when something is wrong (package missing / license unsupported / disconnected / indexing stale), with exactly one action.
- One reverse-chronological **recent activity feed** (agent builds + org change records share one visual language).
- Empty states collapse the page to a single CTA ("Connect Salesforce" / "Ask OrgForge to build your first agent" / "Request a governed change").

### FR-4 Copilot (chat) — the center of everything

- SSE stream over `POST /api/v1/chat/stream` with the unified envelope (see API.md).
- **Starter prompts** when empty: "Build a support agent", "List my agents", "Add a validation rule to Opportunity", "Show recent changes".
- **Capability chip** above the input: `Auto / Agents / Org Change / Both` — shows what the copilot believes the current turn is; clickable to pin/override (the visible proof routing works + manual escape hatch, EC-22).
- **Inline cards** for org-change flow inside the chat (intent → artifact → blast radius → refusal gates → dry-run → deploy → signed record); no page jump on the happy path. "Open in advanced view" link → 10-stage Workspace.
- **Per-segment progress cards** — `both` runs render one labeled card per capability, tagged by `capability` in the SSE envelope (EC-23).
- **File attach** (legacy parity): PDF/DOCX/TXT/MD (text injected via SYSTEM-INJECTION, 50k cap) + **images** PNG/JPEG/WebP (agent engine: Gemini `inlineData` parts; org engine: `describeImage` vision description). 10MB cap; errors → 400 pre-SSE; describe failure → `deploy_warning` + degrade (Pass 21).
- **Conversation controls**, three distinct actions:
  - **Stop** — abort the run, keep the conversation.
  - **Stop & reset** — abort + `DELETE /api/v1/chat/:contextId` (wipes the Redis busy-lock + persisted state — the crash-stuck 409 escape hatch) + rotate to a fresh session; **keeps the transcript**; shows a brief confirmation pill ("Conversation reset — next message starts fresh.").
  - **Clear** (idle-only) — full reset: wipes the transcript and resets the old session server-side before rotating.
- **Thinking…** indicator during builds; auto-scroll with scroll-up pinning.

### FR-5 Supporting pages

- **Agents** (`/agents`) — read-only list from `GET /api/v1/agents` (name, description, status), cached server-side, SSRF-guarded; "Open in chat to update" per row; detail drawer with YAML.
- **Changes & Audit** (`/changes`) — change records + refusal log + CSV export; "Request a change" deep-links to chat.
- **Settings** (`/settings`) — three tabs: **Connections** (org cards, re-index, disconnect, connect new), **Integrations** (GitHub audit repo; skip state allowed; persistent "Audit records are committed to `<repo>`" vs "saved locally" indicator — D8/EC-46), **Advanced** (capabilities per org, diagnostics re-run, technical details, link to the legacy 10-stage workspace).
- **Workspace** (`/workspace`) — OrgForge's 10-stage stepper kept **verbatim as the Advanced view**.

### FR-6 Diagnostics (the org-health brain, product-wide)

- One pre-flight used by onboarding, dashboard, chat, and agents (port of Agentforge's `runPreFlightCheck`):
  1. Validate instance URL (https + allowlist — SSRF guard)
  2. Einstein Agent license availability (seats)
  3. ECA package installed **by SubscriberPackageId** (any version counts, EC-15)
  4. Provisioning: discover permission sets (dynamic + fallback), find-or-create the Einstein Agent user, assign permission sets, tolerate `DUPLICATE_VALUE`
  5. Org-type detection (auto-correct wrong pick, EC-13)
  6. **Capability split** — `agents` needs license+package+provisioning; `org_change` needs package + valid token only (EC-16)
- Server-side 24h cache (`forge.diagnostics`) with promise dedup; `POST /recheck` bypasses.
- **EC-14 auto-invalidation, both halves:** (a) 401/403 during token refresh → cache invalidated, next read re-checks; (b) a run detecting `package.installed=false` is **never pinned** — cache cleared, reads self-heal after install (Pass 22).
- State machine: `checking → ok | attention(missing_package | license_unsupported | provisioning | disconnected) | error`; always rendered as one banner (one exception: the package-missing modal with install link + re-check).

### FR-7 Auth & security (must-haves)

- Supabase JWT bearer on every API call; `requireAuth` + `tenantIsolation` (every query passes the verified user id explicitly — **RLS is never a backstop** on service-role clients).
- Public endpoints only: `/health`, `/health/db`, both OAuth callbacks.
- AES-256-GCM encrypted Salesforce tokens under a single `ENCRYPTION_KEY` (D4); per-org refresh dedup; refresh failure → `401 "Reconnect this org…"` + `disconnected_at` (EC-10).
- Sanitized JSON errors (no stacks, no internals); zod validation everywhere; SSRF guards on instance URLs; multer mime allowlist; HMAC-signed change records. (OrgForge's legacy rate-limit tiers — global/auth/AI — ship with the mounted capability routers; not re-implemented in the unified API core.)

---

## 6. Edge cases (the "don't break" catalogue — shipped)

| EC | Case | Behavior |
|---|---|---|
| EC-14 | ECA package deleted/uninstalled after connect | Diagnostics detect by SubscriberPackageId → banner "Connector package not installed" + install link + re-check; **never pinned** — self-heals after install (Pass 22); org-change capability gated; nothing else 500s |
| EC-10/11 | Token refresh fails (revoked/expired) | Per-org refresh dedup; failure → 401 "Reconnect this org"; `disconnected_at`; diagnostics cache invalidated so next read re-checks |
| EC-22/23 | Classifier mis-route / both-capability handoff | Capability chip = manual override; `both` runs agent → org with per-segment progress cards |
| EC-25 | Switching active org | Confirmed first; in-flight chat context cleared; session rotates |
| EC-13 | Wrong org type picked | Auto-detected from `Organization.IsSandbox` and corrected |
| EC-15 | Package version check | By SubscriberPackageId — any installed version counts (handles upgrades) |
| EC-16 | No Agentforce license | Blocks agent work only; org changes still work |
| EC-44/45/46 | GitHub App not configured / claim expired / no repos | Card hidden / "start again" / explain how to grant access; audit-status indicator always visible |
| Single-flight | Busy agent session | 409 pre-SSE; keyed `{user_id, org_id, session_id}` in Redis; crash-stuck lock cleared via `DELETE /chat/:contextId` (10-min lock TTL escape hatch) |

---

## 7. Release plan

| Phase | Scope | Status |
|---|---|---|
| 0 | Planning + decisions (D1–D8) + frozen API contract | ✅ |
| 1 | Health endpoints, Supabase JWT auth, tenant isolation, workspace scaffold | ✅ |
| 2 | Redis conversation state + unified `ai_logs` writer | ✅ |
| 3 | Diagnostics cache + EC-14 invalidation (code side); **migration 008 pending via Supabase MCP (user step)** | ✅ code / ⏳ S-2 |
| 4 | File attach, image attachments, per-segment cards, Stop & reset, conversation reset, EC-14 package auto-recheck | ✅ |
| 5 | Canary flag rollout, soak (internal team + 2 friendly customers), legacy alias retirement, 301s | ⏳ |
| Supabase | Migrations 008/010 applied via MCP; 011 (RLS) drafted when Phase 3 data work starts | 🔷 user steps |

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `full` OAuth scope on the unified ECA | D3: keep for v1, verify trim path in a sandbox, trim in a later release only if provisioning holds |
| Unification regressions | Frozen additive contract, legacy apps stay deployed (D5), Playwright e2e baseline 3/3, 402 unit tests |
| Diagnostics false negatives ("missing package" when installed) | SubscriberPackageId (any version) + fallback query + manual re-check; banner copy explains lag |
| XSS via `localStorage.auth_token` | D2: httpOnly Secure cookies in production |
| Mis-routed intents | Gemini + deterministic overrides + capability chip manual pin + routing_log audit |
