# Forge — Phase 5 Plan (Canary · Soak · Decommission)

**Status:** DRAFT — Phase 5 is the only remaining product phase; every item below is gated on the Phase 1–4 code being proven in a live org.
**Update (2026-08-14):** the legacy frontend + API **deploys have already been stopped** — the old apps no longer ship (the repos were archived Pass 33; the prod targets are now dark). This happened before the 301 step, so **rollback-to-legacy is off the table** and the old origins must be pointed at the new domain soon or old bookmarks will hit dead URLs. The critical path is now: verify the new domain end-to-end → land the 301s → then the §4 cleanup + schema drop (S-8).
**Grounded in:** [`unification_plan.md`](./unification_plan.md) §14 (Migration & Rollout), §15 (Testing & QA), §11.3 (brand/copy audit) · [`DECISIONS.md`](./DECISIONS.md) **D5** (zero-downtime cutover, old URLs must never 404) · [`api_contract.md`](./api_contract.md) §6 (Phase-5 changelog rule) · the real flags/aliases in `backend/src/app.js` + `frontend/src/lib/flags.ts`.

---

## 1. Gate criteria — nothing below starts until ALL are green

- [ ] **Supabase tasks applied (🔷 MCP):** S-2 migration 008, S-1 migration 010, S-4 auth config confirmed, migrations 011–013 + **014** (EC-37 agent kind columns); `/api/v1/health/db` reports `healthy` with `missingTables: []`.
- [x] **`backend/scripts/verifySchema.mjs`** extended for the full 12-table orgforge schema and passing — **done 2026-08-14**: all 12 tables (008 core, 011 github_connections, 012 memory columns, 013 data tables, 014 agent kind) with required-column checks (15 unit tests); live run verifies 11/12 ✅ — the only gap is migration **014 not yet applied** (change_records missing `kind`/`agent_name`/`agent_snapshot`), which lands with the Supabase task above.
- [ ] **Live-agent e2e in a real sandbox** — org pipeline stages run end-to-end through `POST /api/v1/chat/stream` (build → deploy → test for `agent`; intent → gates → dry-run → deploy → signed record for `org_change`; `both` handoff).
- [ ] **Dual-run regression matrix green** (§15.3) — every legacy flow's outcome proven equal by the new flow (artifacts diffed in sandbox; same change-record HMAC; same commit in the audit repo).
- [ ] **Security tests green** (§15.4) — auth-bypass on every remaining route (the legacy `/api/auth` + `/api/org` alias routers were deleted 2026-08-14, so that sub-item is obsolete), RLS attempt matrix, token-in-logs scan, SSE origin checks, prompt-injection steering. Runbook: `testing_flow.md` §7.
- [ ] **Copy audit complete** (§11.3) — no `Agentforge`/`OrgForge` string in shipped UI (code identifiers kept), favicon/logo alt/metadataBase updated for the new domain.

---

## 2. Rollout steps (canary → full)

> D5 discipline: the legacy apps stay deployed and serving until sign-off; nothing is dropped until two full release cycles after its replacement is proven. **Rollback is always available**: flip the flag off / revert the 301 — legacy is untouched.

### Stage 0 — Deploy unified app with flags off (no behavior change)

- [ ] Deploy `frontend` (Vercel) + unified API (Render) to prod domains, flags **off**: `FORGE_UNIFIED_FRONTEND=off`, `FORGE_UNIFIED_API=on` (capability routers), `FORGE_MOUNT_AGENTFORGE=on` (keep `/api/auth` + `/api/org` aliases live for the legacy frontends).
- [ ] Verify `/api/v1/health` + `/api/v1/health/db` healthy on the prod origin; smoke `/login` → 3-step onboarding on the new domain.
- [ ] Leave legacy deploy targets untouched.

### Stage 1 — Internal canary (week 1)

- [ ] Set `NEXT_PUBLIC_FORGE_UNIFIED_FRONTEND=on` for the **internal team only** (Vercel environment-scoped / preview group) — enables canary-only affordances (the stub rule-based classifier chip, `lib/flags.ts`).
- [ ] Internal team works in the unified app day-to-day; bugs go straight to the board.
- [ ] Gate to full rollout: **no P0/P1 issues** and the soak metrics (§3) within thresholds for the week.

