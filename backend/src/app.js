import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

/**
 * Builds the unified Forge Express app. Factored out of index.js so tests can
 * construct the app without binding a port.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enableOrgForge] - override FORGE_UNIFIED_API flag
 * @returns {import('express').Express}
 */
export async function createApp(opts = {}) {
  const app = express();
  const enableOrgForge = opts.enableOrgForge ?? process.env.FORGE_UNIFIED_API === 'on';

  // ── Security middleware (OrgForge baseline, plan §8.5) ───────────────────
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  const corsOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000'];
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(morgan('combined'));

  // ── Health (liveness + forge.* DB readiness, plan §10.1) ───────────────────
  const { healthRouter } = await import('./routes/health.js');
  app.use('/api/v1/health', healthRouter);

  // ── Unified routes (Phase 1, always available) ────────────────────────────
  // NOTE: registered BEFORE the OrgForge /api/v1/auth mount below so
  // /api/v1/auth/link-legacy wins (Express matches in registration order).
  const { linkLegacyRouter } = await import('./routes/linkLegacy.js');
  app.use('/api/v1/auth/link-legacy', linkLegacyRouter);

  const { diagnosticsRouter } = await import('./routes/diagnostics.js');
  app.use('/api/v1/diagnostics', diagnosticsRouter);

  const { chatRouteRouter } = await import('./routes/chatRoute.js');
  app.use('/api/v1/chat/route', chatRouteRouter);

  const { chatStreamRouter } = await import('./routes/chatStream.js');
  app.use('/api/v1/chat/stream', chatStreamRouter);

  // DELETE /api/v1/chat/:contextId — explicit conversation reset (legacy
  // Agentforge parity, plan §10.1). Mounted AFTER the stream/route mounts so
  // those exact paths win in registration order; this router only handles
  // DELETE /:contextId (reserved names stream/route → 400).
  const { chatContextRouter } = await import('./routes/chatContext.js');
  app.use('/api/v1/chat', chatContextRouter);

  const { agentsRouter } = await import('./routes/agents.js');
  app.use('/api/v1/agents', agentsRouter);

  // GET /api/v1/refusal-logs — dedicated refusal audit trail (PRD FR-5 +
  // OrgForge Group 7). Tenant-scoped through change_intents (refusal_logs has
  // no user column); missing-table degrades to empty + note (S-3), other DB
  // errors fail loudly. Additive contract entry §2.8 (Pass 25).
  const { refusalLogsRouter } = await import('./routes/refusalLogs.js');
  app.use('/api/v1/refusal-logs', refusalLogsRouter);

  // ── Capability mounts (plan §5.1) ────────────────────────────────────────
  // OrgForge capability routers are first-class modules in this repo
  // (api/src/orgforge) — native imports, no out-of-repo path resolution.
  if (enableOrgForge) {
    console.log('[forge-api] mounting OrgForge capability routers (FORGE_UNIFIED_API=on)');
    try {
      const authRoutes = (await import('./orgforge/routes/auth.js')).default;
      const orgRoutes = (await import('./orgforge/routes/orgs.js')).default;
      const changesRoutes = (await import('./orgforge/routes/changes.js')).default;
      const gatesRoutes = (await import('./orgforge/routes/gates.js')).default;
      const deploymentsRoutes = (await import('./orgforge/routes/deployments.js')).default;
      const rollbackRoutes = (await import('./orgforge/routes/rollback.js')).default;
      const changeRecordsRoutes = (await import('./orgforge/routes/changeRecords.js')).default;
      const githubRoutes = (await import('./orgforge/routes/github.js')).default;
      const impactRoutes = (await import('./orgforge/routes/impact.js')).default;

      app.use('/api/v1/auth', authRoutes);
      app.use('/api/v1/auth/github', githubRoutes);
      app.use('/api/v1/orgs', orgRoutes);
      app.use('/api/v1/changes', changesRoutes);
      app.use('/api/v1/impact', impactRoutes);
      app.use('/api/v1/gates', gatesRoutes);
      app.use('/api/v1/deployments', deploymentsRoutes);
      app.use('/api/v1/rollback', rollbackRoutes);
      app.use('/api/v1/change-records', changeRecordsRoutes);
    } catch (err) {
      console.error('[forge-api] failed to mount OrgForge routers:', err.message);
      throw err; // flag explicitly requested the mount — fail loudly
    }
  } else {
    console.log('[forge-api] OrgForge capability routers NOT mounted (set FORGE_UNIFIED_API=on in Phase 2)');
  }

  // ── JSON 404 + sanitized error handler (OrgForge baseline) ───────────────
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation failed', issues: err.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
