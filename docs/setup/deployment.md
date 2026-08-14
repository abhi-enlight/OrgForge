# OrgForge Deployment Guide

This guide provides step-by-step instructions for deploying the unified OrgForge platform to production.

The architecture consists of:
- **Frontend Web**: Next.js 16 App Router (deployed on [Vercel](https://vercel.com))
- **Backend API & Workers**: Express 5 + BullMQ workers (deployed on [Render](https://render.com))
- **Database & Auth**: PostgreSQL with Row-Level Security (RLS) and Supabase Auth ([Supabase](https://supabase.com))
- **Queue & Cache**: Redis for conversation locks and BullMQ job queues ([Render Key Value](https://render.com) or [Upstash](https://upstash.com))

---

## 1. Database & Schema (Supabase)

OrgForge uses Supabase for PostgreSQL, Row-Level Security (RLS), and user authentication.

1. **Create Supabase Project:**
   - Create a project on [Supabase](https://supabase.com).
   - In **Project Settings** -> **API**, copy:
     - **Project URL** (`https://<project-ref>.supabase.co`)
     - **anon / public key**
     - **service_role key** (secret)

2. **Apply Migrations:**
   All 12 `orgforge.*` tables and RLS policies are created via the migrations in `supabase/migrations/` (008, 010, 011, 012, 013, 014).
   Apply them to your production database using either:
   - **Supabase CLI:**
     ```bash
     supabase link --project-ref <your-project-ref>
     supabase db push
     ```
   - **Supabase SQL Editor / MCP:** Run the migration files in numerical order:
     - `008_forge_schema.sql` (Core schema & RLS)
     - `010_forge_legacy_rpc.sql` (RPC functions)
     - `011_github_connections.sql` (GitHub App connections)
     - `012_forge_context_memory.sql` (Chat transcript & summary memory)
     - `013_forge_data_tables.sql` (Data tables & role GRANTs)
     - `014_change_records_agent_kind.sql` (Agent deploy audit trail)

3. **Verify Database Schema:**
   Verify all 12 tables and required columns by running the schema verifier from your terminal:
   ```bash
   SUPABASE_URL="https://<project-ref>.supabase.co" \
   SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>" \
   node backend/scripts/verifySchema.mjs
   ```
   *Expected output:* `🎉 All 12 orgforge.* tables exist with all required columns — schema is ready!`

4. **Configure Authentication:**
   - In **Authentication** -> **URL Configuration**, set:
     - **Site URL:** Your production frontend URL (e.g. `https://orgforge.vercel.app`)
     - **Redirect URLs:** Add `https://orgforge.vercel.app/**` and `http://localhost:3000/**`

---

## 2. Redis (Cache & Background Queues)

Redis is required for conversation busy-locks and BullMQ background workers.

### Option A: Render Key Value / Redis (Recommended if backend is on Render)
1. In the [Render Dashboard](https://dashboard.render.com), click **+ New** -> **Key Value** (Render's managed Redis-compatible store).
2. Name your instance (e.g. `orgforge-redis`).
3. Select your region (use the same region as your Backend Web Service for lowest latency).
4. Once provisioned, copy the **Internal Redis URL** / **Connection String** (`redis://red-...`).

### Option B: Upstash Redis
1. Create a serverless Redis database on [Upstash](https://upstash.com).
2. Copy the TLS connection URL (`rediss://default:...@...upstash.io:6379`).

---

## 3. Backend API & Workers (Render)

The backend is an Express 5 service that runs both the API routes and the BullMQ background workers.

1. In the [Render Dashboard](https://dashboard.render.com), click **New** -> **Web Service**.
2. Connect your GitHub repository (`abhi-enlight/OrgForge` or `enlightlab/el-ai-orgforge`).
3. Configure the service settings:
   - **Name:** `orgforge-api` (or preferred name)
   - **Environment:** `Node`
   - **Region:** Same region as your Redis instance
   - **Root Directory:** `backend` (or leave blank if running from monorepo root)
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add the following **Environment Variables**:

### Required Backend Environment Variables

| Variable | Description | Example / Recommended Value |
| :--- | :--- | :--- |
| `NODE_ENV` | Runtime environment mode | `production` |
| `PORT` | Listening port for the Express server | `3001` (or assigned automatically by Render) |
| `CORS_ORIGIN` | Allowed frontend origin URL(s), comma-separated | `https://orgforge.vercel.app` |
| `ORGFORGE_UNIFIED_API` | **Required** master switch to mount all capability routers & start workers | `on` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Secret Service-Role Key (bypasses RLS for backend workers) | `eyJhbGciOi...` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anonymous Public Key | `eyJhbGciOi...` |
| `SALESFORCE_CLIENT_ID` | Salesforce Connected App / ECA Consumer Key | `3MVG9...` |
| `SALESFORCE_CLIENT_SECRET` | Salesforce Connected App / ECA Consumer Secret | `A1B2C3D4...` |
| `SALESFORCE_REDIRECT_URI` | Salesforce OAuth callback endpoint | `https://your-api.onrender.com/api/v1/auth/salesforce/callback` |
| `ENCRYPTION_KEY` | 64-hex character key for Salesforce token encryption | Generate with `openssl rand -hex 32` |
| `HMAC_SECRET` | Secret key for cryptographic signing of change records (>=32 chars) | Generate with `openssl rand -hex 32` |
| `GOOGLE_AI_API_KEY` | Google Gemini API Key | `AIzaSy...` |
| `GEMINI_MODEL` | Primary LLM model for agent generation & metadata reasoning | `gemini-3.1-pro-preview` |
| `JUDGE_MODEL` | Fast LLM model for evaluations, judging & chat compression | `gemini-3.7-flash` |
| `REDIS_URL` | Redis connection URL for BullMQ workers & conversation locks | `redis://red-...` (Render) or `rediss://...` (Upstash) |

### Optional / Advanced Backend Environment Variables

| Variable | Description | Default / Example Value |
| :--- | :--- | :--- |
| `GEMINI_CLASSIFIER_MODEL` | Override model for chat intent classification | `gemini-3.7-flash` |
| `SF_API_VERSION` | Salesforce REST & Tooling API version | `v65.0` |
| `ORGFORGE_PACKAGE_ID` | OrgForge Connector SubscriberPackageId (033) | `033fj000000PqLBAA0` |
| `ORGFORGE_ECA_PACKAGE_VERSION_ID` | OrgForge Connector Package Version ID (04t) | `04tfj000000NNITAA4` |
| `CHAT_SESSIONS_RETENTION_DAYS` | Retention window for idle chat sessions (clamped 1–90 days) | `7` |
| `GITHUB_APP_ID` | GitHub App ID for automated audit trail repo logging | See [GitHub App Guide](docs/setup/github_app_setup.md) |
| `GITHUB_PRIVATE_KEY` | GitHub App PEM Private Key (multiline or base64) | See [GitHub App Guide](docs/setup/github_app_setup.md) |
| `GITHUB_CLIENT_ID` | GitHub App Client ID for OAuth flow | `Iv1...` |
| `GITHUB_CLIENT_SECRET` | GitHub App Client Secret | `ghs_...` |
| `GITHUB_APP_SLUG` | GitHub App public installation slug | `orgforge-audit-logger` |
| `ADMIN_USER` | HTTP Basic Auth username for internal diagnostics endpoints | `admin` |
| `ADMIN_PASS` | HTTP Basic Auth password for internal diagnostics endpoints | `<secure-password>` |
| `CRON_SECRET` | Secret token for securing external webhook/cron triggers | `<random-secret>` |

5. Click **Create Web Service**.

---

## 4. Frontend Web (Vercel)

The frontend is a Next.js 16 web application with server-side proxying and Tailwind CSS.

1. Go to [Vercel](https://vercel.com) and click **Add New** -> **Project**.
2. Import your GitHub repository (`abhi-enlight/OrgForge` or `enlightlab/el-ai-orgforge`).
3. Configure the project settings:
   - **Framework Preset:** `Next.js`
   - **Root Directory:** Click Edit and select `frontend`
   - **Build Command:** `npm run build` (default)
   - **Output Directory:** `.next` (default)
4. Add the following **Environment Variables**:

### Frontend Environment Variables

| Variable | Description | Example / Recommended Value |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | `https://your-project.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anonymous Public Key | `eyJhbGciOi...` |
| `BACKEND_URL` | Render API URL (used by Next.js rewrites in `next.config.ts`) | `https://your-api.onrender.com` |
| `NEXT_PUBLIC_BACKEND_URL` | Render API URL (fallback for browser fetch calls) | `https://your-api.onrender.com` |
| `NEXT_PUBLIC_SITE_URL` | Canonical frontend domain for OpenGraph & metadata | `https://orgforge.vercel.app` |
| `NEXT_PUBLIC_ORGFORGE_UNIFIED_FRONTEND` | Enables live client-side chat intent routing preview | `on` |

5. Click **Deploy**.

---

## 5. Post-Deployment Checklist

1. **Update Salesforce Connected App / ECA:**
   In Salesforce Setup -> **External Client Apps** (or Connected Apps):
   - Update the **Callback URL** to match your production backend:
     `https://<your-render-app>.onrender.com/api/v1/auth/salesforce/callback`

2. **Verify CORS & API Proxy:**
   - Open your Vercel URL (`https://orgforge.vercel.app`).
   - Open browser DevTools Network tab.
   - Navigate to `/api/v1/health` (proxied through Next.js) and verify it returns `{"status":"ok"}`.

3. **Verify Auth & DB Connection:**
   - Log in with email/password or create a test account.
   - Check that the session cookie refreshes cleanly and redirects to `/chat`.

4. **Verify Background Workers:**
   - In Render logs for `orgforge-api`, verify that BullMQ workers have started:
     `[workers] started 4 BullMQ workers (indexOrg, dependencyGraph, pollDeployment, selfImprovement, sessionCleanup)`
