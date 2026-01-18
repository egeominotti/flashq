/**
 * Worker - Automatic job processing
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

// Create worker
const worker = new Worker('emails', async (job) => {
  console.log('Processing:', job.data);
  return { sent: true };
}, { concurrency: 5 });

worker.on('completed', (job, result) => console.log('Done:', job.id, result));
worker.on('failed', (job, err) => console.log('Failed:', job.id, err.message));

await worker.start();

// Push jobs
for (let i = 0; i < 5; i++) {
  await client.push('emails', { to: `user${i}@example.com` });
}

// Wait and cleanup
await new Promise(r => setTimeout(r, 2000));
await worker.stop();
await client.close();
