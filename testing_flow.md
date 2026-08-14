# OrgForge End-to-End Testing Flow & Environment Audit

Comprehensive system audit, live Salesforce metadata inventory, GitHub App audit integration specifications, logging architecture, and step-by-step browser testing walkthrough.

---

## 1. Connected Salesforce Accounts Overview

The Salesforce CLI (`sf`) environment has 3 active connected orgs. The primary org hosting your live Agentforce agents and custom data objects is **Enlight Lab** (`OrgForgeDevHub`):

| Org Name | Alias | Username | Org ID | Instance URL | Type / Edition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Enlight Lab** *(Primary)* | `OrgForgeDevHub` | `dj.93246cca96a8@agentforce.com` | `00Dfj00000VmuUHEAZ` | `https://orgfarm-d399c5e51a-dev-ed.develop.my.salesforce.com` | DevHub / Developer Edition (API v67.0) |
| **Enlight Labs** *(Secondary)* | `abhi.dev` | `abhinav.a46686e24f56@agentforce.com` | `00DgK00000S2h2LUAR` | `https://orgfarm-5ee38b8cd1-dev-ed.develop.my.salesforce.com` | Developer Edition (API v67.0) |
| **OrgForge Test** *(Scratch)* | `orgforge-test` | `test-fn1zfv9z2oso@example.com` | `00Ddq00000EvRmpEAF` | `https://energy-dream-7677-dev-ed.scratch.my.salesforce.com` | Active Scratch Org (Tracks Source) |

---

## 2. Live Agentforce Agents Inventory

### Primary Org: `OrgForgeDevHub` (`00Dfj00000VmuUHEAZ`)
Extracted live from Salesforce via `AiAuthoringBundle` Metadata API:

### 1. `Security_Compliance_Agent_1`
* **Master Label / Role:** IT Security Officer
* **Target Custom Object:** `Security_Incident__c`
* **Welcome Message:** *"Greetings. I am the Security Compliance Agent. I can help you complete your annual phishing training or report a suspicious email. How can I help?"*
* **Core Workflows:**
  1. Monitor access logs and flag suspicious activities.
  2. Walk employees through mandatory security training modules.
  3. Assist employees with logging and escalating security incidents.
* **Strict Guardrails & Directives:**
  - **Identity & Access:** NEVER reset passwords without prior identity verification. NEVER bypass Role-Based Access Control (RBAC) permissions. DO NOT generate fake temporary passwords.
  - **Data Privacy:** NEVER expose employee information to unauthorized users.
  - **Escalation Protocol:** If identity verification fails 3 consecutive times, STOP and escalate to human support immediately. Escalate all Priority 1 (P1) incidents immediately.

---

### 2. `Ticket_Triage_Router_1`
* **Master Label / Role:** Support Triage Coordinator
* **Target Custom Object:** `Support_Ticket__c`
* **Greeting:** *"Hello! I am the Triage Agent. Describe the bug or feature request in detail, and I will ensure it reaches the right development team."*
* **Core Workflows:**
  1. **Issue Analysis:** Ingest user bug or feature description; ask 1–2 clarifying questions if ambiguous.
  2. **Severity Categorization:** Assign Priority: `P1` (System Outage/Critical), `P2` (Major Feature Broken), `P3` (Minor Bug/Workaround Exists), `P4` (Feature Request/Cosmetic).
  3. **Routing:** Route to the appropriate engineering or business team (`frontend`, `backend`, `billing`, `security`, `Product Management`).

---

### 3. `Recruiting_Screener_Agent_1`
* **Master Label / Role:** Talent Acquisition Coordinator
* **Target Custom Object:** `Job_Application__c`
* **Greeting:** *"Hi! Thanks for applying for the Senior Engineer position. I just have a few quick questions about your background to get us started. Are you ready?"*
* **Core Workflows:**
  1. Conduct structured initial text screening interviews.
  2. Verify essential criteria: right to work/visa status, willingness to relocate, salary expectations, notice period.
  3. Schedule qualified candidates for technical interviews with hiring managers.

---

### 4. `Expense_Processing_Agent_1`
* **Master Label / Role:** Corporate Expense & Finance Auditor
* **Target Custom Object:** `Expense_Report__c`
* **Greeting:** *"Hi! I can help you submit and track your expense reports. Do you have a receipt you would like to upload or expense details to provide?"*
* **Core Workflows:**
  1. Parse receipt items, transaction dates, and merchant names.
  2. Validate amounts against corporate category caps (Meals, Travel, Software, Hardware).
  3. Fast-track compliant expense approvals; flag non-compliant line items with policy violation reasons.

