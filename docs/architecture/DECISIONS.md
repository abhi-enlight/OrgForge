# Unified Platform — Locked Decisions

> **Status:** Approved by founder (2026-08-10)
> **Source:** Answers recorded inline in `unification_plan.md` §17
> **Applies to:** all implementation phases (Appendix A order)

These decisions supersede the "open" status in the plan. Work may proceed on this basis.

**Docs set (one product):** [`unification_plan.md`](./unification_plan.md) (design) · [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (tracker) · [`api_contract.md`](./api_contract.md) (frozen API) · [`PRD.md`](./PRD.md) (requirements) · [`API.md`](./API.md) (reference) · [`APP_FLOW.md`](./APP_FLOW.md) (flows) · [`TECH_STACK.md`](./TECH_STACK.md) (stack) · [`DESIGN.md`](./DESIGN.md) (design system) · [`PHASE5_PLAN.md`](./PHASE5_PLAN.md) (phase 5) · [`PRD_COMPLIANCE.md`](./PRD_COMPLIANCE.md) (audit) · legacy PRDs ([`OrgForge`](./legacy/OrgForge_PRD.md) · [`Agentforge`](./legacy/Agentforge_PRD.md))

---

## D1. Product name — **"Forge" (Enlight Forge)**
Confirmed. `Forge` is the product name; `Enlight Forge` is the full brand. Legacy capabilities live as internal feature names ("Agents", "Org Changes"). Rename user-visible strings only; keep code identifiers, schemas, routes, env vars, and package names unchanged (§2.2).

## D2. Session storage — **httpOnly cookies in production** (plan recommendation)
Move the Supabase session to httpOnly, SameSite=Lax, Secure cookies in production (kills the `localStorage.auth_token` XSS-theft vector). Dev keeps localStorage for parity. No `?token=` redirects; no `new_token` SSE event. Chat SSE uses JWT header (POST); query-string token only on GET/SSE where EventSource requires it (§8.1, §8.3).

## D3. Salesforce `full` scope — **keep for now; verify trim path** (see explanation below)
**Decision:** Keep the union `api web refresh_token einstein_gpt_api full sfap_api openid id` for the unified ECA in v1. Add a Phase-4/5 checklist item to test provisioning in a sandbox *without* `full` and trim it in a later release if provisioning holds.

**Why `full` is there today:** Agentforge requests `full` because its pre-flight provisioning (`runPreFlightCheck` → `findOrCreateAgentUser`, permission-set assignment, `create_custom_object_with_data`, metadata deploys) must work even when the connecting user is **not** a System Administrator. Per Salesforce OAuth semantics, `full` grants access to all org data regardless of the user's profile — which is exactly why provisioning succeeds for non-admin connectors, and exactly why it's the riskiest scope in the union. Note OrgForge's OAuth URL currently omits `scope` entirely (defaults to base `api` + `refresh_token`) — the unified flow (§8.2) standardizes on Agentforge's explicit union.

**Trim path (later):** if the merged product requires an admin to connect anyway (or we gate provisioning on sysadmin checks), `full` can be dropped to `api web refresh_token einstein_gpt_api sfap_api openid id` and provisioning retested. Never trim before that test passes in a sandbox.

## D4. Encryption-key migration — **re-connect orgs once** (plan recommendation)
Drop both legacy token sets; users re-connect via the one OAuth flow during re-link (§8.4, §9.3 path a). No server-side re-encryption. `ENCRYPTION_KEY` is generated fresh for the unified env; legacy tokens are never re-encrypted (EC-41). Same logic for `HMAC_SECRET`: legacy records verify with the secret recorded at signing time; new records use the new secret (EC-42).

## D5. Legacy downtime window — **old URLs must never 404** (see explanation below)
**Decision:** Zero-downtime cutover. Keep both legacy frontends deployed and serving through Phase 5. Verify the new domain end-to-end first, then 301 old domains to it, and only decommission legacy apps after the soak + signed sign-off. No 15-minute maintenance window.

**Why:** The plan's phasing already makes this free — "old apps keep working until the flag flips" (§14.1) and "nothing is dropped until two full release cycles after its replacement is proven" (§14.1). A maintenance window would only appear if legacy were decommissioned *before* the new domain was fully verified, which has no upside. The only discipline required: never remove the compat aliases or legacy deploy targets until Phase-5 sign-off, and verify DNS + 301s atomically.

## D6. Agent inventory — **new `forge.agents` cache table** (§9.1)
Build the `forge.agents` cache table (id, org_id, developer_name, label, description, status, yaml_ref, last_deployed_at, user_id), populated from `sfClient.getAgents` + `deploy_agent` events, powering the read-only `/agents` page. Accept the slight staleness; refresh on deploy and on page load when the row is older than a TTL.

## D7. ECAs during transition — **one ECA: the Agentforge one**
Use a single unified ECA based on the existing Agentforge ECA for both capabilities (end state immediately; no dual-package transition). Diagnostics check the one package by SubscriberPackageId (any version counts). This removes the "check both packages" branch in §12.4.3 — keep the fallback query.

## D8. GitHub step default — **skippable-but-nudged, with persistent audit-status UI**
GitHub stays optional in onboarding (Step 3, [Connect] / [Skip]). **Additional requirement:** the UI must *always* make clear when audit saving is active — i.e., any deploy/change card and the Changes & Audit page show a persistent indicator: "Audit records are committed to `<repo>`" when GitHub is connected, and "Audit records are saved locally (GitHub not connected)" when it isn't (§12.3, EC-46). No fabricated commit hashes; local fallback (`orgforge-changes/`) preserved.

---

## Remaining open items (not blocking)
- None of §17's eight items remain unresolved.
- Tracking: plan §13's five priority edge cases (EC-14, EC-10/11, EC-27, EC-22/23, EC-25) are the first test targets; Appendix A order stands.
