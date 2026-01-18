/**
 * Rate Limiting - Control throughput
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

// Set rate limit: 3 jobs per second
await client.setRateLimit('api-calls', 3);
console.log('Rate limit: 3 jobs/sec\n');

// Add 9 jobs
for (let i = 0; i < 9; i++) {
  await client.add('api-calls', { endpoint: `/api/${i}` });
}
console.log('Added 9 jobs');

// Process with rate limiting
const start = Date.now();
const worker = new Worker('api-calls', async (job) => {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[${elapsed}s] Processing: ${job.data.endpoint}`);
  return { done: true };
}, { autorun: false, concurrency: 1 });
await worker.start();

await new Promise(r => setTimeout(r, 5000));

// Clear rate limit
await client.clearRateLimit('api-calls');

await worker.close();
await client.close();