---

### 5. `Contract_Renewal_Specialist_1`
* **Master Label / Role:** Account Renewal Manager
* **Target Custom Object:** `Contract_Renewal__c`
* **Greeting:** *"Hello! Your annual subscription is coming up for renewal next month. I am here to help you review your current plan and explore options. Shall we get started?"*
* **Core Workflows:**
  1. Ingest upcoming contract expirations within 60 days.
  2. Evaluate customer license utilization percentage and support ticket volume (`Tickets_Resolved__c`).
  3. Propose optimal contract tier upgrades and renewal incentives.

---

## 3. Custom SObjects & Field Schema Inventory

### Primary Org: `OrgForgeDevHub` (`00Dfj00000VmuUHEAZ`)

| SObject API Name | Live Count | Schema & Field Breakdown |
| :--- | :--- | :--- |
| **`Support_Ticket__c`** | 0 records | • `Client_Name__c` (Text 255)<br>• `Issue_Description__c` (Text 255)<br>• `Status__c` (Text 255)<br>• `Type__c` (Text 255)<br>• `Description__c` (Text 255)<br>• `Issue_Type__c` (Text 255)<br>• `Priority__c` (Text 255)<br>• `Team__c` (Text 255) |
| **`Job_Application__c`** | 2 records | • `Candidate_Name__c` (Text 255)<br>• `Notice_Period__c` (Text 255)<br>• `Requires_Visa__c` (Text 255)<br>• `Salary_Expectation__c` (Number 18, 0)<br>• `Status__c` (Text 255) |
| **`Security_Incident__c`** | 2 records | • `Description__c` (Text 255)<br>• `Incident_Type__c` (Text 255)<br>• `Severity__c` (Text 255)<br>• `Status__c` (Text 255)<br>• `User_Email__c` (Text 255) |
| **`Contract_Renewal__c`** | 2 records | • `Client_Name__c` (Text 255)<br>• `Current_Tier__c` (Text 255)<br>• `Expiration_Date__c` (Date)<br>• `License_Count__c` (Number 18, 0)<br>• `Tickets_Resolved__c` (Number 18, 0)<br>• `Usage_Percentage__c` (Number 18, 2) |
| **`Expense_Report__c`** | 3 records | • `Amount__c` (Currency/Number 18, 2)<br>• `Category__c` (Text 255)<br>• `Merchant__c` (Text 255)<br>• `Status__c` (Text 255)<br>• `Transaction_Date__c` (Date) |

---

## 4. Integration, GitHub Audit & Logging Architecture

### A. Salesforce Integration Engine
* **OAuth Web Server Flow:** Connects orgs via OAuth 2.0 with AES-256 encrypted refresh tokens stored in database `org_connections`.
* **SSRF Guard:** Validates instance URLs against `https://*.salesforce.com` and `https://*.force.com` before any Tooling, REST, or SOAP call.
* **Permission Set Provisioning:** Automatically packages `Agentforge_Generated_Actions.permissionset` granting `viewAllRecords=true` and explicit object permissions for the Einstein Agent System User.
* **Safety Dry-Run:** Deploys via Metadata API v65.0 with `checkOnly=true` and `rollbackOnError=true` to validate changes prior to production execution.

### B. GitHub App Audit Pipeline
* **GitHub App ID:** `4469981` (App Slug: `orgforge-audit-logger`)
* **Connected Audit Repo:** `abhi-rai-001/Audit-logs` (Installation ID `153625812`)
* **Audit File Generation:** Automatically commits markdown audit records to `orgforge-changes/CR-<timestamp>.md`:
  ```markdown
  # OrgForge Change Record: CR-1786095859000
  ## Metadata
  - Timestamp: 2026-08-14T06:40:00.000Z
  - Change Set ID: CS-10294
  - Deployment ID: 0Af...
  - Approver Identity: abhi@gmail.com
  - Git Commit Hash: 9f8a3c...

  ## Business Context
  **Intent:** Add SLA tracking field to Support Tickets.
  **Business Rationale:** Track compliance for high-priority support issues.

  ## Governance Evidence
  - Blast Radius: LOW
  - Referencing Components: 0
  - Gate Results: 0 refused / 10 evaluated
  - Skills Used: platform-custom-field-generate, platform-apex-generate
  - Dry-Run ID: DRY-99482

  ## Tamper-Evident Verification
  **HMAC SHA-256 Signature:** `4e82b7...`
  ```

