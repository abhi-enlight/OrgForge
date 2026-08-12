/**
 * Feature flags (plan §14.2).
 *
 * `FORGE_UNIFIED_FRONTEND` is the CANARY gate: when `on`, the unified app's
 * canary-only affordances are enabled — today that is the stub rule-based
 * routing preview in the Copilot capability chip (plan §14.2 Phase 1: "stub
 * classifier (rule-based only) — UX in place, zero AI risk").
 *
 * Default `off`: the app ships with no canary affordances (old behavior).
 * This is a deploy-time knob (Vercel env var) for the canary group only —
 * it is inlined at build time, so it must be set before `next build`.
 */
export const FORGE_UNIFIED_FRONTEND = process.env.NEXT_PUBLIC_FORGE_UNIFIED_FRONTEND === 'on';
