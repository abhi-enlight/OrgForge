# Dry-Run Auto-Repair + Honest Limitation Widget (Next Version)

> **Status:** planned — scheduled for the next version (Phase 6). Self-contained:
> any agent with zero context can execute this plan. Scope: backend repair loop,
> chat + workspace UI, honest "why I can't fix this" copy, tests.
> **Companion docs:** [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (master tracker) ·
> [`tasks/todo.md`](../../tasks/todo.md) + [`tasks/remaining_tasks.md`](../../tasks/remaining_tasks.md) (pass trackers).

---

## 0. The question this plan answers

> When the agent runs a **check-only Metadata API deploy** (the dry run) and
> Salesforce reports a schema error / schema change, **can the agent fix it?**

**Answer: not today.** A dry-run failure is a terminal state in both flows:

- **Chat** (`backend/src/engines/orgEngine.js`, step 5): emits a `dry_run` card,
  a `deploy_warning` bubble, replies *"Org change dry run failed."*, stops. No
  repair, no plain-language explanation.
- **Workspace** (`frontend/src/components/deployment/DryRunPanel.tsx`): error
  banner with raw MDAPI failures + a "Retry Validation" button that re-runs the
  **identical broken artifacts**.

The only learning loop is passive (nightly `selfImprovementJob` →
`orgforge.ai_lessons` → injected into future generation prompts). There is no
**real-time repair loop**.

### Two latent gaps found while tracing (fix these first)

1. **Chat dry-run failures show zero errors.** `orgEngine.js` maps
   `status.errors ?? status.errorMessage` into the `dry_run` card, but the real
   `salesforceClient.checkDeployStatus` returns **`componentFailures`**
   (`{fileName, problem, componentType, fullName, lineNumber, columnNumber}`) —
   neither `errors` nor `errorMessage` exists. So in production the failed card
   renders with an empty error list (the test fake masks this: it returns
   `{status, errorMessage}`). **The widget is only as good as this mapping.**
2. **Chat dry-run failures never reach `orgforge.ai_logs`.** `deployments.js`
   `/status/:id` logs `dry_run_errors` (with `ai_repair_attempts: 1` hardcoded
   as a "failed at least once" marker), but the chat pipeline polls
   `pollDeployStatus` directly and writes nothing. The repair loop must own the
   `ai_logs` write with the **real** attempt count.

---

## 1. Capability assessment (what a repair loop can and cannot fix)

### Fixable by the agent (content-level errors)

| Class | Example | Mechanism |
|---|---|---|
| Malformed XML | missing declaration, unclosed tag | local `isWellFormedXml` + regenerate |
| CustomField type-enum drift | `<type>Text Area</type>` | `validateCustomFieldXml` rejects at packaging today; repair normalizes to `TextArea` |
| Formula / SOQL syntax | invalid formula reference syntax | AI regenerate with the MDAPI `problem` as context |
| Obvious content mistakes | wrong label/name casing, wrong namespace | AI regenerate |

### Not fixable — must be explained honestly (the widget's reason taxonomy)

| `limitation` code | Plain-language reason (widget copy) | Root cause |
|---|---|---|
| `needs_schema` | "I can't verify this against this org's schema — the field/object it references isn't in my context. It may not exist in this org yet, or was renamed." | The generator runs with `MINIMAL_ORG_CONTEXT = { componentCount: 0, objects: [], apex: [] }` (orgEngine.js) and no live schema in `generateMetadata` |
| `dependency` | "This references metadata that must already exist in the org or be deployed in a specific order (e.g. a field used by a rule being added in the same batch)." | MDAPI validates against the *current* org state, not the post-deploy state |
| `human_decision` | "This would affect existing data / behavior — the fix needs a human decision (e.g. which records are affected, whether to scope a rule to new records), not a code edit." | REF-05 class of judgment; MDAPI errors about required/data-dependent constraints |
| `org_constraint` | "The org itself blocks this — managed package (REF-08), license, or access. I can't override the org's constraints." | Platform-level restriction, not a content error |
| `unsupported` | "This operation isn't supported by the metadata types Forge can deploy." | `KNOWN_METADATA_TYPES` allowlist |
| `unknown` | "I couldn't determine a fix and can't safely guess — the change was not deployed. Review the errors below or open the Advanced Workspace to edit the artifact." | Fallback |

**Governance guardrail:** a repair is a **change to the change**. It must stay
inside the signed audit record (it does — `assembleChangeRecord` snapshots the
final `artifacts`) and it must never silently weaken a rule to make it deploy:
the repair prompt forbids semantic weakening, and every repair is shown to the
user in the card (chat) or ArtifactViewer (workspace) before any live deploy.

---

## 2. Backend design

### 2.1 P0 — Fix the error surface (`orgEngine.js`)

Add a `normalizeDeployErrors(status)` helper in `orgEngine.js`:

```js
// Real MDAPI shape: { componentFailures: [{fileName, problem, componentType, fullName, lineNumber}] }
// Legacy/fake shape: { errorMessage } | { errors: [] }
function normalizeDeployErrors(status) {
  if (Array.isArray(status?.componentFailures)) {
    return status.componentFailures.map((f) => ({
      component: f.fullName || f.fileName,
      problem: f.problem || f.stateDetail || 'Metadata API rejected this component without a reported reason.',
    }));
  }
  if (Array.isArray(status?.errors)) return status.errors;
  if (status?.errorMessage) return [{ problem: status.errorMessage }];
  return [];
}
```

Use it in **both** the dry-run (step 5) and deploy (step 6) paths so cards
always carry the real Salesforce errors. The existing `orgEngine.test.js` fakes
keep passing (both shapes handled).

### 2.2 New service — `backend/src/orgforge/services/dryRunRepairer.js`

Pure-ish, injectable (loader pattern like the other services, so tests inject
fakes):

```js
classifyFailures(failures) -> { fixable: boolean, limitation: 'needs_schema'|'dependency'|'human_decision'|'org_constraint'|'unsupported'|'fixable'|'unknown', reason }
```

Deterministic keyword rules over the joined `problem` strings (order matters):

- `needs_schema`: `/no such column|does not exist|unknown field|invalid type|unknown entity|not found/i`
- `dependency`: `/dependent|missing reference|referenced.*missing|requires.*deploy|undeployed/i`
- `human_decision`: `/existing records|data quality|required.*(?:field|value).*missing|invalid data/i`
- `org_constraint`: `/managed package|subscriber|license|insufficient access|permission/i`
- `unsupported`: `/unsupported|not supported/i`
- else `fixable`

```js
repairArtifact({ artifact, failures, structuredIntent, skillContent }) ->
  { repairedXml } | { cannotFix: true, reason }
```

Uses `aiOrchestrator.generateContent` with a strict system prompt:
- Input: the failing artifact XML, the exact MDAPI `problem` lines, the
  operation + target component, the skill content.
- Rules: output **only** corrected XML; never change the component's fullName /
  semantics; never weaken validation rules / permissions; if the failure
  references org state the model can't see (`needs_schema` class), return
  `{"cannotFix": true, "reason": "..."}` instead of guessing.
- Optional (P2): best-effort live schema grounding — inject a compact schema
  listing for the target object via `salesforceClient.fetchOrgSchema` /
  Tooling describe when the classification is `needs_schema`, so simple
  "field does not exist" cases become checkable. If the schema fetch fails,
  degrade to `needs_schema` with an honest reason.

```js
validateRepaired(xml, metadataType, filePath) -> throws with actionable message
```

Reuse `isWellFormedXml` + `validateCustomFieldXml` from
`backend/src/orgforge/utils/aiSafety.js` (same guards `generateMetadata` uses).

### 2.3 P1 — Bounded repair loop in `orgEngine.js` step 5

On dry-run failure (`status.status !== 'Succeeded'`):

1. `errors = normalizeDeployErrors(status)`; emit the existing failed `dry_run`
   card (payload now includes real `errors`).
2. `MAX_REPAIR_ATTEMPTS = 2`. Per attempt:
   - `classifyFailures(errors)` → if `fixable === false`, stop and explain
     (`limitation` + `reason`).
   - `repairArtifact(...)` → on `cannotFix`, stop and explain.
   - `validateRepaired(...)` → on throw, treat as another failure.
   - Re-assemble zip → `deployCheckOnly` → `pollDeploy`. Emit a
     `{ type: 'status', content: 'Repair attempt N of 2 — re-validating…' }`
     event per attempt so the chat shows progress.
3. Outcome → **enrich the existing `dry_run` card payload** with an additive
   `repair` field (the card was already emitted — emit a **second** `dry_run`
   card carrying the final `repair` payload, or better: emit the failed card
   once with `repair: { attempted: true, attempts, success, limitation,
   reason }` at the end so the widget has one coherent payload — see §4.1 for
   the exact shape). The frontend renders the last `dry_run` card.
   - Success → emit `{ type: 'status', content: 'Auto-repaired and re-validated — continuing.' }`, continue to step 6 (deploy). **No gate re-evaluation needed**: REF-02's evidence *is* the successful check-only deploy, and the other gates already passed.
   - Failure → `deploy_warning` with the plain-language reason from the
     taxonomy + the errors; return `{ role: 'assistant', content: <reason> }`.
4. **Telemetry:** write the failure + repair trace to `orgforge.ai_logs`
   (reuse `packages/ai/src/aiLogs.js` `writeAiLog` where possible; else direct
   insert like `deployments.js`) with `dry_run_errors` = errors and
   `ai_repair_attempts` = the **actual** attempt count. Fix the hardcoded
   `ai_repair_attempts: 1` in `deployments.js` to a real counter when the
   workspace repair loop (§2.4) reports it.

### 2.4 Workspace endpoint — `POST /api/v1/deployments/repair` (additive)

Same route file (`backend/src/orgforge/routes/deployments.js`), zod schema
mirroring `dryRunSchema` + optional `changeSetId`:

```ts
{ orgId, artifacts: Artifact[], changeSetId?: string }
// 200 → { artifacts: Artifact[], repair: { attempted, success, limitation?, reason? } }
```

Flow: classify → repair each failing artifact → validate → **return the
repaired artifacts to the caller without re-running the dry-run** (the
workspace re-runs Stage 7 with the repaired set so the operator sees the
validation result in the normal panel). Errors: `400` with the limitation
reason when `cannotFix`; route errors handled by the existing
`handleRouteError`.

---

## 3. Frontend design

### 3.1 Chat widget — `frontend/src/components/chat/OrgChangeCard.tsx`

Extend the `dry_run` branch. Payload contract (additive — old payloads render
unchanged):

```ts
{
  deploymentId, status, success, errors: [{component?, problem}],
  repair?: {
    attempted: boolean;
    attempts?: number;
    success: boolean;
    limitation?: 'needs_schema'|'dependency'|'human_decision'|'org_constraint'|'unsupported'|'unknown';
    reason?: string;
    summary?: string;
  }
}
```

Render, under the existing error list:

- **`repair.attempted && repair.success`** → green section (CheckCircle2,
  `brand-pass`): "**Auto-repaired & re-validated**" — `attempts` count, note
  that the final artifacts are captured in the signed audit record.
- **`repair.attempted && !repair.success`** → amber section
  (ShieldAlert/AlertTriangle, `brand-warning`): "**I couldn't auto-repair
  this.**" + the taxonomy plain-language `reason` (the honest limitation) +
  raw `errors` list (already rendered) + actions:
  - **Fix with AI & retry** button → `startChat('Fix the dry-run errors for <artifactName> and retry.')`
    (reuses the existing `startChat(overridePrompt)` path in
    `frontend/src/app/(app)/chat/page.tsx` — same deep-link mechanism as
    StarterCards; session context preserves the intent).
  - **Open in Advanced Workspace** link → `/workspace` (hand-edit path).
- **`repair.attempted === false`** (e.g. `GOOGLE_AI_API_KEY` unset / live
  Salesforce unavailable) → gray/info section: "**Auto-repair unavailable**" +
  `reason` (from the engine's existing `gap()` wording).

### 3.2 Toast (optional but cheap)

`useToast().warning('Dry run failed', reason)` on failure — the chat page is
not currently inside a `ToastProvider` (dashboard + workspace wrap their own).
Wrap the chat page in `ToastProvider` (workspace-page pattern, Pass 26) so the
toast fires once per failed run. The in-card widget is the primary surface;
the toast is the transient notification. Respect `prefers-reduced-motion`
(framer-motion `AnimatePresence` already does).

### 3.3 Workspace — `frontend/src/components/deployment/DryRunPanel.tsx`

In the failure branch, add a **"Repair with AI"** button (Wrench/Wand icon)
next to "Retry Validation":

1. `POST /api/v1/deployments/repair` with the current `artifacts`.
2. On success: show the repaired artifacts in the existing ArtifactViewer-style
   list (or a diff view), then **auto re-run** `handleRunDryRun` with the
   repaired set so Stage 7 shows the real validation result.
3. On `cannotFix`: render the limitation reason in the existing `ErrorBanner`
   details (title "Couldn't auto-repair") — no retry loop on broken artifacts.

Keep the operator-review gate intact: repaired artifacts are visible before any
"Proceed to Rollback Snapshot" → live deploy.

---

## 4. Files touched

| File | Change |
|---|---|
| `backend/src/engines/orgEngine.js` | `normalizeDeployErrors`; bounded repair loop in step 5; enriched `dry_run` payload; telemetry |
| `backend/src/orgforge/services/dryRunRepairer.js` | **new** — classify / repair / validate |
| `backend/src/orgforge/routes/deployments.js` | `POST /repair`; real `ai_repair_attempts` |
| `backend/src/orgforge/services/aiOrchestrator.js` | optional `repairMetadata` (or live inside repairer via `generateContent`) |
| `backend/src/orgforge/services/salesforceClient.js` | P2 only: expose schema fetch for repair grounding (already has `fetchOrgSchema`) |
| `frontend/src/components/chat/OrgChangeCard.tsx` | `repair` widget in dry_run branch |
| `frontend/src/app/(app)/chat/page.tsx` | `ToastProvider` wrap + "Fix with AI & retry" handler |
| `frontend/src/components/deployment/DryRunPanel.tsx` | "Repair with AI" flow |
| `tasks/todo.md` / `tasks/remaining_tasks.md` | pass tracker entries |

## 5. Tests

- `dryRunRepairer.test.js` — classification table (each keyword class),
  `cannotFix` on schema-class failures, repair returns valid XML, validate
  rejects malformed / bad enum, bounded attempts.
- `orgEngine.test.js` — +4: real `componentFailures` shape maps into card
  errors; repair-success continues to deploy; repair-failure emits
  `limitation` + reason and stops pre-deploy; `cannotFix` path.
- `deployments.test.js` — +3: `POST /repair` 200 repaired set, 400 cannotFix,
  zod 400.
- Frontend — OrgChangeCard dry_run renders each repair outcome (fix / cannot /
  unavailable); DryRunPanel repair flow; tsc/lint/build.

## 6. Sequencing

1. **P0** error mapping + ai_logs telemetry (unblocks everything, fixes a
   visible bug today).
2. **P1** `dryRunRepairer` + chat loop + widget + workspace endpoint/panel.
3. **P2** live-schema grounding for `needs_schema` repairs (stretch — the
   honest `needs_schema` reason is the fallback until this lands).

## 7. Definition of done

- A dry-run failure in chat shows the real Salesforce errors and either
  **auto-repairs within 2 attempts** (then continues to deploy) or states the
  **honest limitation** (taxonomy reason) in the card + toast.
- Workspace Stage 7 offers Repair with AI; repaired artifacts are operator-
  reviewable before any live deploy.
- Every failed dry run (chat + workspace) lands in `orgforge.ai_logs` with the
  real `ai_repair_attempts`.
- Backend + frontend suites green; docs/trackers updated per repo convention.
