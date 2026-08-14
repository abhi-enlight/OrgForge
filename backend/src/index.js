import 'dotenv/config';
import { createApp } from './app.js';

const PORT = process.env.PORT || 3001;

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

let app;
try {
  app = await createApp();
} catch (err) {
  // A mount failure with the flags explicitly ON is fatal — fail loudly so the
  // orchestrator restarts/reverts instead of serving a half-mounted API (plan
  // §14.1: rollback path defined before each deploy).
  console.error('[forge-api] FATAL — failed to build unified app:', err);
  process.exit(1);
}

process.on('uncaughtException', (err) => {
  console.error('FATAL: Uncaught Exception — shutting down:', err);
  process.exit(1);
});

// ── OrgForge background job workers (ported from the legacy backend) ──────
// The OrgForge routes enqueue BullMQ jobs (org indexing, deployment polling,
// dependency graph, self-improvement); without these in-process workers the
// jobs would queue forever. Gated on the same flag as the capability routers
// (ORGFORGE_UNIFIED_API=on) so the flag-off state stays fully inert. Workers
// retry their Redis connection in the background, so the API server still
// boots even if Redis is temporarily unavailable (same contract as the legacy
// index.js).
const orgForgeEnabled = process.env.ORGFORGE_UNIFIED_API === 'on';
if (orgForgeEnabled) {
  // Import for side effects — each worker file constructs its BullMQ Worker
  // (with its own error guard, see orgforge/workers.js) at module load.
  // A failure here is FATAL with the flag on: the capability routers would
  // keep enqueuing jobs that never run — a silently degraded API. Same
  // fail-loud pattern as the createApp() guard above (plan §14.1); worker
  // import errors are code/dependency problems, not transient Redis outages
  // (BullMQ retries its Redis connection in the background).
  try {
    await import('./orgforge/workers.js');
  } catch (err) {
    console.error('[forge-api] FATAL — failed to start OrgForge job workers:', err);
    process.exit(1);
  }

  // Nightly AI self-improvement loop (PRD Phase 4). BullMQ v5 manages
  // repeatable jobs natively — registration is idempotent (fixed jobId), so
  // restarts never stack duplicate schedules. A Redis outage at boot must not
  // crash the API server, hence try/catch (ported verbatim from the legacy
  // index.js).
  try {
    const { selfImprovementQueue } = await import('./orgforge/jobs/queue.js');
    await selfImprovementQueue.add('self-improvement', {}, {
      jobId: 'nightly-self-improvement',
      repeat: { pattern: '0 2 * * *' },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    console.log('Scheduled nightly self-improvement job (02:00 daily).');
  } catch (err) {
    console.warn('Failed to register nightly self-improvement job (non-fatal):', err.message);
  }

  // Daily chat_sessions expiry sweep (03:05, after the self-improvement run):
  // deletes spine rows idle longer than CHAT_SESSIONS_RETENTION_DAYS (default
  // 7) — orphaned by closed tabs, since session ids live in sessionStorage.
  try {
    const { sessionCleanupQueue } = await import('./orgforge/jobs/queue.js');
    await sessionCleanupQueue.add('session-cleanup', {}, {
      jobId: 'session-cleanup',
      repeat: { pattern: '5 3 * * *' },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    console.log('Scheduled session-cleanup job (03:05 daily, chat_sessions expiry).');
  } catch (err) {
    console.warn('Failed to register session-cleanup job (non-fatal):', err.message);
  }
}

const server = app.listen(PORT, () => {
  console.log(`[forge-api] unified OrgForge API listening on :${PORT}`);
});

export { app, server };
