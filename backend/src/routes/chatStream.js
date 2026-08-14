import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { createAuthMiddleware, tenantIsolation } from '@orgforge/auth';
import { forgeDb, publicDb as credsDbSingleton } from '../lib/supabaseClients.js';
import { routeIntent, createSseEnvelope, writeAiLog, describeImage as describeImageDefault } from '@orgforge/ai';
import {
  validateInstanceUrl,
  getDiagnostics as getDiagnosticsDefault,
  runPreFlightCheck as preFlightDefault,
} from '@orgforge/diagnostics';
import { getOrgCredentials } from '@orgforge/org-connections';
import { setupSse } from '../lib/sseEmitter.js';
import { isMissingTableError } from '../lib/isMissingTable.js';
import { appendChatSegment, getChatSession, buildSessionDigest } from '../lib/chatSessions.js';
import { isAllowedFile, extractFileText, buildPromptWithAttachment, buildImageParts as buildImagePartsDefault, MAX_FILE_BYTES } from '../lib/fileAttachments.js';
import { agentEngine } from '../engines/agentEngine.js';
import { orgEngine } from '../engines/orgEngine.js';

const bodySchema = z.object({
  message: z.string().min(1).max(50_000), // EC-28 zod cap, matches the engines
  orgId: z.string().min(3).max(18), // Salesforce org id (tenant-scoped to req.user.id)
  // Routed intent from a prior POST /api/v1/chat/route call — authoritative
  // when present. Absent ⇒ the stream classifies itself (defense in depth for
  // direct callers) and logs the decision to forge.routing_log.
  capability: z.enum(['agent', 'org_change', 'both', 'clarify']).optional(),
  // Why the client supplied `capability`. Client-routed turns are normally
  // NOT logged (the client made the decision), but a readiness-gate downgrade
  // is a BLOCKED agent send and must stay auditable: the server logs it as
  // the executed route (override_source 'readiness_gate').
  capabilitySource: z.enum(['client', 'readiness_gate']).optional(),
  pinned: z.enum(['agent', 'org_change', 'both', 'clarify']).optional(),
  sessionId: z.string().min(1).max(200).optional(),
});

// Shared singletons from lib/supabaseClients.js (forge schema + public schema).
// forgeDb  → routing_log, chat_sessions, ai_logs (forge schema, migration 008).
// credsDbSingleton → public.org_connections (the live OAuth credential store).

const CLARIFY_MESSAGE =
  'I need a bit more detail to route this request. Tell me whether you want to build or change a Salesforce agent, or make a change to your org configuration (fields, validation rules, permission sets…).';

/**
 * Cause-aware blocker copy for the agents-unavailable gate — mirrors the
 * frontend's `agentsUnavailableHint` so every surface names the SAME fix
 * (capability.agents is 'attention' for any blocker: connector package,
 * Agentforce/Einstein settings, or Einstein Agent license).
 */
function agentsGateReason(diag) {
  const c = diag?.checks || {};
  if (c.package?.installed === false) return 'Connector package missing. Install it to build agents';
  if (c.settings?.agentforceEnabled === false) return 'Enable Agentforce Agent and Einstein in Setup → Agentforce';
  if (c.license?.supported === false) return 'Einstein Agent license needed. See Settings';
  return 'Agent building needs setup';
}

/** Plain-JSON 403 body for a refused pure-agent request. */
function agentsUnavailableError(diag) {
  return `Agent building is unavailable in this org. ${agentsGateReason(diag)}. Org changes still work.`;
}

/**
 * Encodes the agents gate's cause into the routing_log `override_source` so
 * blocked sends are auditable WITHOUT a schema migration (routing_log has no
 * reason column — only override_source is free text):
 *   readiness_gate | readiness_gate:package_missing |
 *   readiness_gate:settings_disabled | readiness_gate:license
 */
function gateOverrideSource(diag) {
  const c = diag?.checks || {};
  if (c.package?.installed === false) return 'readiness_gate:package_missing';
  if (c.settings?.agentforceEnabled === false) return 'readiness_gate:settings_disabled';
  if (c.license?.supported === false) return 'readiness_gate:license';
  return 'readiness_gate';
}