### Stage 2 — Friendly-customer canary + 2-week soak

- [ ] Add **2 friendly customers** to the flag; keep everyone else on the legacy apps (they're still deployed).
- [ ] 2-week soak with daily metric review (§3).
- [ ] Weekly sign-off checkpoint; anything red → rollback (flag off) and fix.

### Stage 3 — Full rollout

- [ ] Flip `NEXT_PUBLIC_FORGE_UNIFIED_FRONTEND=on` for 100%.
- [ ] Announce cutover window; verify the new domain **end-to-end one last time** (D5: only then point old domains at it).

### Stage 4 — Cutover (301s) & decommission (§4)

- [ ] Point old domains at the new app with **301s, verified atomically with DNS** (D5 — no window where an old URL 404s). **Urgent now:** the legacy deploys are already stopped, so old origins currently serve nothing — verify the new domain end-to-end and land the 301s.
- [ ] Run the §4 retirement checklist; sign off; only then drop legacy schema (S-8).

---

## 3. Metrics to watch (soak dashboard)

| Metric | Where it's observable | Threshold / alert |
|---|---|---|
| **Route mis-classification rate** | `forge.routing_log`: auto-classified capability vs. user re-pin via the capability chip (the manual override = ground truth) | overrides / classified < 5% |
| **SSE drop rate** | chat/stream: frames until `[DONE]` vs. aborts; `error` frames; client-disconnect aborts | < 1% of streams |
| **Single-flight 409 collisions** | 409 responses on chat/stream (busy-lock contention, crash-stuck locks) | near-zero; investigate spikes (Stop & reset usage should drain them) |
| **Diagnostics false-negatives** | `forge.diagnostics`: "package missing" verdicts that self-heal wrongly; run volume (EC-14 never-pin means package-missing orgs re-run every read) | manual recheck agrees ≥ 99%; no permanent re-run loops |
| **API error rates** | 4xx/5xx on the unified API; sanitized 500s; fail-loud DB errors (real storage now — S-2 landed) | 5xx < 0.1%; no repeated fail-loud cache/session errors |
| **Latency** | SSE first-token time, engine duration, Redis lock wait, diagnostics cache hit rate | first token < 3s p95; cache hit > 80% |
| **Onboarding** | connect completion rate through Step 2; time-to-first-agent / first-change | connect ≥ 90% |
| **Engagement** | chat turns/user/day; `DELETE /chat/:contextId` (Stop & reset / Clear) usage; capability chip usage | trending up, no regressions |
| **Data growth sanity** | `forge.ai_logs`, `routing_log`, `chat_sessions`, `diagnostics`, `agents` row counts | no runaway loops |

> Note: the plan's legacy **AI Judge nightly** (`/internal/run-ai-judge`) is **not carried** into the unified API (contract §3.1: planned V7 endpoints not ported). During the transition it keeps running in the legacy process; decide its fate (port as a Forge internal cron or retire) before legacy decommission.

---

## 4. Legacy-alias retirement checklist (decommission)

> Contract rule (`api_contract.md` §6): when Phase 5 removes the transition mounts, **strike §4's alias paragraph and bump the changelog** — no `/api/v1/*` consumer is affected.

### 4.1 Code removals
- [x] **`@forge/compat` retired early (Pass 32)** — the one-folder native port converted Agentforge CJS→ESM (`backend/src/agentforge`) and OrgForge moved in (`backend/src/orgforge`), so no CJS router is mounted anymore; the package was deleted from workspaces + `backend/package.json`.
- [x] **Legacy sibling repos archived (Pass 33, 2026-08-11)** — `OrgForge/` + `Agentforge/` moved to `/Users/abhi/Enlight/archive/` (reversible, README + restore commands included) after a full web+API product smoke; the unified app is fully self-contained with **zero out-of-repo references**. The §4.3 "stop legacy deploys" items below now refer only to the **deployed prod targets**, not to local code.
- [x] **`backend/src/app.js` cleaned (2026-08-14)** — the `enableAgentforge` block is gone: the `/api/auth` + `/api/org` mounts and the transition-only `express-session` middleware block were removed; the dead alias routers (`backend/src/agentforge/routes/`) were deleted.
- [x] **`FORGE_MOUNT_AGENTFORGE` removed (2026-08-14)** from env files, package scripts, and docs; `FORGE_UNIFIED_API` stays (capability routers are the product now).

### 4.2 Env / config
- [x] **`JWT_SECRET` retired early (Pass 36)** — the ported Agentforge auth router no longer requires it at boot (lazy `requireJwtSecret()` fails at use only); `.env.example` rewritten with the consolidated env set (canonical names + legacy-alias fallbacks) and retired-secret notes.
- [x] **Transition-only vars deleted (2026-08-14)** — `SESSION_SECRET`, `LEGACY_JWT_SECRET` (and `FRONTEND_URL`, used only by the deleted alias router) removed from `.env.example`/docs; `reLink` now no-ops without the secret.
- [x] **Env examples pruned (2026-08-14)** — root `.env.example` + `deployment.md` swept to the post-transition set (local `.env` regeneration is a per-environment user step).
- [x] **`express-session` dependency removed (2026-08-14)** from `backend/package.json`.

### 4.3 Domains & deploys (D5 — atomic, no 404s)
- [ ] Verify the new domain end-to-end (login, connect, chat, agents, changes, settings). **← the immediate next step**
- [ ] **301 old domains** (Agentforge + OrgForge origins) → new domain; verify DNS + redirect atomically; log 404 rates on old origins for 48h (should be ~0).
- [x] **Stop legacy frontend + API deploys** — done early (2026-08-14, ahead of the 301 step): old prod targets no longer ship. Consequence: no rollback-to-legacy; the 301s above are now time-critical (old bookmarks currently hit nothing).
- [ ] Remove legacy deploy targets (Render/Vercel) after sign-off.

### 4.4 Schema & data (S-7 — post sign-off only)
- [ ] 🔷 Drop legacy `public.salesforce_connections` + old `orgforge` views (additive-first rule; never before sign-off).
- [ ] Optional: internal-identifier rename pass (package names, route prefixes, env var names, `AGENTS.md`) — cosmetic, non-blocking.

### 4.5 Docs
- [x] **`api_contract.md` updated (2026-08-14)** — §4 alias paragraph struck, §7 changelog entry added (Phase 5, breaking-by-design for legacy aliases only); `API.md` + `TECH_STACK.md` swept.
- [ ] `unification_plan.md` / `IMPLEMENTATION_PLAN.md` / `remaining_tasks.md` — mark Phases complete; `todo.md` P3 checked.
- [ ] Brand/copy final grep on the **built bundle**: `grep -ri "orgforge\|agentforge" frontend/src` returns only deliberate code identifiers (contract §11.3).

---

## 5. Rollback plan (at any stage)

| Trigger | Action |
|---|---|
| P0/P1 bug in the unified app during canary | Fix forward on the unified app and re-canary — **legacy deploys are stopped (2026-08-14), so there is no legacy fallback anymore** |
| API regression (5xx spike, data corruption) | Revert the API deploy; the `/api/auth` + `/api/org` aliases stay mounted until §4.1, but no legacy frontend consumes them now |
| Post-301 issue | Revert the 301 (DNS flip back) — **caveat:** with legacy deploys stopped, flipping back points old URLs at nothing; the 301s must be verified rock-solid before going live |
| DB issue (S-2 storage) | Legacy schemas stay intact until S-8 — data is never deleted before sign-off (but the legacy apps that would serve it are down) |

---

## 6. Sign-off criteria (exit Phase 5)

- [ ] Soak metrics green (§3) for the full 2-week window with 2 friendly customers.
- [ ] Zero open P0/P1 issues; copy audit clean; security tests green.
- [ ] 301s live + 404-on-old-origins ≈ 0 for 48h.
- [ ] Signed sign-off by the founder (per D5 / D8 discipline).
- [ ] Retirement checklist (§4) fully executed; only then is Phase 5 "done".
