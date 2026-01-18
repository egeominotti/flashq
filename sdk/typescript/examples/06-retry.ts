/**
 * Retry & Dead Letter Queue
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

// Worker that fails jobs
let attempts = 0;
const worker = new Worker('flaky', async (job) => {
  attempts++;
  if (attempts < 3) {
    throw new Error(`Attempt ${attempts} failed`);
  }
  return { success: true };
}, { concurrency: 1 });

worker.on('failed', (job, err) => console.log('Failed:', err.message));
worker.on('completed', (job) => console.log('Success on attempt', attempts));

await worker.start();

// Push job with 3 retries
await client.push('flaky', { task: 'important' }, {
  max_attempts: 3,
  backoff: 100,
});

// Wait for retries
await new Promise(r => setTimeout(r, 3000));

// Check DLQ
const dlq = await client.getDlq('flaky');
console.log('Jobs in DLQ:', dlq.length);

await worker.stop();
await client.close();
