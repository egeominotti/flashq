/**
 * Worker Events - completed, failed, error
 */
import { Queue, Worker } from '../src';

const queue = new Queue('jobs');

// Worker with event handlers
const worker = new Worker('jobs', async (job) => {
  if (job.data.shouldFail) {
    throw new Error('Intentional failure');
  }
  return { processed: true };
}, { concurrency: 5 });

// Event listeners
worker.on('completed', (job, result) => {
  console.log(`✓ Job ${job.id} completed:`, result);
});

worker.on('failed', (job, error) => {
  console.log(`✗ Job ${job.id} failed:`, error.message);
});

worker.on('error', (error) => {
  console.log('Worker error:', error);
});

// Add jobs
await queue.add('success', { value: 1 });
await queue.add('success', { value: 2 });
await queue.add('fail', { shouldFail: true });

await new Promise(r => setTimeout(r, 2000));

await worker.close();
await queue.close();
