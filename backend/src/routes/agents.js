import { Router } from 'express';
import { z } from 'zod';
import { createAuthMiddleware, tenantIsolation } from '@orgforge/auth';
import { getOrgCredentials } from '@orgforge/org-connections';
import { validateInstanceUrl } from '@orgforge/diagnostics';
import { isMissingTableError } from '../lib/isMissingTable.js';
import { forgeDb as forgeDbSingleton, publicDb as credsDbSingleton } from '../lib/supabaseClients.js';
import salesforceClient from '../agentforge/services/salesforceClient.js';

const paramsSchema = z.object({
  orgId: z.string().min(3).max(18), // Salesforce org id (tenant-scoped to req.user.id)
  refresh: z.enum(['1']).optional(), // bypass the forge.agents cache
});

// GET /:developerName/yaml — the AiAuthoringBundle developerName is a
// Metadata API fullName (unquoted), so it may contain dots etc. Cap it well
// above any real name; zod's max catches nonsense.
const yamlParamsSchema = z.object({
  developerName: z.string().min(1).max(200),
});
const yamlQuerySchema = z.object({
  orgId: z.string().min(3).max(18),
});

// Shared singletons from lib/supabaseClients.js — one connection pool per schema per process.

/**
 * Builds the unified agents router (plan §10.1, §12.4 / §6.4).
 *
 * GET /api/v1/agents?orgId=...  → read-only inventory of live Agentforce
 * agents (Metadata API listMetadata via the Agentforge SalesforceClient),
 * resolved with tenant-scoped credentials.
 *
 * The Agentforge SalesforceClient is a first-class module in this repo
 * (backend/src/agentforge, ported CJS->ESM) — imported statically at module load;
 * tests inject `listAgents`/`retrieveAgent` to avoid live Salesforce calls.
 *
 * Cache (S-2): GET is read-through over `forge.agents` — a fresh cached row
 * set short-circuits the live Salesforce call; a miss (or `?refresh=1`)
 * fetches live and writes through. A missing table (migration 008 not applied)
 * degrades to a plain live call; any OTHER cache error fails loudly.
 *
 * @param {object} [opts]
 * @param {object} [opts.authMiddleware] - injectable (tests)
 * @param {(db, userId, orgId, opts) => Promise<object>} [opts.getCredentials]
 * @param {(token: string, instanceUrl: string) => Promise<Array<object>>} [opts.listAgents]
 *   - overrides the lazy Agentforge client (tests)
 * @param {(developerName: string, token: string, instanceUrl: string) => Promise<{ yaml: string } | null>} [opts.retrieveAgent]
 *   - overrides the lazy Agentforge client for the YAML detail route (tests)
 * @param {() => object} [opts.forgeDbFactory] - forge-schema supabase client (agents cache)
 * @param {() => object} [opts.credsDbFactory] - DEFAULT-schema client for org_connections (credentials)
 */
