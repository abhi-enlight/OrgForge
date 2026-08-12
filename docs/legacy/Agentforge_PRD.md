# Agentforge PRD (imported)

> **Source:** `../Agentforge/docs/PRD.md` — copied **verbatim** for the unified
> Forge docs set. This is the legacy product requirements document the
> **Agents** capability must satisfy. Compliance status lives in
> [`PRD_COMPLIANCE.md`](../PRD_COMPLIANCE.md).
>
> **Docs set (one product):** [`unification_plan.md`](../unification_plan.md) (design) · [`DECISIONS.md`](../DECISIONS.md) (decisions) · [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) (tracker) · [`api_contract.md`](../api_contract.md) (frozen API) · [`PRD.md`](../PRD.md) (unified requirements) · [`API.md`](../API.md) (reference) · [`APP_FLOW.md`](../APP_FLOW.md) (flows) · [`TECH_STACK.md`](../TECH_STACK.md) (stack) · [`DESIGN.md`](../DESIGN.md) (design system) · [`PHASE5_PLAN.md`](../PHASE5_PLAN.md) (phase 5)

---

# Agentforge: Product Requirements Document (PRD)

**Status:** Approved | **Version:** 6.0 | **Last Updated:** 2026-07-16

---

## 1. Executive Summary

### 1.1 Problem Statement
Building and deploying Salesforce Agentforce Agents traditionally requires developers to spend days writing Apex code, navigating complex Setup UI, and assembling strict XML and YAML files. This process is time-consuming, prone to manual syntax errors (especially with Winter '26 `AiAuthoringBundle` schema requirements), and creates a bottleneck for business teams wanting to rapidly deploy AI assistants.

### 1.2 Solution (Agentforge)
Agentforge is an autonomous AI builder that bridges generative AI and Salesforce metadata. It allows users to create fully functional Salesforce agents in minutes simply by typing a prompt or uploading a Product Requirements Document (PRD).

### 1.3 Target Audience
*   **Beginners (Admins):** Can type a prompt and watch a fully functional AI assistant deploy into their org without writing code.
*   **Pros (Architects & Developers):** Can leverage it as an advanced orchestration engine to scaffold complex `@InvocableMethod` Apex and `.agent` YAML configurations rapidly.

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
| :--- | :--- | :--- |
| **Speed to Value** | Time from prompt to deployed agent | < 5 minutes |
| **Error Reduction** | Deployment success rate on first pass (post self-healing) | > 95% |
| **Deflection Rate (Future)** | % of queries resolved by agent without human escalation | > 40% |
| **Adoption** | Number of agents deployed per org | > 3 within 30 days |

---

## 3. User Personas & Use Cases

### 3.1 Persona: The Salesforce Admin
**Needs:** To quickly build an agent that handles tier-1 support queries based on a new standard operating procedure.
**Use Case:** Uploads a PDF containing the SOP. Agentforge automatically parses the PDF, extracts the requirements, and builds an agent that can answer questions grounded in that specific document.

### 3.2 Persona: The Salesforce Developer
**Needs:** To integrate an agent with external HTTP callouts without manually writing wrapper classes and `RemoteSiteSetting` metadata.
**Use Case:** Prompts Agentforge to "Build an agent that checks external inventory via API." Agentforge handles the Apex callout, `@InvocableVariable` definitions, and XML compilation automatically.

---

## 4. Functional Requirements (Current v6.0)

*   **FR-1: Multimodal Ingestion:** The system must accept text prompts and image uploads (PNG, JPEG, WEBP) to translate visual diagrams/flowcharts into Salesforce Agents.
*   **FR-2: Document Parsing:** The system must parse complex `.pdf` and `.docx` PRDs and extract context to feed the LLM.
*   **FR-3: Agentforce DSL Compilation:** The system must generate valid `.agent` YAML compliant with the `salesforce/agentscript` schema, utilizing block scalars (`|`) to prevent string escaping errors.
*   **FR-4: Autonomous Self-Healing:** Upon receiving a compilation error from the Salesforce Metadata API, the system must feed the error back to the LLM and autonomously rewrite and redeploy the code up to 4 times.
*   **FR-5: Live Streaming UI:** The user interface must display the LLM's thought process and generation steps in real-time using Server-Sent Events (SSE).
*   **FR-6: Automatic Security Assignment:** The system must automatically inject the `Admin.profile` to grant the human administrator instant access to generated Apex classes and objects without a browser refresh. Simultaneously, it must dynamically assign the `Agentforge_Generated_Actions` Permission Set to the `Einstein Agent User` so the agent can execute the actions and query the custom objects.
*   **FR-7: Database Verification**: The AI builder must verify exact Salesforce object existence using `list_available_objects` before attempting any code construction or metadata deployment.
*   **FR-8: Robust Pre-Build Planning**: The tool pipeline enforces that the AI completes a comprehensive `dataModelAnalysis`, `edgeCaseAnalysis`, and `refusalLogic` within the `confirm_requirements` payload before unlocking construction.
*   **FR-9: Autonomous Orchestration**: The system must support autonomous multi-step orchestration by creating chained Apex actions and configuring reasoning instructions instead of prompting the user for manual Flow creations.
*   **FR-10: Token Refresh Self-Healing**: The Express backend must automatically recover the Salesforce `refresh_token` from expired JWTs, execute token exchanges in the background, and issue a new JWT seamlessly during active streams.

---

## 5. Non-Functional Requirements

*   **NFR-1 (Performance):** The UI must reflect streaming LLM responses within 200ms of generation.
*   **NFR-2 (Reliability):** The backend must gracefully handle Salesforce API rate limits and Gemini token limits without crashing, propagating errors cleanly to the frontend.
*   **NFR-3 (UX/UI):** The interface must utilize modern design principles (glassmorphism, smooth animations) and provide a progressive disclosure modal for data permissions, preserving the principle of least privilege.

---

## 6. Future Roadmap & Scope

### 6.1 Version 5: Visual Builder & Mock Data
*   **Visual Node-Based Builder Canvas:** A read-only (and eventually interactive) visual canvas using React Flow to map out YAML DSL Topics, Actions, and Transitions.
*   **Test Data Seeding:** 1-Click generation of synthetic mock records (Cases, Accounts) directly into the Salesforce org using JS libraries like Faker.js, complete with auto-cleanup capabilities.

### 6.2 Version 6: Enterprise SaaS Evolution
*   **Multi-Tenancy & Workspaces:** Isolated workspaces, Role-Based Access Control (RBAC), and environment management (Dev, UAT, Prod).
*   **Version Control & Rollbacks:** 1-click agent rollbacks and two-way sync with GitHub/GitLab.
*   **Advanced Analytics:** Dashboards for deflection rates, API token usage, and cost analysis.
*   **Monetization & Security:** Stripe integration for usage-based billing, SSO (SAML/Okta), and strict data residency compliance.