// Legacy multer pipeline (Agentforge src/index.js): memory storage, 10MB cap,
// mime allowlist. Images pass the filter and go to Gemini as inlineData
// (agent) / a vision description (org_change) — Pass 21, api_contract §2.5.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (isAllowedFile(file)) return cb(null, true);
    cb(new Error('Invalid file type. Only PDF, DOCX, TXT, and MD files are permitted.'), false);
  },
});

function hashPrompt(message) {
  return createHash('sha256').update(message).digest('hex').slice(0, 32);
}

/**
 * The session's established capability — the newest non-clarify segment in the
 * spine. Drives the router's conversation-continuation fallback: a terse
 * follow-up (an answer to the assistant's question) routes to what the
 * conversation was already doing instead of being classified in isolation.
 * Handles both JSONB arrays and legacy string-encoded segments.
 *
 * @param {object|null} spine - a chat_sessions row from getChatSession
 * @returns {'agent'|'org_change'|'both'|null}
 */
function deriveLastCapability(spine) {
  let segments = spine?.capability_segments;
  if (typeof segments === 'string') {
    try {
      segments = JSON.parse(segments);
    } catch {
      segments = [];
    }
  }
  if (!Array.isArray(segments)) return null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const cap = segments[i]?.capability;
    if (cap && cap !== 'clarify') return cap;
  }
  return null;
}

/**
 * POST /api/v1/chat/stream (plan §10.1/§10.2) — the Copilot SSE endpoint.
 *
 * Takes a routed intent, hands off to the Agent engine (Agentforce
 * ConversationManager) and/or Org engine (OrgForge change pipeline), and
 * emits the unified SSE envelope (Agentforge's type vocabulary + additive
 * capability/card fields).
 *
 * Order of operations matters:
 *   0. attachment (multer)     → document text injected into the engine
 *      prompt; image/empty/parse-failure → 400 (plain JSON, pre-SSE)
 *   0.5 session spine read     → durable context memory (feeds the router's
 *      conversation-aware classification AND the engines' resume/digest)
 *   1. zod validate            → 400 (plain JSON, pre-SSE)
 *   2. resolve routed intent   → client capability is authoritative; else route
 *      WITH the session context (routing + ai_logs always see the RAW
 *      message, never the injection)
 *   3. single-flight check     → 409 (plain JSON, pre-SSE)
 *   4. resolve live credentials→ 401/404 "reconnect" (EC-10), pre-SSE
 *   5. SSE up, then engines    → all frames via the unified envelope
 *   `both` runs agent → org sequentially (EC-23).
 *
 * @param {object} [opts] - all injectable for tests
 * @param {object} [opts.authMiddleware]
 * @param {(message: string, opts?: object) => Promise<object>} [opts.route]
 * @param {object} [opts.agent] - agent engine (isBusy/runAgent/abort)
 * @param {object} [opts.org] - org engine (runOrgChange)
 * @param {(db, userId, orgId, opts) => Promise<object>} [opts.getCredentials]
 * @param {object} [opts.db] - forge-schema supabase client (routing_log/chat_sessions/ai_logs)
 * @param {object} [opts.credsDb] - DEFAULT-schema client for org_connections (the
 *   shared store the OAuth flow writes — NOT the forge schema; plan §9/D4)
 * @param {(req, res) => object} [opts.emit] - SSE emitter factory
 * @param {(log: object) => Promise<{ok?: true, missing?: true, error?: string}>} [opts.logTurn]
 *   - unified forge.ai_logs writer (fire-and-forget, never throws)
 * @param {(req, res, next) => void} [opts.uploadMiddleware] - multer `upload.single('file')`
 *   (injectable for tests; real one parses multipart bodies into req.file)
 * @param {(file: object) => Promise<{kind: 'text'|'image'|'none', text?: string}>} [opts.extractFile]
 * @param {(userPrompt: string, file: object, text: string) => string} [opts.buildPrompt]
 * @param {(opts: {db: object, userId: string, orgId: string, sessionId: string}) => Promise<object|null>} [opts.getSession]
 *   - reads the session spine (durable context memory). Best-effort: any
 *   failure degrades to "no memory", never breaks the chat.
 */
