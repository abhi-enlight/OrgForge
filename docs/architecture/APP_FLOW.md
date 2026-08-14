# Forge — Application Flow

End-to-end user journeys and page flows for the unified app. Mirrors `unification_plan.md` §6/§12 with the implemented reality (`frontend` routes + `api` SSE flow).

**Docs set (one product):** [`unification_plan.md`](./unification_plan.md) (design) · [`DECISIONS.md`](./DECISIONS.md) (decisions) · [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (tracker) · [`api_contract.md`](./api_contract.md) (frozen API) · [`PRD.md`](./PRD.md) (requirements) · [`API.md`](./API.md) (reference) · [`TECH_STACK.md`](./TECH_STACK.md) (stack) · [`DESIGN.md`](./DESIGN.md) (design system) · [`PHASE5_PLAN.md`](./PHASE5_PLAN.md) (phase 5) · [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (audit) · legacy PRDs ([`OrgForge`](./legacy/OrgForge_PRD.md) · [`Agentforge`](./legacy/Agentforge_PRD.md))

---

## 1. High-level journey

```
Landing (/) ──► Sign in (/login) ──► [Connect Salesforce] ──► [GitHub?] ──► Dashboard
                                                                    │
                                              ┌─────────────────────┘
                                              ▼
                                   App shell (Header + Sidebar)
        ┌────────────┬────────────┬────────────┬──────────────┬────────────┐
        ▼            ▼            ▼            ▼              ▼            ▼
   Dashboard    Copilot      Agents      Changes & Audit   Settings    Workspace
   (/dashboard) (/chat)     (/agents)      (/changes)     (/settings)  (/workspace)
   calm home    primary     read-only     read-only       3 tabs      Advanced view
   + Ask Forge  work        list + YAML   + audit + CSV   (Connections/ (10-stage
                              drawer      + refusal log   Integrations/ stepper)
                                                          Advanced)
```

**Design rule (plan §6.0, "not too much"):** one primary action per screen, two levels of depth max, copilot-first, one-sentence captions, calm status (banner, never a modal wall). Everything deeper than the happy path hides behind explicit "Advanced" affordances.

---

## 2. Onboarding (3 steps)

```
Step 1  Sign in (Supabase Auth via @supabase/ssr)      /login
          │  Server-side session refresh via middleware.ts + AuthGate.tsx client listener
          ▼
Step 2  Connect Salesforce  ──► OAuth PKCE ──► callback
        [Production | Sandbox | Scratch]
          │  connect-first: background diagnostics start immediately
          │  (no manual install-first gate — replaced OrgForge's friction)
          │
          ▼
Step 3  "Connect GitHub audit log (optional)?"
        [Connect] ──► GitHub App install ──► repo picker ──► /settings?github=install
        [Skip]    ──► dismissed; one click away in Settings → Integrations
          │
          ▼
      Dashboard
```

- **Authentication Infrastructure:** Session security is enforced server-side using `@supabase/ssr`. `middleware.ts` refreshes auth tokens on every request and blocks unauthorized access to `/(app)` routes (`/chat`, `/agents`, `/changes`, `/dashboard`, `/settings`, `/workspace`), redirecting unauthenticated users to `/login?redirectTo=...`.
- **Legacy users:** one-time `POST /api/v1/auth/link-legacy` re-parents leftover Agentforge connections to the Supabase identity (best-effort; the OAuth flow is the guaranteed path).
- **Org pick correction (EC-13):** diagnostics auto-detect `Organization.IsSandbox` and fix a wrong Production/Sandbox/Scratch choice.
- **After connect** the dashboard collapses to: hero "Welcome back" + **Ask Forge** + a diagnostics banner if anything needs attention.

---

## 3. App shell

```
┌────────────────────────────────────────────────────────────────────┐
│ TOP BAR (sticky 65px)  [☰] F▢ FORGE ······ [org pill ▾] [avatar ▾] │
├──────────────┬─────────────────────────────────────────────────────┤
│ SIDEBAR 256px│                                                     │
│ ◆ Dashboard  │  <main>  bg-brand-surface/40, p-6 md:p-8           │
│ 💬 Copilot*  │                                                     │
│ 🤖 Agents    │                                                     │
│ 🛡 Changes    │                                                     │
│ ⚙ Settings   │                                                     │
└──────────────┴─────────────────────────────────────────────────────┘
   *Copilot carries a "Chat" badge — the primary destination.
```

- **Org pill** — global active-org context (React context + localStorage) shared by both engines; type-aware icon (Production ⚡ / Sandbox ☁ / Scratch 🧪); switching orgs **confirms first** and clears in-flight chat context (EC-25). The org list itself is owned by the shared `ActiveOrgProvider`: fetched at most once per tab session and restored from a sessionStorage cache on full page loads (refresh in the same tab does **not** re-fetch `/api/v1/orgs`); Settings pulls fresh via `refreshOrgs()` after connect/disconnect.
- **Avatar menu** — profile (email) + Sign out.
- **Mobile** — hamburger → slide-over drawer (`md:` static sticky sidebar; Escape/backdrop closes; focus-managed).
- **Org connections live in Settings + the pill** — deliberately not a top-level page (fewer items = simpler).

---

## 4. Dashboard (`/dashboard`)

```
┌────────────────────────────────────────────────────────────┐
│ Welcome back, {name}                    [Ask Forge ──►]    │  ← one hero action
├──────────────┬──────────────┬──────────────────────────────┤
│ 🤖 Agents    │ 🛡 Open       │ 📜 Audit trail              │  ← 3 clickable stat tiles
│  12 · 2h ago │ changes 4    │  last: "Validation rule      │     (deep-link to chat
│              │ 1 awaiting   │   added to Opportunity"      │      with pre-filled prompt)
├──────────────┴──────────────┴──────────────────────────────┤
│ ⚠ banner: "Connector package not installed"  [Install]     │  ← only when wrong (EC-14)
├────────────────────────────────────────────────────────────┤
│ Recent activity feed (reverse-chron, one ActivityCard      │
│ language for agent builds AND org change records)          │
└────────────────────────────────────────────────────────────┘
```

Empty states collapse the page to a single CTA: **Connect Salesforce** (no org) / **Ask Forge to build your first agent** (no agents) / **Request a governed change** (no changes).

---

## 5. Copilot (`/chat`) — the center of everything

### 5.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Copilot                          [Stop] [Stop & reset]       │
│                                  [Clear]  (idle only)        │
├──────────────────────────────────────────────────────────────┤
│  greeting bubble                                              │
│  message bubbles / OrgChangeCard / BuildProgressCard          │
│  (agent segments + org_change segments grouped per-capability)│
│  reset confirmation pill (after Stop & reset, 4s)             │
│  Thinking… (3 bouncing dots) while building                   │
├──────────────────────────────────────────────────────────────┤
│ [Auto/Agents/Org/Both chip]  ← capability pin (EC-22)        │
│ [📎 attach] [message input..............] [Send]             │
│   └ file chip (persistent, X to remove)                      │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 The send → stream flow

```
User hits Send
  │  startChat: clear attach error note; build request
  │  { message, orgId, capability? (pinned), sessionId?, file? }
  │  multipart FormData if a file is attached, else JSON
  ▼
POST /api/v1/chat/stream  (Bearer JWT, 180s timeout)
  │
  ├─ 400 pre-SSE ──► inline error (zod / attachment / allowlist)
  ├─ 401 ──► sign out → /login
  ├─ 404/401 credentials ──► "Reconnect this org…" (EC-10)
  ├─ 409 single-flight ──► "busy" error (escape hatch: Stop & reset)
  │
  ▼
SSE stream (unified envelope, \n\n-delimited, [DONE] terminator)
  │  frames parsed in a buffered reader (never killed by a bad frame)
  │  ┌ agent engine ──► build_widget / stream_chunk / deploy frames
  │  │                    rendered as BuildProgressCard steps
  │  ├ org_change engine ──► card frames (blast_radius → refusal_gates
  │  │                    → dry_run → deploy) rendered as OrgChangeCard
  │  └ both ──► agent frames → org_change-tagged handoff status
  │               → org frames (per-segment progress cards, EC-23)
  ▼
[DONE]  (or error frame; persistence failure → error frame, never blocks a deploy)
```

### 5.3 Capability chip

`Auto / Agents / Org Change / Both` — shows what the copilot believes the current turn is; clicking pins it (`pinned` in the request biases `routeIntent`, bypassing the classifier). The visible proof routing works and the manual escape hatch for mis-routes (EC-22). Disabled while building.

### 5.4 Attachments

- **Documents** (PDF/DOCX/TXT/MD): text extracted server-side, injected via SYSTEM-INJECTION (50k cap); routing + ai_logs keep the raw message.
- **Images** (PNG/JPEG/WebP): agent engine → Gemini `inlineData` parts; org-change engine → `describeImage` vision description injected the same way. Describe failure/empty → `deploy_warning` frame + degrade (warn-and-continue).
- 10MB cap, mime allowlist, memory storage; rejections → 400 pre-SSE with the file chip error. Attach error auto-dismisses after 4s; **the file chip stays persistent** (live state for the next send, X to remove).

### 5.5 The three conversation controls

| Control | When | What it does | Transcript |
|---|---|---|---|
| **Stop** | building | abort the in-flight stream (server aborts agent generation on disconnect) | kept |
| **Stop & reset** | building | Stop + `DELETE /api/v1/chat/:contextId` (wipes Redis busy-lock + persisted state — the crash-stuck 409 escape hatch) + rotate to fresh session id + confirmation pill | kept |
| **Clear** | idle only | full reset: wipe transcript + reset the old session server-side + rotate | cleared |

### 5.6 Scroll behavior

Auto-scroll to the latest frame; if the user scrolls up, pinning stops the auto-scroll; a "scroll to bottom" affordance appears.

### 5.7 Access gate (connector package)

Before the composer renders, the Copilot verifies the OrgForge Connector package is installed in the active org via the shared `OrgPackageHealthProvider` (layout-level — one check per org per page session, Redis-cached 10 min server-side; re-check on demand). While `status ≠ installed` a full-page `PackageRequiredGate` replaces the chat: `checking`/`idle` → "Checking org setup…" spinner · `missing` → 3-step install card (install link + copy for IT, grant user access, re-check) · `error` → reconnect/retry. The same gate covers `/agents` (§6.1); the dashboard surfaces the same condition as a non-blocking diagnostics banner instead (§7).

---

## 6. Supporting pages

### 6.1 Agents (`/agents`) — read-only list

`GET /api/v1/agents` → name, description, status, last deployed (cached server-side). Row action: **Open in chat to update** (deep-link with a starter prompt). Detail drawer shows the agent YAML.

Gated on the shared package-health state like the Copilot (§5.7): the page renders the `PackageRequiredGate` install card when the connector package is missing (the inventory route can't run without it), and the agents fetch is suppressed until the gate resolves so a re-check after installing loads fresh. When the package **is** installed but agent building is still unavailable (Agentforce/Einstein settings, Einstein license, provisioning), an amber readiness row names the exact blocker instead — the read-only list stays usable.

### 6.2 Changes & Audit (`/changes`)

Change records + refusal log (REF-01..10) + CSV export. "Request a change" deep-links to chat with a starter prompt. **Audit-status indicator (D8/EC-46):** "Audit records are committed to `<repo>`" when GitHub is connected, "saved locally (GitHub not connected)" when not. No fabricated commit hashes.

### 6.3 Settings (`/settings`) — 3 tabs

- **Connections** — org cards (alias, type, instance URL), re-index, disconnect, connect new (OAuth).
- **Integrations** — GitHub audit repo (install → repo picker; skip state allowed; the persistent audit-status indicator lives here too).
- **Advanced** — capabilities per org, diagnostics re-run, technical details, link to the legacy **Workspace** (10-stage stepper).

### 6.4 Workspace (`/workspace`) — the Advanced view

OrgForge's 10-stage operator flow kept **verbatim**: intent → requirements → metadata generation → blast radius → refusal gates → dry-run → deploy → backup/rollback → signed record. Linked from chat org-change cards and Settings → Advanced. Default users never see it.

---

## 7. Diagnostics flow (product-wide, EC-14)

```
Trigger: after connect · page load (stale) · POST /recheck
  │
  ▼
pre-flight (packages/diagnostics):
  instance URL (SSRF) → license (seats) → ECA package by
  SubscriberPackageId (EC-15) → provisioning (perm sets +
  find-or-create Einstein user, tolerate DUPLICATE_VALUE)
  → org-type detect/correct (EC-13) → capability split (EC-16)
  │
  ▼
forge.diagnostics (server-side 24h cache, promise dedup)
  │
  ├─ ok ─────────────────────────► banner hidden
  ├─ attention(missing_package) ─► banner "Install package" + re-check
  │     └ package.installed=false is NEVER pinned (Pass 22):
  │       row cleared → every read re-checks → self-heals after install
  │       (chat/agents additionally gate on package-health — §5.7)
  ├─ attention(license/provisioning/disconnected) ─► banner + one action
  └─ error ──────────────────────► banner + Retry

401/403 during token refresh ──► invalidate cache ──► next read re-checks fresh
```

---

## 8. State machines

**Chat/session:** `idle → building → streaming → done | aborted | reset`. Single-flight key `{user_id, org_id, session_id}` in Redis; 10-min lock TTL; `DELETE /chat/:contextId` is the unconditional escape hatch.

**Diagnostics:** `checking → ok | attention(missing_package | license_unsupported | provisioning | disconnected) | error`.

**Org connection:** `connected → refreshing (dedup) → disconnected_at on refresh failure (EC-10) → reconnected`.

---

## 9. Key user flows, end-to-end

1. **Build an agent** — chat "Build a support agent that routes by priority" → chip shows Agents → agent engine builds (progress cards) → deploy → success; agent appears on `/agents`; activity lands on Dashboard.
2. **Make a governed change** — chat "Add a validation rule to Opportunity" → chip shows Org Change → intent card → blast radius → refusal gates → dry-run → deploy → signed record; visible on `/changes`; audit committed to GitHub if connected.
3. **Both** — "Refactor my case agent and add a validation rule" → `both` → agent segment then org-change segment, one progress card each.
4. **Package missing** — connect → banner "Connector package not installed" → install → (no manual re-check needed) banner self-heals.
5. **Stuck build** — Stop & reset → confirmation pill → next message starts fresh on a clean session.