### C. Logging Architecture & Data Envelopes
1. **`orgforge.routing_log`:** Logs every prompt, intent (`agent`, `org_change`, `both`), prompt hash, execution latency, and readiness-gate overrides (`readiness_gate:settings_disabled`, `readiness_gate:package_missing`).
2. **`orgforge.ai_logs`:** Fire-and-forget telemetry across agent and org pipelines tracking prompt, AI response, tool calls, model version (`gemini-3.1-pro-preview`), and Salesforce errors.
3. **`orgforge.chat_sessions`:** Durable conversation storage preserving rolling compressed context summaries plus verbatim recent turns.
4. **`orgforge.change_records`:** Immutable table of signed deployments with HMAC signatures, gate results, and metadata artifacts.
5. **SSE Event Stream Protocol (`createSseEnvelope`):**
   ```json
   {
     "type": "status | message | action | deploy | deploy_success | error",
     "capability": "agent | org_change",
     "card": "blast_radius | refusal_gates | artifact | dry_run | deploy | record | gate_block",
     "summary": "Step summary",
     "content": "Detailed content..."
   }
   ```

---

## 5. End-to-End Browser Testing Walkthrough

Follow this step-by-step procedure in your browser ([http://localhost:3000](http://localhost:3000)):

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       BROWSER TESTING WORKFLOW                                              │
│                                                                                                             │
│  [1. Landing Page]  ──►  [2. Supabase Auth]  ──►  [3. Dashboard & Health]  ──►  [4. Copilot & Stream]      │
│         │                       │                         │                               │                 │
│         ▼                       ▼                         ▼                               ▼                 │
│  [8. Settings / GitHub] ◄── [7. Changes & Audit] ◄── [6. Advanced Workspace] ◄── [5. Agents Studio & YAML] │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Step 1: Landing Page (`/`)
1. Open `http://localhost:3000/`.
2. Verify aesthetic layout, hero typography, and animated components.
3. Click **"Launch Studio"** or **"Sign In"** $\rightarrow$ verify redirection to `/login`.

---

### Step 2: Supabase SSR Authentication (`/login`)
1. Sign in with your registered email (e.g. `abhi@gmail.com`).
2. Refresh the browser to confirm session cookie continuity via `@supabase/ssr`.
3. Confirm redirection to `/dashboard`.

---

### Step 3: Executive Dashboard (`/dashboard`)
1. Verify active org displays **`OrgForgeDevHub`** (`00Dfj00000VmuUHEAZ`).
2. Confirm the **Readiness Banner** displays:
   - `Agents Capability`: **Active** (5 live agents loaded)
   - `Org Change Engine`: **Ready**
3. Review metrics tiles: Active Changesets, Recent Deployments, and Live Agents.

---

### Step 4: Copilot Studio (`/chat`)
Test the 3 intent paths with live SSE streaming:

* **Test Case 1 (Agent Intent):**
  - **Prompt:** `"Show me the security guidelines and workflows for the Security Compliance Agent."`
  - **Verification:** Copilot routes to `agent`, streams response from Gemini, references `Security_Compliance_Agent_1`, and surfaces security guardrails.
* **Test Case 2 (Org Change Intent with 6 Inline Cards):**
  - **Prompt:** `"Create a new custom field SLA_Hours__c (Number 18, 0) on the Support_Ticket__c object."`
  - **Verification:**
    - Routes to `org_change`.
    - Renders **Blast Radius Card** (Low risk, target `Support_Ticket__c`).
    - Renders **Refusal Gates Card** (All passed).
    - Renders **Artifact Card** (Shows XML definition).
    - Renders **Dry-Run Card** (Validates with Salesforce Metadata API).
    - Renders **Deploy Card** and **Change Record Card** (with HMAC hash).
* **Test Case 3 (Dual Capability Intent):**
  - **Prompt:** `"Add a resolution SLA field to Support Tickets and update the Ticket Triage Router instructions to assign P1 tickets within 1 hour."`
  - **Verification:** Evaluates `both` capabilities; streams split cards for Org Change and Agent Spec update.
* **Interactive Controls:**
  - Test **Stop & Reset** button mid-generation.
  - Test **Clear Chat** button (rotates session ID).
  - Test attaching a screenshot or document.

---

### Step 5: Agents Studio & YAML Drawer (`/agents`)
1. Confirm grid lists all 5 agents:
   - `Security_Compliance_Agent_1`
   - `Ticket_Triage_Router_1`
   - `Recruiting_Screener_Agent_1`
   - `Expense_Processing_Agent_1`
   - `Contract_Renewal_Specialist_1`
2. Click **`Security_Compliance_Agent_1`**:
   - Right-side drawer slides in.
   - Fetches `.agent` YAML via `GET /api/v1/agents/Security_Compliance_Agent_1/yaml`.
   - Inspect instructions, guardrails, and role parameters.
3. Test **"Copy YAML"** button.
4. Test **"Edit in Chat"** button (navigates to `/chat` with pre-populated context).
5. Click **"Refresh Agents"** (bypasses cache with `?refresh=1` and retrieves fresh state).

---

### Step 6: Advanced Workspace (`/workspace`)
1. Inspect the 10-stage execution pipeline:
   `Intent → Scope → Impact → Gate Check → Gen Metadata → Gen Tests → Dry-Run → Approvals → Deploy → HMAC Audit`.
2. Confirm Monaco side-by-side XML/Apex diff viewer works properly.
3. Check gate override badges and rollback trigger.

---

### Step 7: Changes & Audit Log (`/changes`)
1. Review deployed change records table (Deployment ID, Approver, Intent, HMAC Hash).
2. Click the GitHub commit link $\rightarrow$ opens `https://github.com/abhi-rai-001/Audit-logs/commit/<sha>`.
3. Click **"Export Full Log"** $\rightarrow$ downloads `forge-audit-log-YYYY-MM-DD.csv`.
4. Click **"Refusals"** tab $\rightarrow$ inspects any blocked changes with policy reasons and remediation advice.

---

### Step 8: Settings & Integrations (`/settings`)
1. **Salesforce Connection:** Shows `OrgForgeDevHub` (`00Dfj00000VmuUHEAZ`), API v67.0, token status.
2. **GitHub Connection:** Displays `abhi-rai-001/Audit-logs` with green "Installed & Connected" badge.
3. **Diagnostics:** Click **"Run Diagnostics"** (`POST /api/v1/diagnostics/recheck`) $\rightarrow$ updates latency, permissions, and package readiness in real time.

---

## 6. Edge Cases & Failure Recovery Test Matrix

| # | Edge Case Scenario | Test Trigger | Expected Behavior |
| :--- | :--- | :--- | :--- |
| **EC-1** | **Salesforce Token Expiry** | Revoke or expire Salesforce token. | UI renders amber **"Reconnect Org"** banner (`ORG_RECONNECT_REQUIRED`); does not log user out of OrgForge. |
| **EC-2** | **Readiness Gate Block** | Disable Agents feature in org. | Sending agent prompt renders an amber **`gate_block`** card with **"Fix in Settings"** link; `both` requests downgrade gracefully to `org_change`. |
| **EC-3** | **Single-Flight Concurrency** | Send a prompt while a build is in progress. | Returns a structured pre-SSE HTTP 409 conflict error; does not corrupt stream state. |
| **EC-4** | **Unsafe Instance URL (SSRF)** | Attempt connecting non-Salesforce domain. | Backend rejects connection with HTTP 400 (`instanceUrl must be https://*.salesforce.com or *.force.com`). |
| **EC-5** | **Dry-Run Deploy Failure** | Request invalid XML or unsupported field type. | Stage 7 dry-run fails with exact MDAPI component errors; zero live metadata is altered. |
| **EC-6** | **GitHub App Offline** | Trigger deployment with unlinked GitHub App. | Writes audit log to local storage (`../orgforge-changes/CR-*.md`) without throwing or fabricating commit hashes. |
| **EC-7** | **Multi-Tab Session Isolation** | Open Copilot in two browser tabs simultaneously. | Each tab isolates conversation memory via `sessionStorage`; no transcript bleed across tabs. |
| **EC-8** | **Database Schema Isolation** | Probe API endpoints across schemas (`public` vs `orgforge`). | Multi-tenant isolation and RLS guarantee users cannot access foreign org connections or audit rows. |

---

## 7. Security Test Suite (Phase 5 rollout gate)

> The deliberate "try to break into it" pass — every sub-test below is a
> rollout gate criterion (PHASE5_PLAN §1). Run each against the LIVE unified
> API (`/api/v1/*`), not mocks.
> **Note (2026-08-14):** the original gate item "auth-bypass on mounted
> legacy routers" is **obsolete** — the legacy `/api/auth` + `/api/org` alias
> routers were deleted in the backend cleanup. The concept (auth-bypass on
> every remaining route) still applies exactly as below.

### 7A. Auth-Bypass — every route refuses unauthenticated calls

| # | Test Trigger | Expected Behavior |
| :--- | :--- | :--- |
| **A-1** | Call every `/api/v1/*` route with **no Authorization header** (orgs, agents, chat/route, chat/stream, diagnostics, change-records, refusal-logs, deployments, gates, impact, changes, chat/sessions, chat/:contextId). | HTTP **401** (JSON `{error: ...}`) from `@forge/auth` `requireAuth` — zero exceptions, no data leaked in the body. |
| **A-2** | Same calls with a **garbage / expired / tampered JWT**. | HTTP **401** — `auth.getUser` must reject invalid signatures and expired tokens, not just missing ones. |
| **A-3** | Health endpoints (`/api/v1/health`, `/api/v1/health/db`). | These are the **only** intentionally public routes (liveness/readiness probes) — verify they return 200 **without** leaking tenant data (no row counts, no org names). |

### 7B. RLS Attempt Matrix — cross-tenant reads blocked at the database

| # | Test Trigger | Expected Behavior |
| :--- | :--- | :--- |
| **R-1** | User **A** (valid JWT) requests user **B's** org connections / change records / chat sessions / routing logs / ai_logs — e.g. `GET /api/v1/change-records?orgId=<B's org>` or hand-crafting another user's `userId`. | **Empty result or 404/403** — the API queries are scoped to `req.tenantId` (`tenantIsolation`) AND Postgres RLS filters every `orgforge.*` row by `user_id`/`org_id`. No foreign rows, no existence oracle. |
| **R-2** | Direct PostgREST probe with the **anon key** against `orgforge.change_records` / `org_connections` / `deployments` (bypassing the API). | **RLS blocks** (0 rows or permission denied) — anon/authenticated roles hold no blanket table access. |
| **R-3** | Session resume: user A requests `GET /api/v1/chat/sessions/:sessionId` using a session id owned by user B. | **404** (tenant-scoped) — foreign session ids are indistinguishable from missing ones. |
| **R-4** | Signed-record forge attempt: user A `POST`s a change-record payload claiming user B's `userId`/`orgId`. | **Rejected** — writes go through the service layer with the authenticated tenant; RLS blocks cross-tenant inserts at the row level. |

### 7C. Token-in-Logs Scan — secrets never reach log output

| # | Test Trigger | Expected Behavior |
| :--- | :--- | :--- |
| **T-1** | Drive the full pipeline (connect → chat → deploy → record) while capturing `stdout`/morgan logs, then **grep for the live access/refresh tokens, Supabase JWTs, `HMAC_SECRET`, service-role key, and GitHub installation tokens**. | **Zero matches** — morgan logs method/path/status only; no Authorization headers, no tokens, no secrets in any log line or `ai_logs`/`routing_log` payloads. |
| **T-2** | Force a failure path (invalid Salesforce token, GitHub push failure, dry-run rejection) and re-scan the error output. | Errors surface the **reason**, never the credential — e.g. OAuth error strings, not the refresh token itself. |

### 7D. SSE Origin Checks — no cross-site subscription to chat streams

| # | Test Trigger | Expected Behavior |
| :--- | :--- | :--- |
| **S-1** | Open `POST /api/v1/chat/stream` from a **foreign origin** (random website / attacker page) with a stolen-but-valid JWT. | Requests without the app's allowed origin are rejected (CORS preflight fails / request blocked) — a third-party page cannot subscribe to or read the event stream. |
| **S-2** | Open the SSE stream with **no / expired JWT** from the app origin. | **401 before any SSE frame** — no event data ever reaches an unauthenticated client. |
| **S-3** | While a stream is open, verify **no cross-tenant frames**: user A's session events must never interleave into user B's connection (stream is bound to the authenticated session key `{userId}|{orgId}|{sessionId}`). | Events only ever carry the requesting user's session content. |

### 7E. Evidence & sign-off

- Record results per sub-test (A-1..A-3, R-1..R-4, T-1..T-2, S-1..S-3) as
  **PASS / FAIL + evidence** (curl output, RLS probe results, grep exit codes).
- All sub-tests **PASS** = security gate cleared → proceed to canary/soak.
- Any **FAIL** = fix forward on the unified app (there is no rollback to
  legacy — old deploys are stopped) and re-run the affected sub-tests.
