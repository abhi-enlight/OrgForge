import { Queue } from 'bullmq';
import Redis from 'ioredis';

export function createRedisConnection() {
  return new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
}

// BullMQ v5 requires maxRetriesPerRequest: null because it uses blocking commands.
const connection = createRedisConnection();

// Prevent unhandled 'error' events from crashing the API server while Redis
// is unreachable (e.g. local dev without a running Redis instance).
connection.on('error', () => {});

export const orgIndexQueue = new Queue('orgforge-index-org', { connection });
export const dependencyGraphQueue = new Queue('orgforge-dependency-graph', { connection });
export const selfImprovementQueue = new Queue('orgforge-self-improvement', { connection });
export const deploymentQueue = new Queue('orgforge-deployments', { connection });

export const redisConnection = connection;
