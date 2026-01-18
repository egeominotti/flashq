/**
 * Delayed Jobs - Schedule for later
 */
import { Queue, Worker } from '../src';

const queue = new Queue('reminders');

// Schedule job for 2 seconds from now
await queue.add('reminder', {
  message: 'Time to check!'
}, {
  delay: 2000
});

console.log('Job scheduled for 2s from now...');
const start = Date.now();

// Worker
const worker = new Worker('reminders', async (job) => {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[${elapsed}s] Got reminder:`, job.data.message);
  return { notified: true };
});

await new Promise(r => setTimeout(r, 4000));

await worker.close();
await queue.close();
