# OrgForge Deployment Guide

This guide provides step-by-step instructions for deploying the unified OrgForge platform. The architecture consists of a Next.js frontend (deployed on Vercel), a Node.js backend (deployed on Render), a Supabase PostgreSQL database, and a Redis instance for caching and job queues (BullMQ).

## 1. Database (Supabase)
OrgForge uses Supabase for PostgreSQL, Row-Level Security (RLS), and Authentication.

1. Create a new project on [Supabase](https://supabase.com).
2. Go to your project settings to retrieve your **Project URL**, **anon key**, and **service_role key**.
3. Apply all database migrations to your production instance:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
4. Set up authentication providers (e.g., Email, GitHub) in the Supabase Auth settings.
5. Under Auth Settings, set your **Site URL** to your planned Vercel frontend URL (e.g., `https://orgforge.vercel.app`).

## 2. Redis
Redis is used as a conversation store lock and for background job queues (BullMQ).

### Option A: Render Redis (Recommended for Render backend)
1. In your [Render Dashboard](https://dashboard.render.com), click **New** -> **Redis**.
2. Name your instance (e.g., `orgforge-redis`).
3. Choose your instance size and region (keep it in the same region as your backend for lowest latency).
4. Once created, copy the **Internal Redis URL**. You will use this for the backend configuration.

### Option B: Upstash Redis
1. Create a Redis database on [Upstash](https://upstash.com).
2. Copy the connection string (`rediss://...`) and keep it for the backend environment variables.

## 3. Backend API (Render)
The backend is a Node.js service that handles API routing, Agentforge logic, and OrgForge org-change pipelines.

1. In the Render Dashboard, click **New** -> **Web Service**.
2. Connect your GitHub repository and select the `orgforge` repo.
3. Configure the service:
   - **Environment**: Node
   - **Root Directory**: Leave blank (the workspace runs from the root)
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start:api`
4. Add the following **Environment Variables**:
   - `NODE_ENV`: `production`
   - `CORS_ORIGIN`: Your Vercel frontend URL (e.g., `https://orgforge.vercel.app`)
   - `FORGE_UNIFIED_API`: `on`
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key
   - `SALESFORCE_CLIENT_ID`: Your Salesforce Connected App Client ID
   - `SALESFORCE_CLIENT_SECRET`: Your Salesforce Connected App Client Secret
   - `SALESFORCE_REDIRECT_URI`: `https://your-render-app.onrender.com/api/v1/auth/salesforce/callback`
   - `ENCRYPTION_KEY`: A secure 64-hex-char string (generate via `openssl rand -hex 32`)
   - `HMAC_SECRET`: A secure random string (>=32 chars)
   - `GOOGLE_AI_API_KEY`: Your Gemini API Key
   - `GEMINI_MODEL`: `gemini-3.1-pro-preview`
   - `REDIS_URL`: The Redis URL from Step 2 (use the Internal URL if using Render Redis)
   - *(If using GitHub features, refer to the [GitHub App Setup Guide](docs/setup/github_app_setup.md) to obtain `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, etc.)*
5. Click **Deploy**.

## 4. Frontend Web (Vercel)
The frontend is a Next.js application that provides the unified OrgForge and Agentforge UI.

1. Go to [Vercel](https://vercel.com) and click **Add New** -> **Project**.
2. Import your GitHub repository.
3. In the project configuration:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend` (or leave blank if Vercel automatically detects the workspace; however, selecting the `frontend` folder or relying on standard Next.js monorepo detection is recommended).
   - **Build Command**: `npm run build:web` (if running from root) or `npm run build` (if root directory is set to `frontend`)
4. Add the following **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anonymous key
   - `NEXT_PUBLIC_FORGE_UNIFIED_FRONTEND`: `on` (enables canary unified UI features)
5. Click **Deploy**.

## 5. Post-Deployment Configuration
1. **Salesforce Connected App**: Update your Salesforce Connected App / ECA Callback URL to match the backend's `SALESFORCE_REDIRECT_URI` (e.g., `https://<your-render-app>.onrender.com/api/v1/auth/salesforce/callback`).
2. **CORS & Redirects**: Ensure that Vercel is communicating with Render correctly by double-checking the `CORS_ORIGIN` variable on Render.
3. **GitHub App (Optional)**: If you configured GitHub connections, update your GitHub App's Webhook URL and Callback URL to point to your new Render backend URL.
