#!/usr/bin/env node
/**
 * A2 drive harness — the 10-stage operator workspace, end to end.
 *
 * Walks the full governed flow against the LIVE unified API (the same
 * endpoints the ported /workspace page calls) and verifies the tamper-evident
 * HMAC-SHA256 signature on the signed audit record (OrgForge Hard Rule 1 /
 * REF-10 signed-audit stage).
 *
 * Usage:
 *   node backend/scripts/driveWorkspaceFlow.mjs --jwt <SUPABASE_ACCESS_TOKEN> \
 *     [--org <orgId>] [--org-alias <alias>] [--base http://localhost:3001] \
 *     [--prompt "Add a validation rule to Opportunity"] \
 *     [--rationale "Demo run for A2"] \
 *     [--deploy]          # enable stages 7-10 (dry-run → deploy → signed record).
 *                         # Default: stops after the refusal gates (read-only).
 *     [--report <file>]   # write a machine-readable JSON audit trail of the run
 *                         # (written on success AND failure).
 *     [--timeout-ms 90000]
 *
 * Auth: --jwt (or FORGE_JWT env) is a Supabase access token. Alternatively
 * --email/--password signs in via the project's Supabase auth (reads
 * NEXT_PUBLIC_SUPABASE_URL / ANON key from api/.env).
 *
 * HMAC verification: HMAC_SECRET is read from api/.env. The signed payload is
 * `JSON.stringify(changeRecord)` produced by changeRecordService.assembleChangeRecord
 * (fixed key order, `signatureHash` added AFTER signing), so the script
 * recomputes the hash over that exact serialization and compares bytes.
 *
 * Exit codes: 0 = flow completed as expected (incl. a REFUSED gate in
 * read-only mode — governance held). 1 = hard failure. 2 = deploy blocked
 * (gates REFUSED while --deploy was requested).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(API_DIR, '.env');

// ── .env loader (no dependency — same convention as verifySchema.mjs) ────────
function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i === -1) continue;
    const k = trimmed.slice(0, i).trim();
    let v = trimmed.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = loadEnv(ENV_PATH);

// ── args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { base: 'http://localhost:3001', deploy: false, timeoutMs: 90_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--jwt') args.jwt = val();
    else if (a === '--email') args.email = val();
    else if (a === '--password') args.password = val();
    else if (a === '--org') args.orgId = val();
    else if (a === '--org-alias') args.orgAlias = val();
    else if (a === '--base') args.base = val();
    else if (a === '--prompt') args.prompt = val();
    else if (a === '--rationale') args.rationale = val();
    else if (a === '--timeout-ms') {
      const n = Number(val());
      args.timeoutMs = Number.isFinite(n) && n > 0 ? n : 90_000;
    } else if (a === '--deploy') args.deploy = true;
    else if (a === '--ack-destructive') args.ackDestructive = true;
    else if (a === '--report') args.report = val();
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { throw new StageError(`Unknown argument: ${a}`); }
  }
  if (args.selfTest) return args; // no-org smoke — no auth required
  if (!args.jwt && !args.email) {
    args.jwt = process.env.FORGE_JWT || '';
  }
  if (!args.jwt && !args.email) {
    throw new StageError('Provide a Supabase access token via --jwt (or FORGE_JWT), or --email/--password.');
  }
  return args;
}

function printHelp() {
  console.log(`
A2 drive harness — 10-stage operator workspace against the live API.

  node backend/scripts/driveWorkspaceFlow.mjs --jwt <token> [options]

Options:
  --jwt <token>          Supabase access token (or set FORGE_JWT)
  --email / --password   sign in via Supabase auth instead of --jwt
  --org <orgId>          target org by id (default: first org returned by /api/v1/orgs)
  --org-alias <alias>    target org by alias instead of id (e.g. my-sandbox-dev-ed)
  --base <url>           API base (default http://localhost:3001)
  --prompt <text>        intent prompt (default: a safe sandbox demonstration)
  --rationale <text>     business rationale
  --deploy               enable stages 7-10 (dry-run → backup → deploy → audit).
                         Without it the run stops after the refusal gates.
                         NOTE: intent/generate/impact/gates still persist Forge-side
                         change_intents rows — only the target org is never written.
  --ack-destructive      allow the deploy when the rollback snapshot flagged the
                         change as destructive (requires --deploy).
  --report <file>        write a machine-readable JSON audit trail of the run to
                         <file> — stages, outcome, verification, and record ids
                         (written on success AND failure).
  --self-test            no-org smoke: sign + verify a sample record locally.
  --timeout-ms <n>       per-request timeout (default 90000)

Stages: 1 Connect · 2 Intent · 3 Clarify · 4 Generate XML · 5 Impact ·
        6 Refusal Gates · 7 Dry-Run · 8 Rollback Snapshot · 9 Deploy ·
        10 Signed Audit (HMAC-SHA256 verification)
`);
}

// ── small helpers ─────────────────────────────────────────────────────────────
const log = {
  stage(n, title) {
    console.log(`\n── Stage ${n}: ${title} ${'─'.repeat(Math.max(2, 60 - title.length - n.toString().length))}`);
  },
  ok(msg) { console.log(`   ✔ ${msg}`); },
  warn(msg) { console.log(`   ⚠ ${msg}`); },
  fail(msg) { console.log(`   ✖ ${msg}`); },
};

class StageError extends Error {
  constructor(message, { code = 1, detail } = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getToken(args) {
  if (args.jwt) return args.jwt;
  // Email/password sign-in through the project's Supabase.
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: args.email,
    password: args.password,
  });
  if (error || !data.session) {
    throw new StageError(`Supabase sign-in failed: ${error?.message || 'no session'}`);
  }
  return data.session.access_token;
}

async function api(args, token, method, urlPath, { body, timeoutMs = args.timeoutMs } = {}) {
  const url = `${args.base}${urlPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
    if (!res.ok) {
      const msg = parsed?.error || parsed?.message || `HTTP ${res.status}`;
      const err = new StageError(`HTTP ${res.status}: ${msg}`, { code: res.status === 401 ? 1 : 1, detail: parsed });
      err.status = res.status;
      throw err;
    }
    return parsed;
  } catch (err) {
    if (err.name === 'AbortError') throw new StageError(`Request timed out after ${timeoutMs}ms: ${method} ${urlPath}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Polls until `predicate` passes or the deadline elapses. */
