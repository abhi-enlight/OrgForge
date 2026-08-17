# OrgForge Nightly AI Judge & Self-Improvement Guide

The **Nightly AI Judge & Self-Improvement Engine** is an autonomous feedback loop that analyzes recent failure logs across both Agentforce agent builds and declarative Salesforce org metadata changes. It synthesizes concise, non-duplicate architectural rules and saves them to `orgforge.ai_lessons`, where both generation engines dynamically apply them to future runs.

---

## 1. How It Works

```
┌─────────────────────────────────────────────────────────────┐
│ 1. AI Logs Ingestion (Every 24 hours at 02:00 UTC)         │
│    Reads failure rows from `orgforge.ai_logs`               │
│    - Agentforce DSL / Apex / License errors                 │
│    - OrgForge Dry-Run / XML / Validation syntax errors      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Error Clustering (`clusterErrorLogs`)                    │
│    Groups repetitive error traces into distinct signatures   │
│    to minimize LLM token usage and prevent noise             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. LLM Synthesis with Anti-Duplication                      │
│    Sends error clusters + current active rules to Gemini    │
│    Synthesizes only net-new actionable architectural rules  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Lesson Persistence & Bounding (`orgforge.ai_lessons`)    │
│    Inserts new active rules; archives oldest if count > 25  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Bidirectional Dynamic Prompt Injection                   │
│    - Agentforce: Injected into agent system instruction      │
│    - OrgForge: Injected into metadata generation prompt     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Configuration & Environment Variables

The Nightly AI engine requires the following environment variables (set in `backend/.env` or Render environment):

| Variable | Description | Default / Recommended Value |
| :--- | :--- | :--- |
| `GOOGLE_AI_API_KEY` | **Required** Google Gemini API key | `AIzaSy...` |
| `GEMINI_MODEL` | Primary LLM model for generation & reasoning | `gemini-3.1-pro-preview` |
| `JUDGE_MODEL` | Fast LLM model for error evaluation & synthesis | `gemini-3.7-flash` (or `gemini-2.5-flash`) |
| `REDIS_URL` | Redis connection URL for BullMQ repeatable scheduler | `redis://localhost:6379` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key (grants write access to `orgforge.ai_lessons`) | `eyJhbGciOi...` |

---

## 3. How to Automatically Run This

There are three ways to run the Nightly AI self-improvement process automatically:

### Option A: Built-in BullMQ Worker (Default / In-Process)
When the backend API is running 24/7 on Render or a persistent server (`ORGFORGE_UNIFIED_API=on` and `REDIS_URL` configured), BullMQ registers a repeatable job at boot:
- **Queue Name:** `orgforge-self-improvement`
- **Cron Schedule:** `0 2 * * *` (02:00 UTC daily)
- **Worker:** [`backend/src/orgforge/jobs/selfImprovementJob.js`](../../backend/src/orgforge/jobs/selfImprovementJob.js)
- **Core Engine:** [`backend/src/lib/selfImprovement.js`](../../backend/src/lib/selfImprovement.js)

When starting the backend API service, the startup logs will output:
```
Scheduled nightly self-improvement job (02:00 daily).
```
*No external cron daemon or setup is required if your backend is running.*

---

### Option B: GitHub Actions Scheduled Cron (Serverless & Free — Recommended)
If you don't keep an always-on Redis worker or want an independent, serverless trigger, a pre-configured GitHub Actions workflow is provided in [`.github/workflows/nightly-ai.yml`](../../.github/workflows/nightly-ai.yml).

1. In your GitHub Repository, go to **Settings** -> **Secrets and variables** -> **Actions**.
2. Under **Repository secrets**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://<your-project>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: `eyJhbGciOi...`
   - `GOOGLE_AI_API_KEY`: `AIzaSy...`
3. The workflow will automatically trigger every night at `02:00 UTC`.
4. You can also manually trigger it anytime by clicking **Actions** -> **Nightly AI Self-Improvement** -> **Run workflow**.

---

### Option C: Render Cron Job (Managed Cloud)
If your backend is hosted on Render and you prefer a separate isolated job:
1. In the [Render Dashboard](https://dashboard.render.com), click **+ New** -> **Cron Job**.
2. Connect your repository and configure:
   - **Command:** `node backend/scripts/runNightlyAi.mjs`
   - **Schedule:** `0 2 * * *` (Daily at 02:00 UTC)
3. Add the environment variables from Section 2 (`GOOGLE_AI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, etc.).

---

## 4. Manual Execution & CLI Tooling

You can run, test, or inspect the Nightly AI engine on-demand using the workspace CLI tool:

### 1. Run Standard Daily Analysis (24h lookback):
```bash
npm run ai:nightly
```

### 2. Run with Custom Lookback Window (e.g. 48 hours):
```bash
node backend/scripts/runNightlyAi.mjs --lookback-hours 48
```

### 3. List All Currently Active & Archived Lessons:
```bash
node backend/scripts/runNightlyAi.mjs --list-lessons
```

### 4. Test Synthesis with a Sample Failure Trace:
Injects a sample Salesforce license restriction log into `orgforge.ai_logs` and executes the synthesis pass:
```bash
node backend/scripts/runNightlyAi.mjs --sample-fail
```

*Example CLI Output:*
```
🧪 Injecting sample failure trace into orgforge.ai_logs to test Nightly AI synthesis...
✅ Sample failure logged with ID: 8

🤖 Running OrgForge Nightly AI Self-Improvement (lookback: 24h)...

🎉 Successfully synthesized 1 new lesson(s):
   1. "When configuring Agentforce agents, never assign 'Modify All' or 'View All' permissions to standard objects like Case. Agent integration licenses do not support these broad permissions, resulting in LICENSE_LIMIT_EXCEEDED errors. Instead, provision explicit Read, Create, or Edit object-level permissions and utilize sharing rules or execution context for record-level access."

📚 Active AI Lessons in orgforge.ai_lessons:

 1. 🟢 [ACTIVE] (ID: 8b45d052-57e1-4792-a66c-d9e263f77f73)
    "When configuring Agentforce agents, never assign 'Modify All' or 'View All' permissions to standard objects like Case. Agent integration licenses do not support these broad permissions, resulting in LICENSE_LIMIT_EXCEEDED errors. Instead, provision explicit Read, Create, or Edit object-level permissions and utilize sharing rules or execution context for record-level access."
    Created: 8/17/2026, 10:25:29 AM
```

---

## 5. Pruning & Token Safety Policy

To keep AI prompts bounded and token-efficient:
1. **Rule Limit:** Total active lessons are capped at **25 active rules** (configurable via `maxActiveLessons`).
2. **Oldest-First Archiving:** When new rules are synthesized that cause the count to exceed 25, the oldest rules are automatically updated to `active: false`.
3. **Anti-Duplication:** Existing active rules are provided in the synthesis prompt to ensure identical failure modes never create redundant database rows.

---

## 6. Verifying Engine Integration

Both engines read from `orgforge.ai_lessons`:
- **Agentforce Engine (`agentEngine`):** Loads active rules via `fetchActiveLessons()` in [`aiOrchestrator.js`](../../backend/src/agentforge/services/aiOrchestrator.js) and injects them under `## LEARNED LESSONS FROM PAST FAILURES`.
- **OrgForge Engine (`orgEngine`):** Injects active rules into `generateMetadata()` in [`aiOrchestrator.js`](../../backend/src/orgforge/services/aiOrchestrator.js) under `CRITICAL LESSONS LEARNED FROM PAST FAILURES`.

Unit test suite covering the full self-improvement loop:
```bash
npm test -- backend/src/lib/selfImprovement.test.js
```
