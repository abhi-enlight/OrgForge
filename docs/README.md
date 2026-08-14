# OrgForge Documentation

Welcome to the documentation for **OrgForge** — the unified platform combining agent building (`Agentforge`) and Salesforce org governance (`OrgForge`).

## Documentation Map

### 📐 Architecture (`docs/architecture/`)
- [`unification_plan.md`](./architecture/unification_plan.md) — Unified platform design & master proposal.
- [`DECISIONS.md`](./architecture/DECISIONS.md) — Architectural decisions (D1–D8) and trade-offs.
- [`TECH_STACK.md`](./architecture/TECH_STACK.md) — Complete technology stack and environment variable specifications.
- [`APP_FLOW.md`](./architecture/APP_FLOW.md) — End-to-end data flow, SSE lifecycle, and execution models.
- [`DESIGN.md`](./architecture/DESIGN.md) — UI/UX design system, typography, colors, and layout guidelines.

### 🔌 API Reference (`docs/api/`)
- [`api_contract.md`](./api/api_contract.md) — Frozen `/api/v1` API contract (single source of truth for all endpoints).
- [`API.md`](./api/API.md) — Comprehensive API reference and endpoint documentation.

### 📋 Specifications & Compliance (`docs/specifications/`)
- [`PRD.md`](./specifications/PRD.md) — Primary product requirements document for the unified platform.
- [`PRD_COMPLIANCE.md`](./specifications/PRD_COMPLIANCE.md) — Requirements traceability matrix (48 OrgForge + 10 Agentforge FRs).
- [`IMPLEMENTATION_PLAN.md`](./specifications/IMPLEMENTATION_PLAN.md) — Master implementation plan, pass tracker, and progress log.
- [`FUTURE_IMPLEMENTATION.md`](./specifications/FUTURE_IMPLEMENTATION.md) — Index of next-version (Phase 6+) work — scheduled items with pointers to their self-contained plans.

### 🚀 Operations & Rollout (`docs/operations/`)
- [`PHASE5_PLAN.md`](./operations/PHASE5_PLAN.md) — Phase 5 rollout runbook (canary, soak metrics, legacy retirement).
- [`LANDING_REDESIGN_PLAN.md`](./operations/LANDING_REDESIGN_PLAN.md) — Landing page blueprint & visual overhaul plan.

### 🔧 Setup & Deployment (`docs/setup/`)
- [`deployment.md`](./setup/deployment.md) — Comprehensive production deployment runbook (Vercel, Render, Supabase, Redis).
- [`packaged_eca_setup.md`](./setup/packaged_eca_setup.md) — Installing the OrgForge Connector package (install links, access grants, verification, troubleshooting).
- [`github_app_setup.md`](./setup/github_app_setup.md) — GitHub App setup guide for automated git audit trail logging.

### 📁 Archived / Legacy (`docs/legacy/`)
- [`Agentforge_PRD.md`](./legacy/Agentforge_PRD.md) — Historical Agentforge PRD v6.0.
- [`OrgForge_PRD.md`](./legacy/OrgForge_PRD.md) — Historical OrgForge PRD v1.0.