export function createAgentsRouter({
  authMiddleware = createAuthMiddleware(),
  getCredentials = getOrgCredentials,
  listAgents,
  retrieveAgent,
  forgeDbFactory = () => forgeDbSingleton,
  credsDbFactory = () => credsDbSingleton,
} = {}) {
  const router = Router();
  const requireAuth = authMiddleware;

  let CachedClient = null;
  async function getSalesforceClient() {
    if (CachedClient) return CachedClient;
    CachedClient = salesforceClient;
    if (!CachedClient || typeof CachedClient.getAgents !== 'function') {
      const err = new Error('Agentforge SalesforceClient not found. Is the Agentforge engine present?');
      err.status = 503;
      throw err;
    }
    return CachedClient;
  }

  // Live path (default). Agentforge's getAgents logs + returns [] on failure —
  // accept that behavior; the empty-state UI covers it. A non-array result is
  // unexpected, so log it for debuggability (empty arrays are legit: orgs can
  // genuinely have no agents).
  const fetchAgents =
    listAgents ??
    (async (token, instanceUrl) => {
      const client = await getSalesforceClient();
      const result = await client.getAgents(token, instanceUrl);
      if (!Array.isArray(result)) {
        console.warn('[agents] engine returned a non-array result:', result);
        return [];
      }
      return result;
    });

  // YAML detail path (default). retrieveAgent does a Metadata API retrieve of
  // the AiAuthoringBundle (async zip job, ~3s polls) and returns the .agent
  // file text. Returns null when the bundle isn't retrievable (already
  // deleted, not an AiAuthoringBundle, etc.).
  const fetchAgentYaml =
    retrieveAgent ??
    (async (developerName, token, instanceUrl) => {
      const client = await getSalesforceClient();
      if (typeof client.retrieveAgent !== 'function') {
        const err = new Error('Agentforge SalesforceClient does not support agent retrieval');
        err.status = 503;
        throw err;
      }
      return client.retrieveAgent(developerName, token, instanceUrl);
    });

  // Read the forge.agents cache. `{missing: true}` means migration 008 is not
  // applied — the caller falls through to a live call. Any other error throws.
  async function readAgentsCache(db, userId, orgId) {
    const { data, error } = await db
      .from('agents')
      .select('developer_name, label, status, updated_at')
      .eq('user_id', userId)
      .eq('org_id', orgId);
    if (error) {
      if (isMissingTableError(error)) return { missing: true, rows: [] };
      throw new Error(`Agents cache read failed: ${error.message}`);
    }
    return {
      missing: false,
      rows: (data || []).map((r) => ({
        id: r.developer_name,
        developerName: r.developer_name,
        masterLabel: r.label || r.developer_name,
        name: r.label || r.developer_name,
      })),
    };
  }

  async function writeAgentsCache(db, userId, orgId, agents) {
    const { error } = await db
      .from('agents')
      .upsert(
        agents.map((a) => ({
          user_id: userId,
          org_id: orgId,
          developer_name: a.developerName,
          label: a.masterLabel,
          status: 'active',
        })),
        { onConflict: 'user_id, org_id, developer_name' }
      );
    // Wrap in a real Error (supabase-js returns raw error objects) so the
    // fail-loud path surfaces a proper message through next(err).
    if (error) throw new Error(`Agents cache write failed: ${error.message}`);
  }

  router.get('/', requireAuth, tenantIsolation, async (req, res, next) => {
    try {
      const parsed = paramsSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', issues: parsed.error.errors });
      }
      const { orgId, refresh } = parsed.data;

      // Resolve live Salesforce credentials for this (user, org) — every query
      // is tenant-scoped by requireAuth + the explicit userId (tenantIsolation
      // contract; RLS is not a backstop on service-role clients).
      // org_connections lives in the DEFAULT schema (the shared store the OAuth
      // flow writes) — NOT the forge schema — so credentials resolve via
      // credsDbFactory; forgeDbFactory is for the forge.agents cache only.
      const credsDb = credsDbFactory();
      const forgeDb = forgeDbFactory();
      let creds;
      try {
        creds = await getCredentials(credsDb, req.user.id, orgId);
      } catch (err) {
        if (err.status === 404) {
          return res.status(404).json({ error: 'Org connection not found' });
        }
        if (err.status === 401) {
          // ORG_RECONNECT_REQUIRED discriminates this 401 from a session-auth
          // 401: the user's app session is fine — only the Salesforce org
          // needs reconnecting (EC-10).
          return res.status(401).json({
            error: 'Reconnect this org. Salesforce access could not be refreshed',
            code: 'ORG_RECONNECT_REQUIRED',
          });
        }
        throw err;
      }

      // SSRF guard (review): the stored instance_url is attacker-influencable
      // via the link/re-link flow — never hit an arbitrary host. Same https+
      // allowlist validation the diagnostics preflight and chat/stream use.
      try {
        validateInstanceUrl(creds.instanceUrl);
      } catch (urlErr) {
        return res.status(400).json({ error: 'Org connection has an unsafe instance URL. Reconnect this org.' });
      }

      // ── Cache-first (S-2) — a fresh cached set short-circuits Salesforce ──
      if (!refresh) {
        const cached = await readAgentsCache(forgeDb, req.user.id, orgId);
        if (!cached.missing && cached.rows.length > 0) {
          return res.json({ agents: cached.rows, orgId, fetchedAt: new Date().toISOString(), cached: true });
        }
      }

      const raw = await fetchAgents(creds.accessToken, creds.instanceUrl);
      // Normalized, additive shape: keep Agentforge's field names and add the
      // UI-friendly `name` alias (masterLabel when present, else developerName).
      // Resolve developerName once, then let masterLabel/name fall back to it
      // (fullName-only shapes from the legacy client must still surface both).
      const agents = (Array.isArray(raw) ? raw : []).map((a) => {
        const developerName = a.developerName ?? a.fullName ?? a.id;
        return {
          id: a.id ?? developerName,
          developerName,
          masterLabel: a.masterLabel ?? developerName,
          name: a.masterLabel ?? developerName,
        };
      });

      // ── Write-through — missing table (pre-migration) degrades, anything
      //    else fails loudly (real DB bug must surface).
      try {
        await writeAgentsCache(forgeDb, req.user.id, orgId, agents);
      } catch (cacheErr) {
        if (isMissingTableError(cacheErr)) {
          console.warn('[agents] cache write skipped (migration 008 not applied?):', cacheErr.message);
        } else {
          throw cacheErr;
        }
      }

      return res.json({ agents, orgId, fetchedAt: new Date().toISOString(), cached: false });
    } catch (err) {
      next(err);
    }
  });

  // GET /:developerName/yaml — the generated .agent YAML for one agent (PRD
  // FR-5 "detail drawer with YAML"). Reads the AiAuthoringBundle via the same
  // tenant-scoped credentials as the list route; no cache (the bundle can
  // change on every deploy and the call is on-demand from a drawer).
  router.get('/:developerName/yaml', requireAuth, tenantIsolation, async (req, res, next) => {
    try {
      const parsedParams = yamlParamsSchema.safeParse(req.params);
      if (!parsedParams.success) {
        return res.status(400).json({ error: 'Validation failed', issues: parsedParams.error.errors });
      }
      const parsedQuery = yamlQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return res.status(400).json({ error: 'Validation failed', issues: parsedQuery.error.errors });
      }
      const { developerName } = parsedParams.data;
      const { orgId } = parsedQuery.data;

      const credsDb = credsDbFactory();
      let creds;
      try {
        creds = await getCredentials(credsDb, req.user.id, orgId);
      } catch (err) {
        if (err.status === 404) {
          return res.status(404).json({ error: 'Org connection not found' });
        }
        if (err.status === 401) {
          // ORG_RECONNECT_REQUIRED discriminates this 401 from a session-auth
          // 401: the user's app session is fine — only the Salesforce org
          // needs reconnecting (EC-10).
          return res.status(401).json({
            error: 'Reconnect this org. Salesforce access could not be refreshed',
            code: 'ORG_RECONNECT_REQUIRED',
          });
        }
        throw err;
      }

      // SSRF guard — same https allowlist as the list route.
      try {
        validateInstanceUrl(creds.instanceUrl);
      } catch (urlErr) {
        return res.status(400).json({ error: 'Org connection has an unsafe instance URL. Reconnect this org.' });
      }

      const result = await fetchAgentYaml(developerName, creds.accessToken, creds.instanceUrl);
      if (!result || typeof result.yaml !== 'string' || result.yaml.trim() === '') {
        return res.status(404).json({
          error: 'Agent bundle not found',
          detail: 'No AiAuthoringBundle YAML is retrievable for this agent. It may have been built outside Agentforce or deleted.',
        });
      }
      return res.json({ developerName, yaml: result.yaml });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const agentsRouter = createAgentsRouter();
