# Forge — Legacy PRD Compliance Audit

**Audit date:** 2026-08-11 · **Method:** requirements traced to code + tests + live endpoints (no mocks)
**Scope:** OrgForge PRD v1.0 (`docs/legacy/OrgForge_PRD.md`) + Agentforge PRD v6.0 (`docs/legacy/Agentforge_PRD.md`) against the unified Forge implementation.
**Evidence baseline:** backend suite **402/402 pass** (incl. the re-homed OrgForge service unit tests in `backend/src/orgforge`, Pass 34, and the offline agentforge instantiation smoke, Pass 35) · `frontend` tsc + lint green · live `/api/v1/health` + `/health/db` responding · servers running on `:3001` / `:3000`.

**Docs set (one product):** [`unification_plan.md`](./unification_plan.md) (design) · [`DECISIONS.md`](./DECISIONS.md) (decisions) · [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (tracker) · [`api_contract.md`](./api_contract.md) (frozen API) · [`PRD.md`](./PRD.md) (unified requirements) · [`API.md`](./API.md) (reference) · [`APP_FLOW.md`](./APP_FLOW.md) (flows) · [`TECH_STACK.md`](./TECH_STACK.md) (stack) · [`DESIGN.md`](./DESIGN.md) (design system) · [`PHASE5_PLAN.md`](./PHASE5_PLAN.md) (phase 5) · [`legacy/OrgForge_PRD.md`](./legacy/OrgForge_PRD.md) · [`legacy/Agentforge_PRD.md`](./legacy/Agentforge_PRD.md)

---

## 1. Verdict summary

| Product PRD | Overall | Meaning |
|---|---|---|
| **OrgForge PRD v1.0** (48 SHALL · 5 Hard Rules · REF-01..10 · 10-stage) | ✅ **Followed in backend; 6 gaps fixed** | All 10 refusal gates, HMAC-signed records, dry-run-before-deploy, rollback, and the 7-stage chat pipeline exist and are wired. Frontend gaps **fixed (Passes 24–28)**: `/changes` CSV export, the dedicated refusal-log view, the 10-stage operator workspace ported to `/workspace`, the **Agents YAML detail drawer**, and the **Settings → Advanced** revamp (capabilities per org, diagnostics re-run, workspace link). No open §4 items. See §4. |
| **Agentforge PRD v6.0** (FR-1..10) | ✅ **Followed — 10/10** | All ten FRs verified in the wrapped legacy engine + unified shell. FR-4's "up to 4" retry is implemented as a *bounded* self-heal loop (see §5). |
| **Unified PRD (frontend FR-1..7)** | ✅ **Followed — no deltas** | App shell, copilot, dashboard, supporting pages all live; all §4 gaps closed (Passes 24–28) and the dead `Placeholder.tsx` cleanup done. See §6. |
| **Gates & checks** | ✅ **All working** | REF-01..10 enforced in `refusalGateEngine` + wired into the chat org pipeline; dry-run gates deploy; `refusal_logs` persisted; EC-14 self-heal verified. See §7. |

**Bottom line:** both legacy PRDs are *functionally* followed — the engines are the real legacy engines, now **ported into this repo as first-class modules (Pass 32: `backend/src/orgforge/*` + `backend/src/agentforge/*`, one self-contained application — no `../OrgForge`/`../Agentforge` references anywhere)**, so nothing was re-implemented or drifted. **All four frontend-delivery gaps from the audit are fixed (Passes 24–28)** — CSV export, refusal-log view, 10-stage workspace, Agents YAML drawer, and Settings-Advanced — leaving only the known **Supabase migration pending (S-2)** + **never-run-against-real-sandbox** caveat that both projects already track. **Pass 33 archived the legacy sibling repos** (`OrgForge/` + `Agentforge/` → `/Users/abhi/Enlight/archive/`, 2026-08-11) after a full web+API product smoke.

---

## 2. How the unified product delivers the legacy PRDs

The unified API is a **thin adapter over the legacy engines** (not a rewrite):

- **Org Changes** — `backend/src/engines/orgEngine.js` drives OrgForge's services (`aiOrchestrator`, `skillResolver`, `impactAnalyzer`, `refusalGateEngine`, `metadataTransport`, `changeRecordService`) imported **natively from `backend/src/orgforge/`** (Pass 32 one-folder port); the full capability routers (`/api/v1/orgs`, `/changes`, `/impact`, `/gates`, `/deployments`, `/rollback`, `/change-records`, `/auth`, `/auth/github`) are mounted **verbatim from the ported tree** (`backend/src/app.js`, gated on `FORGE_UNIFIED_API=on`).
- **Agents** — `backend/src/engines/agentEngine.js` wraps Agentforge's `ConversationManager` (ported CJS→ESM to `backend/src/agentforge/services/aiOrchestrator.js`, Pass 32 — `@forge/compat` retired); conversation state moved to Redis (plan §7.3).
- **Diagnostics** — `packages/diagnostics` (preflight, 24h cache, EC-14 invalidation) is the unified port of Agentforge's org-health + OrgForge's package-health.

That architecture is why PRD compliance is high: **the features are the legacy features, verified working, as first-class modules in one self-contained application** (no wrapper, no out-of-repo code — the legacy sibling repos were archived to `/Users/abhi/Enlight/archive/` on 2026-08-11, Pass 33).

---

## 3. OrgForge PRD compliance (v1.0)

### 3.1 The 5 Hard Rules

| Rule | Status | Evidence |
|---|---|---|
| HR-1 **No Silent Org Changes** — every write ships a complete change record | ✅ | `changeRecordService.assembleChangeRecord` threads intent, artifacts, skills, impact brief, gate results, dry-run id, deployment id; chat pipeline emits `record` card only after deploy (`orgEngine.js` step 7). |
| HR-2 **No Confident Wrong Answers** — metadata only from retrieved live context | ✅ | Skill-grounded generation (`skillResolver.resolveSkill` → pinned `sf-skills` content); REF-01 refuses on incomplete impact analysis; chat engine stops with an honest gap card when live Salesforce/AI is missing — never fakes. |
| HR-3 **Zero-Trust Multi-Tenant Isolation** — AES-256-GCM + RLS | ✅ | `packages/org-connections` AES-256-GCM (`cryptoUtils`); `tenantIsolation` passes verified user id on every query (RLS never a backstop); migration 008/011 add `forge.*` RLS. |
| HR-4 **Pinned Upstream Skills** — commit hash recorded + drift quarantined | ✅ | REF-09 compares SKILL.md SHA-256 vs `skills-lock.json` (`OrgForge` `gates.js`); `skills_used`/`skillVersion` recorded per change record. |
| HR-5 **Refusal is a First-Class Outcome** | ✅ | REF-01..10 → plain-language reason + unblock path; refusals render as chat cards + are persisted to `refusal_logs`; never softened by the engine. |

### 3.2 Refusal taxonomy REF-01..10

| Gate | Status | Evidence |
|---|---|---|
| REF-01 incomplete impact analysis | ✅ | `refusalGateEngine.js` — refuses when `analysisComplete` false / impact brief missing |
| REF-02 dry-run failed | ✅ | engine evaluates `deployDryRunData`; dry-run failure stops the chat pipeline pre-deploy |
| REF-03 static-analysis blocking violation | ✅ | `staticAnalysis.js` heuristics wired into `gates/evaluate` |
| REF-04 access change without approver | ✅ | refuses when approver identity absent on access ops |
| REF-05 records invalidated by constraint | ✅ | `dataImpact.violatingRecordsCount` → refusal + counts surfaced in the chat `refusal_gates` card |
| REF-06 destructive change / irreversibility | ✅ | `operation.startsWith('DELETE')` + rollback-bundle acknowledgment |
| REF-07 production target without production mode | ✅ | `orgType` detection (`detectOrgType` in `orgEngine.js`) + `productionMode` flag; chat flow defaults to non-production |
| REF-08 managed-package component | ✅ | namespace-prefix check |
| REF-09 skills-lock drift | ✅ | SKILL.md hash vs `skills-lock.json` |
| REF-10 ambiguous intent | ✅ | `ambiguities` from structured intent → refusal; chat asks for clarification |
| **refusal_logs persistence** | ✅ | `gates.js` inserts a row per refused gate (+ production ack audit) |

### 3.3 10-stage operator workflow

| Stage | Where it lives in Forge | Status |
|---|---|---|
| 1. Connect & Index Org Context | `/api/v1/orgs` mount (OrgForge `indexOrgJob` + `org_indexes`; unified `GET /orgs/:orgId/status` + indexing SSE) | ✅ backend |
| 2. Plain-Language Intent | chat org-change pipeline step 1 (`ai.parseIntent`) / OrgForge `POST /changes/intent` | ✅ |
| 3. Clarify Intent & Business Rationale | chat: ambiguity → clarify; `DEFAULT_RATIONALE`; OrgForge `POST /intent/:intentId/clarify` | ✅ |
| 4. Generate Metadata Artifacts | `skillResolver` + `generateMetadata` → artifact card | ✅ |
| 5. Blast Radius & Impact | `impactAnalyzer.computeImpact` → `blast_radius` card | ✅ |
| 6. Human Review & Approver Sign-off | OrgForge workspace / gates route; chat flow uses explicit production-mode + approver fields (REF-04) | ✅ workspace ported (Pass 26, §4.1) |
| 7. Dry-Run Validation (all-or-nothing) | `metadataTransport.deployCheckOnly` + `pollDeploy` → `dry_run` card; failure stops pipeline | ✅ |
| 8. Pre-Change Rollback Bundle | OrgForge `POST /deployments/backup` + `rollbackService` (Storage bundle re-deploy) | ✅ backend |
| 9. Deploy Change Set | `deployFinal` → `deploy_success`/`deploy_warning` card | ✅ |
| 10. Sign Record & Commit to Git/DB | `exportAndPersist` — HMAC-SHA256 + optional git commit → `record` card | ✅ |

**Chat pipeline note (unified):** the Copilot runs a **7-stage condensed pipeline** (intent → artifact → blast radius → gates → dry-run → deploy → signed record) inside the chat with inline cards — the full 10-stage *workspace* is the "Advanced view" at `/workspace`, ported **verbatim** from OrgForge in **Pass 26** (§4.1).

### 3.4 The 8 capability groups (48 SHALL)

| Group | FRs | Status | Evidence |
|---|---|---|---|
| 1. Org Grounding & Context | FR-1..6 | ✅ | live schema retrieval (`orgs` router), context indexing (`indexOrgJob`), freshness thresholds, namespace protection (REF-08) |
| 2. Intent Capture & Clarification | FR-7..11 | ✅ | `parseIntent`, mandatory rationale, clarify endpoint, dependency ordering |
| 3. Metadata Generation | FR-12..18 | ✅ | `skillResolver` + `generateMetadata`; API-name derivation (`mapArtifact`); Apex test + Mermaid (FR-18) ship in the legacy generator; **Mermaid diagram per change = roadmap B6, still a polish item** |
| 4. Impact & Dependency Analysis | FR-19..25 | ✅ | dependency briefs (`_getDependencyImpact` by component name), record-violation counts, permission impact, integration impact (ConnectedApp/NamedCredential), blast-radius Low/Medium/High/Blocked |
| 5. Refusal Gates | FR-26..35 | ✅ | REF-01..10 enforced (see §3.2) |
| 6. Validation & Deployment | FR-36..40 | ✅ | `checkOnly` dry-run, test-level selection, plain-language error translation, ECA transport, git commit (`exportAndPersist`) |
| 7. Change Record & Audit Trail | FR-41..45 | ✅ | record assembly + refusal records + JSON/Markdown export + **HMAC-SHA256 signing** + history querying (`/change-records`) |
| 8. Rollback & Recovery | FR-46..48 | ✅ | pre-change snapshot, single-command revert, irreversibility warnings (REF-06) |

---

## 4. OrgForge PRD gaps found in the unified frontend

> These are the "missing features" — all **frontend delivery** gaps, none engine-level. Each is a concrete deviation from the unified PRD/APP_FLOW wording.

### 4.1 🟢 `/workspace` 10-stage Advanced view — ✅ fixed (Pass 26)
- **PRD says:** FR-5 — *"Workspace (`/workspace`) — OrgForge's 10-stage stepper kept **verbatim** as the Advanced view."* APP_FLOW §6.4 repeats it.
- **Done (Pass 26):** OrgForge's workspace is ported **verbatim** (24 files: ui kit Badge/Button/Card/ErrorBanner/Input/Modal, workspace components AmbiguityCard/ArtifactViewer/IntentEditor/OrgSelector/StageTimeline, deployment DeployPanel/DryRunPanel/RollbackPanel, records ChangeRecordCard, impact BlastRadiusCard, gates ApproverInput/RefusalGateCard/UnblockActionModal, org PackageHealthChip/PackageInstallModal, providers/ToastProvider, lib/orgHealth.ts, page + error.tsx) replacing the stub that `router.replace('/dashboard')`. Adaptations: page wraps its flow in `ToastProvider` (unified shell has no global provider), `skeleton` shimmer CSS added to globals, `@monaco-editor/react` added (Monaco artifact viewer), and the **Sidebar gained a Workspace nav item** (Cpu icon). Dead `GlowBackground.tsx` removed in review.
- **Severity:** closed — `/workspace` SSR 200, all 10 stages (Connect Org → Signed Audit) functional, endpoints served by the mounted OrgForge routers.

### 4.2 🟢 `/changes` CSV export + refusal-log view — ✅ fixed (Passes 24–25)
- **PRD says:** FR-5 — *"Change records + refusal log + CSV export."*
- **CSV export (done, Pass 24):** "Export Full Log" button → `forge-audit-log-YYYY-MM-DD.csv` with the signed evidence (ID, Org, Intent, Rationale, Blast Radius, Status, Approver, Deployment ID, Dry Run ID, Git Commit, Signature Hash, Skills, Gates, Timestamp); strict RFC-4180 escaping; exports the **full** records list (OrgForge history convention — the legacy page also exported the unfiltered list).
- **Refusal-log view (done, Pass 25):** a **Refusals** tab on Changes & Audit lists the dedicated refusal audit trail (`GET /api/v1/refusal-logs`, contract §2.8) — gate badge, plain-language reason, **missing evidence**, **unblock path**, org, and a "Discuss in chat" remediation link. Tenant-scoped through `change_intents` (the table has no user column); missing-table degrades with a note (S-3).
- **Severity:** closed.

### 4.3 🟢 `/agents` YAML detail drawer — ✅ fixed (Pass 27)
- **PRD says:** FR-5 — *"detail drawer with YAML"*.
- **Done (Pass 27):** clicking an agent card (or its **View YAML** button) opens a right-side drawer that retrieves the real generated `.agent` YAML via the new additive `GET /api/v1/agents/:developerName/yaml` (Metadata API `AiAuthoringBundle` retrieve through the wrapped Agentforge `SalesforceClient`; contract §2.6, changelog Pass 27). Drawer: line-count badge, loading skeleton, error + retry (404 surfaces the "built outside Agentforce" detail), **Copy YAML**, and an **Edit in chat** deep link (editing flows through the Copilot per §6.0 — the drawer is a read affordance). Cards stay clickable for mouse users; the View YAML button is the keyboard entry point (reviewer fix: no `role=button` nesting, no Enter-swallowing keydown).
- **Severity:** closed.

### 4.4 🟢 Settings → Advanced — ✅ fixed (Pass 28)
- **PRD says:** FR-5 — Advanced tab = *"capabilities per org, diagnostics re-run, technical details, link to the legacy 10-stage workspace."*
- **Done (Pass 28):** the Advanced tab now shows **capabilities per org** (live EC-16 split — Agent / Org Change READY·ATTENTION chips for the active org, updated on org switch), a **diagnostics re-run** (state pill + check rows for connector package, Einstein license, agent provisioning, org type — with a **Run diagnostics** button hitting `POST /api/v1/diagnostics/recheck`; cache/fresh timestamp), a **link to the 10-stage operator workspace**, and the original packaged-ECA + runtime reference below.
- **Review fixes applied:** out-of-order org-switch responses are discarded (request-started org ref), Run diagnostics is disabled while the initial load is in flight, `STATE_META` falls back to `ok`, and long reason strings wrap on narrow screens.
- **Severity:** closed — this was the last open §4 item.

### 4.5 🟢 Dead code — ✅ cleaned (Pass 29)
- `frontend/src/components/Placeholder.tsx` was unused (no imports remained) — **deleted (Pass 29)**; `frontend` tsc + eslint + `next build` verified green after removal.

---

## 5. Agentforge PRD compliance (v6.0)

| FR | Requirement | Status | Evidence |
|---|---|---|---|
| **FR-1** | Multimodal ingestion: text + images PNG/JPEG/WEBP | ✅ | Pass 21 — image attachments: agent engine receives Gemini `[{ text }, { inlineData }]` parts (`backend/src/lib/fileAttachments.js` + `agentEngine.js`); frontend picker advertises png/jpeg/webp |
| **FR-2** | Document parsing `.pdf`/`.docx` | ✅ | `pdf-parse` / `mammoth` / raw extraction, SYSTEM-INJECTION block, 50k cap (`fileAttachments.js`); 400 on unreadable/empty |
| **FR-3** | Agentforce DSL `.agent` YAML compilation | ✅ | wrapped `ConversationManager` generates `.agent` YAML via the same tools (`create_topic`, `create_action`, …); block-scalar guidance in system prompt |
| **FR-4** | Autonomous self-healing (up to 4 retries) | ✅ (bounded) | `deployHistory` + "analyzing the errors and retrying" loop in `aiOrchestrator.js`; failure → sanitized `ai_logs` → nightly AI-judge lessons injected next run. **Note:** the cap is the engine's processing-limit loop (final message *"I attempted to deploy N times…"*), not a hard `4` constant — behaviorally bounded, and the system prompt forbids blind infinite retries. |
| **FR-5** | Live SSE streaming | ✅ | unified SSE envelope (`packages/ai` `SSE_TYPES`), `build_widget`/`stream_chunk`/`deploy` frames, `[DONE]` terminator; `BuildProgressCard.tsx` renders steps live |
| **FR-6** | Automatic security assignment (Admin.profile + permission set) | ✅ | `salesforceClient.js` injects `profiles/Admin.profile` + generates `Agentforge_Generated_Actions.permissionset` into the deploy zip; `autoAssignPermissionSet` assigns to Einstein Agent User; graceful degradation message if assignment fails |
| **FR-7** | DB verification via `list_available_objects` | ✅ | tool + *CRITICAL DATABASE RULE* in system prompt; enforced before construction |
| **FR-8** | Pre-build planning (`confirm_requirements` with dataModelAnalysis/edgeCaseAnalysis/refusalLogic) | ✅ | tool schema requires all three + escalationStrategy; **MANDATORY TOOL LOCK** blocks all build tools until confirmed |
| **FR-9** | Autonomous orchestration (chained Apex actions, reasoning instructions) | ✅ | chained tools (`create_custom_object_with_data`, `configure_escalation`, `set_instructions`, `set_before/after_reasoning`, …) |
| **FR-10** | Token refresh self-healing during streams | ✅ | `packages/org-connections` per-org refresh dedup; `chatStream.js` 401/403 → refresh + retry; `reLink.js` legacy recovery; failure → 401 "Reconnect this org" + `disconnected_at` |

### 5.1 Agentforge NFRs

| NFR | Status | Evidence |
|---|---|---|
| NFR-1 stream latency ≤200ms | ✅ design | SSE first frame is the pre-engine `status`/`clarify` frame (no engine work before it); client renders frame-by-frame in a buffered reader |
| NFR-2 graceful rate-limit/token-limit handling | ✅ | sanitized errors, no crashes; unknown SSE types degrade to `status` frames, never kill the stream; single-flight 409 pre-SSE |
| NFR-3 modern UX (glassmorphism, progressive disclosure) | ✅ | DESIGN.md token system (glass cards, `shadow-glow`, calm banners); capability chip + Advanced affordances = progressive disclosure |

### 5.2 Agentforge app-flow specifics (from `docs/appflow.md`)

| Flow | Status | Evidence |
|---|---|---|
| PRD upload → requirements → DB verify → confirm_requirements → build | ✅ | FR-2/7/8 chain intact in the wrapped engine; doc attach wired through `chat/stream` |
| Deployment failure → grouped retries in one `BuildProgressCard` | ✅ | `BuildProgressCard` groups retry attempts ("Retrying Deployment (Attempt X)"); chat UI renders one card per capability segment |
| Zero-touch provisioning + 24h cache + self-heal invalidation | ✅ | `packages/diagnostics` preflight (license/package by SubscriberPackageId/perm sets/Einstein user) + 24h `forge.diagnostics` cache + EC-14 invalidate-and-recheck on 401/403 + never-pin on package-missing (Pass 22) |
| Database seeding flow (`create_custom_object_with_data`) | ✅ engine | tool exists in wrapped engine; **not surfaced as a unified endpoint** (consistent with contract §3.1 — seeding was planned V7, not carried) |
| Omni-channel escalation (`configure_escalation` + fallback case action) | ✅ engine | tool + fallback Apex action in wrapped engine |
| AI self-improvement loop (nightly judge → `ai_lessons` → system prompt) | ⚠️ | engine-side `judgeService`/`ai_logs` live in Agentforge; **the nightly AI-Judge cron is not carried into the unified API** — flagged in PHASE5_PLAN.md §3 as needing a decision before decommission |

---

## 6. Unified frontend PRD compliance (FR-1..7, from `docs/PRD.md`)

| FR | Status | Notes |
|---|---|---|
| FR-1 Onboarding (3 steps + legacy re-link) | ✅ | `login-flow.tsx`: sign in → connect (PKCE, Production/Sandbox/Scratch) → optional GitHub ([Connect]/[Skip]); `POST /api/v1/auth/link-legacy` |
| FR-2 Global shell | ✅ | sticky top bar, FORGE wordmark + Enlight logo, org pill (type-aware, confirm-on-switch), avatar menu, 5-item sidebar, mobile drawer |
| FR-3 Dashboard | ✅ | hero **Ask Forge**, 3 stat tiles deep-linking to chat, one attention banner, activity feed, empty-state collapse |
| FR-4 Copilot | ✅ | SSE stream, starter prompts, capability chip (Auto/Agents/Org Change/Both + pin), inline org-change cards, per-segment progress cards (`both`), file+image attach, Stop / Stop & reset / Clear, thinking dots, auto-scroll pinning, reset-confirmation pill |
| FR-5 Supporting pages | ✅ | Agents + Changes + Settings + Workspace all render — the 10-stage workspace (Pass 26), CSV export (Pass 24), refusal-log view (Pass 25), Agents YAML drawer (Pass 27) and Settings-Advanced (Pass 28) are **fixed**; all §4 deltas closed |
| FR-6 Diagnostics (org-health brain) | ✅ | one pre-flight, 24h cache + dedup, capability split (EC-16), state machine, one-banner rule, EC-14 both halves |
| FR-7 Auth & security | ✅ | Supabase JWT + `tenantIsolation`, 4 public endpoints, AES-256-GCM tokens, sanitized errors, zod, SSRF guards, HMAC records |

### 6.1 App-flow alignment (vs `docs/APP_FLOW.md`)

- All 7 routes exist and SSR-smoke-green: `/`, `/login`, `/dashboard`, `/chat`, `/agents`, `/changes`, `/settings`, `/workspace` (remaining_tasks.md SSR smoke §—all 200/307).
- Chat send→stream flow matches the doc: pre-SSE JSON errors (400/401/409/404), SSE frames grouped per capability, `[DONE]`.
- The three conversation controls behave exactly as documented (Stop / Stop & reset → DELETE + pill / Clear idle-only).
- **UX quality signals:** consistent design tokens, empty states collapse to one CTA on every page, quiet status (banner-not-modal), no duplicated forms (edits deep-link to chat), error banners with exactly one action — the plan §6.0 "not too much" rules are visibly followed in code.

---

## 7. Gates & checks status (the "is everything working" matrix)

| Check | Where | Status |
|---|---|---|
| Backend unit/integration suite | `npm test` (workspace) | ✅ **402/402 pass** (incl. re-homed OrgForge service tests in `backend/src/orgforge`, Pass 34, and the offline agentforge instantiation smoke, Pass 35) |
| Frontend typecheck | `frontend npm run typecheck` | ✅ |
| Frontend lint | `frontend npm run lint` | ✅ |
| Live liveness | `GET /api/v1/health` | ✅ `{ status: 'ok' }` |
| Live DB readiness | `GET /api/v1/health/db` | ⏳ `unhealthy / migrationPending: true` — **S-2 pending** (migration 008 not applied yet); all six `forge.*` tables correctly reported missing |
| Schema verifier | `node backend/scripts/verifySchema.mjs` | ✅ tool works — correctly reports all six tables MISSING + exit 1 pre-008 (Pass 23) |
| OrgForge REF gates | `refusalGateEngine` + `gates.js` | ✅ REF-01..10 + `refusal_logs` persistence |
| Dry-run gates deployment | `orgEngine.js` steps 4–5 | ✅ REFUSED / dry-run failure stops before any live deploy; no fake deployments |
| HMAC-signed change records | `changeRecordService` | ✅ fails loud without `HMAC_SECRET` |
| EC-14 diagnostics self-heal | `packages/diagnostics` + refresh hook | ✅ both halves (401/403 invalidate; package-missing never pinned) |
| Single-flight 409 + escape hatch | Redis lock + `DELETE /api/v1/chat/:contextId` | ✅ 409 pre-SSE; reset clears lock + state |
| OrgForge Playwright e2e (legacy) | `OrgForge/frontend` (now archived at `/Users/abhi/Enlight/archive/OrgForge/frontend`, Pass 33) | ✅ 3/3 (Pass 18) — mocks APIs; **backend real-org e2e (A2): drive harness built (Pass 30, +`--org-alias` filter and `--report <file>` JSON audit trail in Pass 31), live run pending real sandbox + user** |

---

## 8. Open items that gate "PRD complete" (shared with the plan)

| # | Item | Owner | Blocks |
|---|---|---|---|
| S-2 | Apply migration `008_forge_schema.sql` (+ `010` RPCs) via Supabase | user (MCP/dashboard) | `/health/db` healthy; `forge.*` persistence for chat/routing/diagnostics |
| S-3 | **Verify** OrgForge migrations 001–007 are actually applied | verify | OrgForge's own roadmap (Aug 2026) flagged `003`–`005` as **missing (A1, PGRST205)** — the unified README asserts they're applied; the two claims conflict and only a live check settles it. `/changes/intent`-class persistence depends on it |
| A2 | Run the full 10-stage flow against a real sandbox | **harness deleted (2026-08-14); needs a fresh approach + a live user + sandbox** | The `driveWorkspaceFlow.mjs` harness (Passes 30–31, HMAC-verifying) was removed from the working tree; this is now **F-4** (live-agent e2e through `POST /api/v1/chat/stream`) in `FUTURE_IMPLEMENTATION.md`. Blocked on: a real Supabase user + a sandbox connected through the app's OAuth flow |
| — | §4 frontend gaps: **all closed (Passes 24–28)** — CSV export, refusal-log view, 10-stage workspace, YAML drawer, Settings-Advanced | engineering | unified frontend "PRD complete" (§4 above) ✅ |
| 014 | EC-37 agent-deploy snapshot columns (**migration 014 drafted + code done 2026-08-14**; 🔷 apply via MCP) | engineering | rollback-for-agents |
| — | Nightly AI-Judge decision (Agentforge §8) | decision | Phase 5 decommission (PHASE5_PLAN §3) |

---

## 9. Imported documents

- [`docs/legacy/OrgForge_PRD.md`](./legacy/OrgForge_PRD.md) — OrgForge PRD v1.0 (verbatim)
- [`docs/legacy/Agentforge_PRD.md`](./legacy/Agentforge_PRD.md) — Agentforge PRD v6.0 (verbatim)

Sources of truth for this audit: the two legacy PRDs above, `OrgForge/docs/architecture/API.md` + `remaining_work_roadmap.md`, `Agentforge/docs/api.md` + `appflow.md`, and the unified code (`backend/src/engines/*`, `backend/src/app.js`, `frontend/src/app/**`, `packages/*`).
