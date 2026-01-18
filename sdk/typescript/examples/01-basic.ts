/**
 * Basic Usage - BullMQ-style API
 */
import { Queue, Worker } from '../src';

// Create queue
const emailQueue = new Queue('emails');

// Add a job
const job = await emailQueue.add('welcome', {
  to: 'user@example.com',
  subject: 'Welcome!'
});
console.log('Added job:', job.id);

// Create worker (auto-starts)
const worker = new Worker('emails', async (job) => {
  console.log('Processing:', job.data);
  return { sent: true };
});

worker.on('completed', (job, result) => {
  console.log('Completed:', job.id, result);
});

// Wait for processing
await new Promise(r => setTimeout(r, 2000));

// Cleanup
await worker.close();
await emailQueue.close();
