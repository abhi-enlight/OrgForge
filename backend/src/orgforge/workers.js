/**
 * OrgForge background job workers (native port — plan §5.1, legacy index.js).
 *
 * The OrgForge capability routers enqueue BullMQ jobs (org indexing, dependency
 * graph, deployment polling, self-improvement). These in-process workers
 * consume those queues; without them jobs would queue forever. Each job file
 * creates its Worker with import-time side effects (the legacy index.js simply
 * `import './jobs/*Job.js'`), retries its Redis connection in the background,
 * and exports the Worker instance.
 *
 * Workers retry their Redis connection in the background, so the API server
 * still boots even if Redis is temporarily unavailable.
 */
import indexOrgWorker from './jobs/indexOrgJob.js';
import dependencyGraphWorker from './jobs/dependencyGraphJob.js';
import selfImprovementWorker from './jobs/selfImprovementJob.js';
import sessionCleanupWorker from './jobs/sessionCleanupJob.js';
import pollDeploymentWorker from './jobs/pollDeploymentJob.js';

// Worker instances emit their own 'error' events (distinct from the shared
// Redis connection error swallow in queue.js). Guarding here keeps a worker
// fault (e.g. connection loss) from becoming an unhandled 'error' crash while
// BullMQ's internal retry keeps the worker alive.
for (const worker of [indexOrgWorker, dependencyGraphWorker, selfImprovementWorker, sessionCleanupWorker, pollDeploymentWorker]) {
  worker.on?.('error', () => {});
}

export const orgforgeWorkers = [
  indexOrgWorker,
  dependencyGraphWorker,
  selfImprovementWorker,
  sessionCleanupWorker,
  pollDeploymentWorker,
];