export function createChatStreamRouter({
  authMiddleware = createAuthMiddleware(),
  route = routeIntent,
  agent = agentEngine,
  org = orgEngine,
  getCredentials = getOrgCredentials,
  db = forgeDb,
  credsDb = credsDbSingleton,
  emit = setupSse,
  logTurn = writeAiLog,
  uploadMiddleware = upload.single('file'),
  extractFile = extractFileText,
  buildPrompt = buildPromptWithAttachment,
  buildImageParts = buildImagePartsDefault,
  describeImage = describeImageDefault,
  getDiagnostics = getDiagnosticsDefault,
  preFlight = preFlightDefault,
  getSession = getChatSession,
} = {}) {
  const router = Router();
  const requireAuth = authMiddleware;

  // Runs BEFORE the handler so upload errors stay plain JSON (pre-SSE, same
  // contract as zod 400s). MulterError (size/fields) → 400; the fileFilter's
  // allowlist rejection → 400 with its message (legacy parity); anything else
  // falls through to the unified error handler.
  const fileUpload = (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `File upload error: ${err.message}` });
      }
      if (err.message && err.message.includes('Invalid file type')) {
        return res.status(400).json({ error: err.message });
      }
      return next(err);
    });
  };

  // Appends capability segments to the session spine (§7.3). Missing table
  // (migration 008 pending) → warn + skip; any other error fails loudly via
  // the outer handler (sse.fail — the engine work already completed).
  const persistSegments = async (segments, userId, orgId, sessionId) => {
    for (const seg of segments) {
      const res = await appendChatSegment({
        db,
        userId,
        orgId,
        sessionId: sessionId || 'default',
        capability: seg.capability,
        engineRef: seg.engineRef,
        summary: seg.summary,
        // Durable context memory: the agent segment carries this turn's
        // bounded conversation snapshot (manager getContextSnapshot).
        transcript: seg.transcript,
        contextSummary: seg.contextSummary,
      });
      if (res?.missing) {
        console.warn('[chat/stream] chat_sessions skipped (migration 008 not applied?): table missing');
      }
    }
  };

  router.post('/', requireAuth, tenantIsolation, fileUpload, async (req, res) => {
    let sse = null;
    try {
      const parsed = bodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', issues: parsed.error.errors });
      }
      const { message, orgId, capability: routedCapability, capabilitySource, pinned, sessionId } = parsed.data;
      // Always tenant-scoped: the verified userId is embedded unconditionally so
      // a shared org can't cross-collide conversation sessions (orgId is not
      // unique per user).
      const sessionKey = `${req.user.id}|${orgId}|${sessionId || 'default'}`;

      // Shared routing_log writer (S-2): the audit trail for every routed
      // turn — classifier decisions AND readiness-gate blocks/downgrades. A
      // missing table (migration 008 pending) is skipped with a warning; ANY
      // other DB error fails loudly — a real DB bug must surface, not be
      // swallowed (same contract as the original classifier-path write).
      const logRouting = async (capability, overrideSource, confidence) => {
        try {
          const { error: logError } = await db.from('routing_log').insert({
            user_id: req.user.id,
            prompt_hash: hashPrompt(message),
            capability,
            confidence,
            override_source: overrideSource,
          });
          if (logError) {
            if (isMissingTableError(logError)) {
              console.warn('[chat/stream] routing_log skipped (migration 008 not applied?):', logError.message);
            } else {
              throw new Error(`routing_log write failed: ${logError.message}`);
            }
          }
        } catch (logErr) {
          if (isMissingTableError(logErr)) {
            console.warn('[chat/stream] routing_log skipped (migration 008 not applied?):', logErr.message);
          } else {
            throw logErr;
          }
        }
      };

      // ── 0. Attachment (legacy multer parity) ───────────────────────────
      // Documents: extracted text is injected into the ENGINE prompt (the
      // model reads the file). Images: the AGENT engine receives them as
      // Gemini inlineData parts; the ORG engine gets a vision description
      // injected as text (both resolved per-step below). Intent routing +
      // logging always keep the raw message. Unreadable/empty extractions are
      // explicit pre-SSE 400s (legacy sent a manual SSE error; the unified
      // route's pre-SSE errors are plain JSON).
      let enginePrompt = message;
      let image = null; // { base64, mimeType, originalname } from extractFile
      if (req.file) {
        let extracted;
        try {
          extracted = await extractFile(req.file);
        } catch (parseErr) {
          // Corrupt/unreadable document — a client error, pre-SSE 400 (legacy
          // sent a manual SSE error frame; the unified contract keeps pre-SSE
          // errors plain JSON).
          return res.status(400).json({
            error: `Failed to parse the attached file "${req.file.originalname}": ${parseErr.message}. Please try a different file format.`,
          });
        }
        if (extracted.kind === 'image') {
          image = extracted;
        } else if (!extracted.text) {
          return res.status(400).json({
            error: `Could not extract any text from "${req.file.originalname}". Please try a different file format.`,
          });
        } else {
          enginePrompt = buildPrompt(message, req.file, extracted.text);
        }
      }

      // ── 0.5 Durable context memory (read) ───────────────────────────────
      // Read this session's spine BEFORE routing: besides feeding the engines
      // (cold-start resume + prior-context digest below), the spine gives the
      // ROUTER the conversation it's routing INTO — without it, a terse
      // follow-up like "create new" (the user answering the agent's clarifying
      // questions) is classified in isolation and wrongly bounces back with
      // "I need a bit more detail to route this request" (the classifier
      // forgetting the conversation). Best-effort by design — a DB failure or
      // a missing table (migration 008 pending) degrades to "no memory" and
      // never breaks routing. The read is triple-filtered on (user_id, org_id,
      // session_id), so it can never surface another session's or another
      // user's conversation.
      let spine = null;
      try {
        // Same 'default' normalization as persistSegments so the memory read
        // always targets the same row the segments are written to.
        spine = await getSession({ db, userId: req.user.id, orgId, sessionId: sessionId || 'default' });
      } catch (spineErr) {
        console.warn('[chat/stream] session spine read failed — continuing without memory:', spineErr.message);
      }
      let spineTurns = [];
      if (spine?.transcript) {
        if (Array.isArray(spine.transcript)) spineTurns = spine.transcript;
        else if (typeof spine.transcript === 'string') {
          try {
            const parsed = JSON.parse(spine.transcript);
            if (Array.isArray(parsed)) spineTurns = parsed;
          } catch { /* non-JSON legacy value — no turns */ }
        }
      }
      const resumeCtx = {
        turns: spineTurns,
        summary: spine?.context_summary || null,
      };
      const sessionDigest = buildSessionDigest(spine);
      // Structured context for the router: the digest (for the classifier) +
      // the established capability (for the deterministic continuation
      // fallback in routeIntent).
      const routeContext = {
        digest: sessionDigest || '',
        lastCapability: deriveLastCapability(spine),
      };

      // ── 1. Resolve the routed intent ────────────────────────────────────
      let decision;
      if (routedCapability) {
        decision = { capability: routedCapability, confidence: 1, overrideSource: 'client' };
        // Client-routed turns are normally not logged (the client made the
        // decision), but a readiness-gate downgrade (frontend routed a `both`
        // request's org half away) is a BLOCKED agent send — it must stay on
        // the audit trail. Generic cause: the client's own readiness data
        // named the blocker in the warning the user saw.
        if (capabilitySource === 'readiness_gate') {
          await logRouting(routedCapability, 'readiness_gate', 1);
        }
      } else {
        decision = await route(message, { pinned, context: routeContext });
        await logRouting(decision.capability, decision.overrideSource, decision.confidence);
      }

      // ── 2. Single-flight — BEFORE SSE headers so 409 stays plain JSON ───
      // (async isBusy: the busy lock now lives in Redis — plan §7.3)
      if (
        (decision.capability === 'agent' || decision.capability === 'both') &&
        (await agent.isBusy(sessionKey))
      ) {
        return res.status(409).json({
          error: 'A request is already running in this conversation. Please wait for it to complete.',
        });
      }

      // ── 3. Live credentials (shared by both engines when `both`) ────────
      // Refresh failure → 401 → "Reconnect this org" (EC-10), same contract as
      // /api/v1/diagnostics. markDisconnected flags the org for the UI.
      let creds;
      try {
        creds = await getCredentials(credsDb, req.user.id, orgId, {
          onRefreshFailure: async () => {
            try {
              await credsDb
                .from('org_connections')
                .update({ disconnected_at: new Date().toISOString() })
                .eq('org_id', orgId)
                .eq('user_id', req.user.id);
            } catch (hookErr) {
              console.warn('[chat/stream] mark-disconnected hook failed:', hookErr.message);
            }
          },
        });
      } catch (err) {
        if (err.status === 404) return res.status(404).json({ error: 'Org connection not found' });
        if (err.status === 401) {
          // ORG_RECONNECT_REQUIRED discriminates this 401 from a session-auth
          // 401: the user's app session is fine — only the Salesforce org
          // needs reconnecting (EC-10). The frontend checks this code before
          // deciding to sign the user out.
          return res.status(401).json({
            error: 'Reconnect this org. Salesforce access could not be refreshed',
            code: 'ORG_RECONNECT_REQUIRED',
          });
        }
        throw err;
      }

      // SSRF guard (review): the stored instance_url is attacker-influencable
      // via the link/re-link flow — never let the engines hit an arbitrary
      // host. Same https+allowlist validation the diagnostics preflight uses.
      try {
        validateInstanceUrl(creds.instanceUrl);
      } catch (urlErr) {
        return res.status(400).json({ error: 'Org connection has an unsafe instance URL. Reconnect this org.' });
      }

      // ── 3.5 Agents-unavailable gate (defense in depth) ────────────────
      // The frontend disables the agent chip and routes away at send time,
      // but the server is authoritative: when the org's preflight
      // (server-cached, self-healing) says the agents capability is
      // 'attention' — Agentforce/Einstein settings, license, or provisioning
      // — an agent/both request must never reach the agent engine. `both`
      // keeps its org-change half (EC-23: the org half is still a valid
      // request) and is routed away to org_change with a warning frame; a
      // pure `agent` request is refused with a plain-JSON 403 (pre-SSE,
      // same contract as the single-flight 409). A diagnostics outage fails
      // OPEN — chat must not break because the gate couldn't verify (the
      // engine error bubble stays the last line of defense).
      let agentsGateNotice = null;
      if (decision.capability === 'agent' || decision.capability === 'both') {
        let diag;
        try {
          diag = await getDiagnostics({
            db,
            run: () => preFlight(creds.accessToken, creds.instanceUrl),
            userId: req.user.id,
            orgId,
          });
        } catch (gateErr) {
          console.warn('[chat/stream] agents gate — diagnostics failed, proceeding:', gateErr.message);
        }
        if (diag?.capability?.agents === 'attention') {
          if (decision.capability === 'both') {
            // Audit the downgrade BEFORE the decision is consumed: the org
            // half is what ran, so the log reflects the executed route.
            await logRouting('org_change', gateOverrideSource(diag), 1);
            decision = {
              capability: 'org_change',
              confidence: 1,
              reason: agentsGateReason(diag),
              overrideSource: 'readiness_gate',
            };
            agentsGateNotice = `Skipping the agent half. ${agentsGateReason(diag)}`;
          } else {
            // Audit the refused request (the message WAS agent intent), then
            // refuse — every blocked send leaves a routing_log row.
            await logRouting(decision.capability, gateOverrideSource(diag), 1);
            return res.status(403).json({ error: agentsUnavailableError(diag) });
          }
        }
      }

      // Re-check single-flight after the credential await — closes the
      // double-click-during-refresh window pre-SSE (clean 409, not a stream).
      if (
        (decision.capability === 'agent' || decision.capability === 'both') &&
        (await agent.isBusy(sessionKey))
      ) {
        return res.status(409).json({
          error: 'A request is already running in this conversation. Please wait for it to complete.',
        });
      }

      // ── 3.75 Durable context memory (consumed) ──────────────────────────
      // The spine read happened at 0.5 (before routing); here the engines
      // consume it: (a) the agent engine's cold-start resume (bounded
      // transcript + summary) and (b) the org engine's prior-context digest.
      // Best-effort by design — a missing table (migration 008 pending)
      // degrades to "no memory" and never breaks the chat.

      // ── 4. SSE up ───────────────────────────────────────────────────────
      sse = emit(req, res);
      sse.onClose(() => agent.abort(sessionKey));

      // Unified envelope with per-engine capability tagging. Unknown legacy
      // event types degrade to a status frame rather than killing the stream
      // (sse.js: invalid types rejected loudly, sanitized in prod).
      const send = (ev, capability) => {
        try {
          sse.send(createSseEnvelope({ ...ev, ...(capability ? { capability } : {}) }));
        } catch (envErr) {
          // Unknown legacy event type — degrade to status, keep the tag and stream.
          console.warn('[chat/stream] dropping unknown legacy event type:', ev?.type);
          sse.send(createSseEnvelope({
            type: 'status',
            content: ev?.content || '…',
            ...(capability ? { capability } : {}),
          }));
        }
      };

      // A `both` request downgraded by the agents gate — tell the user the
      // agent half was skipped (and why) before the org pipeline runs.
      if (agentsGateNotice) {
        send(
          { type: 'deploy_warning', content: agentsGateNotice, summary: 'Agent half skipped' },
          'org_change'
        );
      }

      if (decision.capability === 'clarify') {
        send({ type: 'status', content: 'Routing paused. Clarification needed.' });
        send({ type: 'message', content: CLARIFY_MESSAGE, summary: 'Clarification needed' });
        await persistSegments([{ capability: 'clarify', engineRef: 'router', summary: 'Clarification requested' }], req.user.id, orgId, sessionId);
        return sse.done();
      }

      // Session spine (§7.3 / S-2): one capability segment per engine step,
      // persisted AFTER all engine work so a persistence failure can never
      // block a deployment — it surfaces as an error frame instead.
      const segments = [];

      // Unified forge.ai_logs write (plan §3): fire-and-forget — writeAiLog
      // never throws, so a logging failure can never fail a user request (this
      // is the Agentforge logService contract; contrast with routing_log /
      // chat_sessions which are request-critical and fail loudly).
      const logTurnFor = (capability, extra) =>
        logTurn({
          db,
          userId: req.user.id,
          orgId,
          sessionId,
          capability,
          prompt: message,
          ...extra,
        });

      const agentStep = async () => {
        send({ type: 'status', content: 'Running in your Salesforce org…' }, 'agent');
        const stepStartedAt = Date.now();
        let aiResponse;
        try {
          aiResponse = await agent.runAgent({
            // Image → Gemini inlineData parts (legacy Agentforge parity:
            // `[{ text }, { inlineData }]`). Documents → the injected text
            // prompt. The agentEngine pre-inits fresh sessions with the string
            // part so the legacy toLowerCase schema scan can't crash.
            message: image ? buildImageParts(message, image) : enginePrompt,
            accessToken: creds.accessToken,
            instanceUrl: creds.instanceUrl,
            sessionKey,
            // Durable memory resume (applied only on a cold start — the
            // engine prefers its own Redis snapshot when one exists).
            resume: resumeCtx,
            onEvent: (ev) => send(ev, 'agent'),
          });
        } catch (err) {
          await logTurnFor('agent', {
            status: 'FAILED',
            errorCode: err.message,
            latencyMs: Date.now() - stepStartedAt,
          });
          throw err;
        }
        await logTurnFor('agent', {
          aiResponse: aiResponse?.content,
          status: 'SUCCESS',
          latencyMs: Date.now() - stepStartedAt,
        });
        // Agentforge renderer marker (legacy contract, preserved verbatim).
        // The agent segment carries this turn's durable context snapshot so
        // the spine reflects the conversation after every agent turn.
        const agentCtx = aiResponse?.context;
        if (aiResponse?.content?.includes('[SHOW_BUILD_WIDGET]')) {
          send({ type: 'build_widget', content: 'Select Agent' }, 'agent');
          segments.push({
            capability: 'agent',
            engineRef: 'agentforce',
            summary: 'Agent build started. Widget awaiting selection',
            transcript: agentCtx?.turns,
            contextSummary: agentCtx?.summary,
          });
        } else if (aiResponse?.content) {
          send({ type: 'message', content: aiResponse.content }, 'agent');
          segments.push({
            capability: 'agent',
            engineRef: 'agentforce',
            summary: aiResponse.content,
            transcript: agentCtx?.turns,
            contextSummary: agentCtx?.summary,
          });
        }
      };

      const orgStep = async () => {
        send({ type: 'status', content: 'Preparing org change pipeline…' }, 'org_change');
        const stepStartedAt = Date.now();
        let summary = null;
        // Image → vision description injected as document text (best-effort:
        // a describe failure OR an empty result degrades to the raw message
        // with an honest warning so the org pipeline still runs on the user's
        // own words). Governance note: this is a deliberate warn-and-continue
        // — the pipeline then generates/dry-runs/deploys off the degraded
        // context, with the refusal gates + dry run as the safety net. A
        // silent drop (empty description, no warning) would be worse than an
        // explicit one.
        let orgMessage = enginePrompt;
        if (image) {
          let description = '';
          try {
            description = await describeImage({
              base64: image.base64,
              mimeType: image.mimeType,
              hint: message,
            });
          } catch (describeErr) {
            console.warn('[chat/stream] image describe failed — proceeding without it:', describeErr.message);
          }
          if (description) {
            orgMessage = buildPrompt(message, { originalname: image.originalname }, description);
          } else {
            send(
              {
                type: 'deploy_warning',
                content: 'Could not analyze the attached image. Proceeding from the text request only.',
                summary: 'Image not analyzed',
              },
              'org_change'
            );
          }
        }
        try {
          await org.runOrgChange({
            message: orgMessage,
            sessionKey,
            creds,
            userId: req.user.id,
            orgId,
            // Cross-engine memory: a compact digest of what already happened
            // in THIS session (recent capability segments + context summary),
            // so "now do the same for Account" has the earlier turns in view.
            priorContext: sessionDigest || undefined,
            onEvent: (ev) => {
              if (ev.content && ['message', 'deploy_success', 'deploy_warning', 'record'].includes(ev.type)) {
                // Prefer the event's one-line summary (e.g. "Blocked by 2
                // refusal gates") so ai_logs / chat_sessions segments stay
                // concise instead of persisting a multi-line refusal dump.
                summary = ev.summary || ev.content;
              }
              send(ev, 'org_change');
            },
          });
        } catch (err) {
          await logTurnFor('org_change', {
            status: 'FAILED',
            errorCode: err.message,
            latencyMs: Date.now() - stepStartedAt,
          });
          throw err;
        }
        await logTurnFor('org_change', {
          aiResponse: summary,
          status: 'SUCCESS',
          latencyMs: Date.now() - stepStartedAt,
        });
        if (summary) {
          segments.push({ capability: 'org_change', engineRef: 'orgforge', summary });
        } else {
          segments.push({ capability: 'org_change', engineRef: 'orgforge', summary: 'Org change pipeline ran' });
        }
      };

      if (decision.capability === 'agent') {
        await agentStep();
      } else if (decision.capability === 'org_change') {
        await orgStep();
      } else {
        // both — sequential, agent first (EC-23). The handoff status is tagged
        // org_change so the frontend renders it as the org segment's opening
        // step (per-segment progress cards split on the capability tag).
        await agentStep();
        send(
          { type: 'status', content: 'Agent step done. Applying the org change next.' },
          'org_change'
        );
        await orgStep();
      }

      await persistSegments(segments, req.user.id, orgId, sessionId);

      return sse.done();
    } catch (err) {
      if (sse) {
        // Stream already started — error frame + [DONE] via the emitter so the
        // heartbeat is torn down too (legacy wire contract, §10.2).
        console.error('[chat/stream]', err);
        sse.fail('Critical backend failure.');
      } else if (err.status === 409) {
        return res.status(409).json({ error: err.message });
      } else {
        console.error('[chat/stream]', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  return router;
}

export const chatStreamRouter = createChatStreamRouter();
