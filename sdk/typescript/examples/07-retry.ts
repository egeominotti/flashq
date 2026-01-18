/**
 * Retry & Backoff - Handle failures
 */
import { Queue, Worker } from '../src';

const queue = new Queue('flaky-api');

let attempt = 0;

// Worker that fails first 2 times
const worker = new Worker('flaky-api', async (job) => {
  attempt++;
  console.log(`Attempt ${attempt}...`);

  if (attempt < 3) {
    throw new Error(`Attempt ${attempt} failed`);
  }

  console.log('Success on attempt', attempt);
  return { success: true };
});

worker.on('failed', (job, err) => {
  console.log('Failed:', err.message);
});

worker.on('completed', (job, result) => {
  console.log('Completed:', result);
});

// Add job with retry config
await queue.add('call-api', { url: '/api/data' }, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 500 }
});

await new Promise(r => setTimeout(r, 5000));

await worker.close();
await queue.close();