async function pollUntil(deadlineMs, intervalMs, label, predicate) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result.done) return result.value;
    await sleep(intervalMs);
  }
  throw new StageError(`Timed out waiting for ${label}`);
}

/** Consumes the deployments status-stream (SSE) and returns frames up to a terminal status. */
async function consumeStatusStream(args, token, deploymentId, orgId) {
  const url = `${args.base}/api/v1/deployments/status-stream/${deploymentId}?orgId=${encodeURIComponent(orgId)}&access_token=${encodeURIComponent(token)}`;
  const controller = new AbortController();
  const streamTimeoutMs = Math.max(300_000, args.timeoutMs * 2); // deploys can take minutes
  const timer = setTimeout(() => controller.abort(), streamTimeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new StageError(`status-stream HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Normalize CRLF so \r\n\r\n frames split identically to \n\n.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let parsed;
        try { parsed = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (parsed.status === 'Succeeded' || parsed.status === 'Failed' || parsed.status === 'Error') {
          return parsed;
        }
      }
    }
    throw new StageError('status-stream closed before a terminal status');
  } finally {
    clearTimeout(timer);
  }
}

// ── HMAC verification (byte-exact, mirrors changeRecordService.sign) ─────────
// Exportable for tests; mirrors assembleChangeRecord key order + sign().
export function verifyRecordSignature(changeRecord, secret) {
  if (!secret) {
    throw new StageError('HMAC_SECRET missing from api/.env — cannot verify the signed audit record');
  }
  const { signatureHash, ...payload } = changeRecord || {};
  if (!signatureHash || typeof signatureHash !== 'string') {
    throw new StageError('change record has no signatureHash — it was not signed');
  }
  const canonical = JSON.stringify(payload);
  const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  const ok = expected === signatureHash;
  if (ok) return { ok: true, expected, signatureHash, mode: 'exact' };
  // The SSE frame may re-serialize the record with a different key order
  // (JSON preserves insertion order, but reconstruction does not). Distinguish
  // key-order drift from real tampering with a sorted-key canonical fallback.
  const sortedKeys = Object.keys(payload).sort();
  const sortedCanonical = JSON.stringify(sortedKeys.map((k) => [k, payload[k]]));
  const sortedExpected = crypto.createHmac('sha256', secret).update(sortedCanonical).digest('hex');
  if (sortedExpected === signatureHash) {
    return { ok: true, expected, signatureHash, mode: 'sorted-keys' };
  }
  return { ok: false, expected, sortedExpected, signatureHash, mode: 'none' };
}

/**
 * Signs a record exactly the way changeRecordService does (for tests and the
 * --self-test mode): assemble the fixed key order, then HMAC-SHA256 over
 * JSON.stringify(payload) with the signature appended AFTER signing.
 */
export function signRecordForTest(record, secret) {
  const payloadString = JSON.stringify(record);
  const signatureHash = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
  return { ...record, signatureHash };
}

// ── org selection + audit report helpers ─────────────────────────────────────
/** Picks the target org by id, by alias, or the first connected org. */
export function pickOrg(list, { orgId, orgAlias } = {}) {
  if (orgId && orgAlias) {
    throw new StageError('Specify only one of --org / --org-alias');
  }
  if (orgId) {
    const needle = String(orgId);
    const found = list.find((o) => String(o.id) === needle);
    if (!found) {
      throw new StageError(
        `No connected org with id "${orgId}". Available: ${list.map((o) => `${o.id}${o.alias ? ` (${o.alias})` : ''}`).join(', ') || 'none'}`
      );
    }
    return found;
  }
  if (orgAlias) {
    const needle = String(orgAlias).toLowerCase();
    const found = list.find((o) => String(o.alias || '').toLowerCase() === needle);
    if (!found) {
      throw new StageError(
        `No connected org with alias "${orgAlias}". Available aliases: ${list.map((o) => o.alias || '(no alias)').join(', ') || 'none'}`
      );
    }
    return found;
  }
  return list[0];
}

/** Initial audit report with run metadata (filled in as stages complete). */
export function createReport(args) {
  return {
    schemaVersion: 1,
    tool: 'driveWorkspaceFlow.mjs',
    generatedAt: new Date().toISOString(),
    args: {
      base: args.base,
      orgId: args.orgId ?? null,
      orgAlias: args.orgAlias ?? null,
      deploy: Boolean(args.deploy),
      ackDestructive: Boolean(args.ackDestructive),
      timeoutMs: args.timeoutMs ?? null,
      prompt: args.prompt ?? null,
      rationale: args.rationale ?? null,
    },
    org: null,
    stages: [],
    verification: null,
    record: null,
    outcome: null,
  };
}

/** Records a stage completion into the audit report. */
export function recordStage(report, n, title, status, detail) {
  report.stages.push({ n, title, status, ...(detail ? { detail } : {}) });
}

/** Writes the audit report as JSON (creates parent dirs; throws on failure). */
export function writeReport(report, filePath) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return target;
}

// ── stage runners ─────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  // Pre-scan --report so even a usage error (unknown arg / missing JWT) still
  // leaves a machine-readable audit trail when one was requested.
  const reportPath = (() => {
    const i = argv.indexOf('--report');
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
  })();

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`\n✖ ${err.message}`);
    printHelp();
    if (reportPath) {
      try {
        const report = createReport({
          base: 'http://localhost:3001',
          orgId: null,
          orgAlias: null,
          deploy: false,
          ackDestructive: false,
        });
        report.outcome = { exitCode: 1, status: 'usage-error', error: err.message };
        const p = writeReport(report, reportPath);
        console.log(`report written: ${p}`);
      } catch (e) {
        console.error(`⚠ could not write report: ${e.message}`);
      }
    }
    process.exit(1);
  }

  // --self-test: no-org smoke — sign + verify a sample record locally.
  if (args.selfTest) {
    const secret = env.HMAC_SECRET || 'self-test-secret';
    const sample = {
      id: 'CR-self-test',
      changeSetId: 'cs',
      approverIdentity: 'ops@example.com',
      deploymentId: '0Af',
      gitCommitHash: 'local',
      intent: 'self-test',
      businessRationale: 'self-test',
      userId: 'u',
      orgId: '00D',
      changeIntentId: null,
      dryRunId: null,
      impactBrief: { blastRadiusClassification: 'Low' },
      gateResults: null,
      skillsUsed: [],
      artifacts: [],
      timestamp: new Date().toISOString(),
    };
    const signed = signRecordForTest(sample, secret);
    const v = verifyRecordSignature(signed, secret);
    console.log(v.ok ? `✔ self-test passed (${v.mode}) — HMAC toolchain OK` : '✖ self-test failed');
    process.exit(v.ok ? 0 : 1);
  }

  const report = createReport(args);
  let exitCode = 0;
  try {
    const token = await getToken(args);
    const secret = env.HMAC_SECRET;
    exitCode = await runFlow(args, token, secret, report);
  } catch (err) {
    exitCode = err.code ?? 1;
    console.error(`\n✖ A2 drive failed: ${err.message}`);
    if (err.detail) console.error('  detail:', JSON.stringify(err.detail).slice(0, 500));
    report.outcome = {
      exitCode,
      status: exitCode === 2 ? 'deploy-blocked' : 'failure',
      error: err.message,
      ...(err.detail !== undefined ? { errorDetail: err.detail } : {}),
    };
  } finally {
    if (args.report) {
      try {
        const p = writeReport(report, args.report);
        console.log(`\nreport written: ${p}`);
      } catch (e) {
        console.error(`⚠ could not write report: ${e.message}`);
      }
    }
  }
  process.exit(exitCode);
}

async function runFlow(args, token, secret, report) {
  const intentPrompt =
    args.prompt || 'Add a validation rule to Opportunity: prevent closing an Opportunity with amount below 10,000';
  const rationale = args.rationale || `A2 drive (${new Date().toISOString()}) — governance demonstration`;

  const record = {};

  // Stage 1 — connect + target org
  log.stage(1, 'Connect Org');
  const { orgs } = await api(args, token, 'GET', '/api/v1/orgs');
  const list = Array.isArray(orgs) ? orgs : [];
  if (list.length === 0) throw new StageError('No connected orgs for this user — connect a sandbox in the app first (Settings → Connections).');
  const target = pickOrg(list, { orgId: args.orgId, orgAlias: args.orgAlias });
  log.ok(`target org ${target.alias || target.id} (${target.type || 'unknown'}) @ ${target.instanceUrl}`);
  report.org = { id: target.id, alias: target.alias ?? null, type: target.type ?? null, instanceUrl: target.instanceUrl ?? null };
  recordStage(report, 1, 'Connect Org', 'ok', { orgId: target.id, alias: target.alias ?? null });

  // Stage 2 — intent
  log.stage(2, 'State Intent');
  const intentBody = await api(args, token, 'POST', '/api/v1/changes/intent', {
    body: { orgId: target.id, prompt: intentPrompt, businessRationale: rationale },
  });
  const intentId = intentBody.intentId;
  if (!intentId) throw new StageError('intent endpoint returned no intentId', { detail: intentBody });
  log.ok(`intent ${intentId}`);
  record.intent = intentBody.intent || intentPrompt;
  record.businessRationale = rationale;
  recordStage(report, 2, 'State Intent', 'ok', { intentId });

  // Stage 3 — clarify (only when the engine asks)
  const ambiguities = Array.isArray(intentBody.ambiguities) ? intentBody.ambiguities : [];
  if (ambiguities.length > 0) {
    log.stage(3, 'Clarify');
    const pick = ambiguities.find((a) => a.recommended) || ambiguities[0];
    log.warn(`${ambiguities.length} ambiguity(ies) — resolving with: ${pick.title}`);
    await api(args, token, 'POST', `/api/v1/changes/intent/${intentId}/clarify`, {
      body: { resolvedOption: pick.title },
    });
    log.ok(`clarified with “${pick.title}”`);
    recordStage(report, 3, 'Clarify', 'ok', { resolved: true, choice: pick.title });
  } else {
    log.stage(3, 'Clarify');
    log.ok('no ambiguities — proceeding directly to generation');
    recordStage(report, 3, 'Clarify', 'skipped', { resolved: false });
  }

  // Stage 4 — generate metadata artifacts
  log.stage(4, 'Generate XML');
  const gen = await api(args, token, 'POST', '/api/v1/changes/generate', {
    body: { intentId },
    timeoutMs: Math.max(args.timeoutMs, 120_000),
  });
  const artifacts = Array.isArray(gen.artifacts) ? gen.artifacts : [];
  if (artifacts.length === 0) throw new StageError('metadata generation returned no artifacts', { detail: gen });
  log.ok(`${artifacts.length} artifact(s): ${artifacts.map((a) => a.filePath).join(', ')}`);
  record.changeSetId = gen.changeSetId || intentId;
  recordStage(report, 4, 'Generate XML', 'ok', {
    artifactCount: artifacts.length,
    filePaths: artifacts.map((a) => a.filePath),
  });

  // Stage 5 — blast radius / impact
  log.stage(5, 'Analyze Impact');
  const impact = await api(args, token, 'POST', `/api/v1/impact/${intentId}/impact-brief`, {
    timeoutMs: Math.max(args.timeoutMs, 120_000),
  });
  log.ok(`blast radius: ${impact.blastRadiusClassification ?? 'unknown'} (${impact.dependencyImpact?.referencingComponentsCount ?? 0} referencing components)`);
  record.impactBrief = impact;
  recordStage(report, 5, 'Analyze Impact', 'ok', {
    blastRadius: impact.blastRadiusClassification ?? null,
    referencingComponents: impact.dependencyImpact?.referencingComponentsCount ?? 0,
  });

  // Stage 6 — refusal gates
  log.stage(6, 'Refusal Gates');
  const gates = await api(args, token, 'POST', '/api/v1/gates/evaluate', {
    body: { intentId, artifacts, productionMode: false },
    timeoutMs: Math.max(args.timeoutMs, 120_000),
  });
  const gateResults = Array.isArray(gates.results) ? gates.results : [];
  const refused = gateResults.filter((g) => g.outcome === 'REFUSED');
  record.gateResults = gateResults.map((g) => ({ gateCode: g.gateCode, outcome: g.outcome, plainLanguageReason: g.plainLanguageReason }));
  const gateSummary = {
    gateOutcome: gates.gateOutcome ?? null,
    total: gateResults.length,
    passed: gateResults.filter((g) => g.outcome === 'PASS').length,
    refused: refused.length,
  };
  if (gates.gateOutcome === 'REFUSED') {
    for (const g of refused) {
      log.fail(`${g.gateCode} ${g.name}: ${g.plainLanguageReason}`);
      if (g.unblockPath) log.warn(`   unblock: ${g.unblockPath}`);
    }
    recordStage(report, 6, 'Refusal Gates', 'refused', gateSummary);
    if (args.deploy) {
      report.outcome = { exitCode: 2, status: 'deploy-blocked' };
      console.error('\n✖ Gates REFUSED — deploy blocked by governance (REF-01..10). Unblock and re-run.');
      return 2;
    }
    report.outcome = { exitCode: 0, status: 'governance-held' };
    log.warn('governance held — stopping before any deploy (pass --deploy to attempt stages 7–10)');
    return 0;
  }
  recordStage(report, 6, 'Refusal Gates', 'ok', gateSummary);
  log.ok(`all ${gateResults.length} gates PASS`);

  // ── Governance held here unless --deploy ─────────────────────────────────
  if (!args.deploy) {
    console.log('\n── Summary ────────────────────────────────────────────────');
    log.ok('Stages 1–6 complete: intent → generate → impact → all refusal gates PASS.');
    log.warn('Read-only mode: add --deploy to run the dry-run, rollback snapshot, live deploy, and signed audit.');
    report.outcome = { exitCode: 0, status: 'read-only-complete' };
    return 0;
  }

  // Stage 7 — MDAPI dry-run (checkOnly)
  log.stage(7, 'Dry-Run Check');
  const dry = await api(args, token, 'POST', '/api/v1/deployments/dry-run', {
    body: { changeSetId: intentId, orgId: target.id, artifacts },
    timeoutMs: Math.max(args.timeoutMs, 120_000),
  });
  const dryRunId = dry.deploymentId;
  log.ok(`dry-run started: ${dryRunId}`);
  const dryStatus = await pollUntil(10 * 60_000, 5000, 'dry-run completion', async () => {
    const s = await api(args, token, 'GET', `/api/v1/deployments/status/${dryRunId}?orgId=${encodeURIComponent(target.id)}`);
    if (s.status === 'Succeeded' || s.status === 'Failed') return { done: true, value: s };
    return { done: false };
  });
  if (dryStatus.status !== 'Succeeded') {
    throw new StageError(`dry-run ${dryStatus.status} — Salesforce rejected the change set`, { detail: dryStatus.componentFailures });
  }
  log.ok('dry-run Succeeded (checkOnly passed)');
  record.dryRunId = dryRunId;
  recordStage(report, 7, 'Dry-Run Check', 'ok', { deploymentId: dryRunId, status: dryStatus.status });

  // Stage 8 — pre-change rollback snapshot
  log.stage(8, 'Rollback Snapshot');
  const backup = await api(args, token, 'POST', '/api/v1/deployments/backup', {
    body: { intentId, orgId: target.id, artifacts },
    timeoutMs: Math.max(args.timeoutMs, 120_000),
  });
  const retrieveId = backup.retrieveId;
  if (backup.isDestructive) {
    // REF-06: a destructive change needs an explicit rollback acknowledgement.
    if (!args.ackDestructive) {
      throw new StageError(
        'the change is destructive — pass --ack-destructive to proceed with the deploy (REF-06 rollback acknowledgement)',
        { code: 2 }
      );
    }
    log.warn('destructive change — rollback bundle captured; --ack-destructive given, proceeding');
  } else {
    log.ok('rollback snapshot captured');
  }
  const backupStatus = await pollUntil(10 * 60_000, 5000, 'rollback snapshot', async () => {
    const s = await api(args, token, 'POST', `/api/v1/deployments/backup/status/${retrieveId}`, {
      body: { intentId, orgId: target.id },
    });
    if (s.status === 'Succeeded' || s.status === 'Failed') return { done: true, value: s };
    return { done: false };
  });
  if (backupStatus.status !== 'Succeeded') {
    throw new StageError(`rollback snapshot ${backupStatus.status}`);
  }
  log.ok('rollback snapshot stored (pre-change archive)');
  recordStage(report, 8, 'Rollback Snapshot', 'ok', {
    retrieveId,
    isDestructive: Boolean(backup.isDestructive),
    status: backupStatus.status,
  });

  // Stage 9 — live deploy (SSE status stream carries the signed change record)
  log.stage(9, 'Deploy Change');
  if (!args.deploy) throw new StageError('internal: deploy ran without --deploy');
  const deploy = await api(args, token, 'POST', '/api/v1/deployments/execute', {
    body: {
      changeSetId: record.changeSetId,
      productionMode: false,
      artifacts,
      intent: record.intent,
      businessRationale: record.businessRationale,
      orgId: target.id,
      intentId,
      dryRunId,
      impactBrief: impact,
      gateResults: record.gateResults,
    },
    timeoutMs: Math.max(args.timeoutMs, 120_000),
  });
  const deployId = deploy.deploymentId;
  log.ok(`deploy started: ${deployId}`);
  const deployFinal = await consumeStatusStream(args, token, deployId, target.id);
  if (deployFinal.status !== 'Succeeded') {
    throw new StageError(`deploy ${deployFinal.status}: ${deployFinal.error || 'failed'}`);
  }
  const changeRecord = deployFinal.changeRecord;
  if (!changeRecord || !changeRecord.signatureHash) {
    throw new StageError('deploy succeeded but no signed change record was returned by the status stream');
  }
  record.changeRecord = changeRecord;
  record.deploymentId = deployId;
  log.ok(`deploy Succeeded — change record ${changeRecord.id}`);
  recordStage(report, 9, 'Deploy Change', 'ok', {
    deploymentId: deployId,
    status: 'Succeeded',
    changeRecordId: changeRecord.id,
  });

  // Stage 10 — signed audit: HMAC verification + DB cross-check
  log.stage(10, 'Signed Audit');
  const verified = verifyRecordSignature(changeRecord, secret);
  report.verification = { ok: verified.ok, mode: verified.mode, signatureHash: verified.signatureHash };
  if (!verified.ok) {
    log.fail(
      `signature mismatch: stored ${verified.signatureHash}, exact recompute ${verified.expected}, sorted-key ${verified.sortedExpected}`
    );
    throw new StageError('HMAC verification FAILED — the change record does not match its signature (tamper-evident check)');
  }
  if (verified.mode === 'sorted-keys') {
    log.warn('signature verified via sorted-key canonical form (SSE re-serialized the record — key order differed)');
  } else {
    log.ok('HMAC-SHA256 signature verified (byte-exact)');
  }
  log.ok(`signature: ${verified.signatureHash.slice(0, 24)}…`);

  // Persistence cross-check: the record must be queryable from /change-records.
  const listRes = await api(args, token, 'GET', `/api/v1/change-records?orgId=${encodeURIComponent(target.id)}&limit=5`);
  const persisted = Array.isArray(listRes.records) ? listRes.records.find((r) => r.deploymentId === deployId) : undefined;
  if (!persisted) {
    log.warn('deploy succeeded + signature verified, but the record is not yet visible via /change-records (check persistence / migration 008)');
  } else if (persisted.signatureHash !== verified.signatureHash) {
    log.fail(`persisted signature hash differs from the verified one (${String(persisted.signatureHash).slice(0, 24)}… vs ${verified.signatureHash.slice(0, 24)}…)`);
    throw new StageError('persistence cross-check FAILED — the stored row is not the record that was signed');
  } else {
    log.ok(`record persisted (${persisted.id}) with the same signature hash — audit row matches the signed record`);
    record.persistedId = persisted.id;
  }
  report.record = {
    changeRecordId: changeRecord.id,
    deploymentId: deployId,
    persistedId: record.persistedId ?? null,
  };
  recordStage(report, 10, 'Signed Audit', verified.ok ? 'ok' : 'failed', {
    mode: verified.mode,
    signatureHash: verified.signatureHash,
    persistedId: record.persistedId ?? null,
  });

  console.log('\n── A2 result ──────────────────────────────────────────────');
  log.ok('ALL 10 STAGES COMPLETE — signed audit record verified (HMAC-SHA256).');
  console.log(JSON.stringify({ orgId: report.org.id, intentId, deploymentId: deployId, record: record.persistedId }, null, 2));
  report.outcome = { exitCode: 0, status: 'success' };
  return 0;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  // main() handles its own errors (console + report + exit code) and always exits.
  main();
}

export { loadEnv };
