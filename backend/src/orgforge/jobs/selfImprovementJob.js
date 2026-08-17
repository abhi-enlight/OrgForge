import { Worker } from 'bullmq';
import { createRedisConnection } from './queue.js';
import { runSelfImprovement } from '../../lib/selfImprovement.js';

// BullMQ workers require their own connection instance when using blocking commands
const connection = createRedisConnection();

const worker = new Worker('orgforge-self-improvement', async job => {
  console.log('[self-improvement] Running nightly AI judge & self-improvement job...');

  try {
    const result = await runSelfImprovement();
    console.log('[self-improvement] Job complete:', result);
    return result;
  } catch (error) {
    console.error('[self-improvement] Job failed:', error);
    throw error;
  }
}, { connection });

export default worker;
