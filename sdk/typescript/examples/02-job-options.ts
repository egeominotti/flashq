/**
 * Job Options - Priority, Delay, Retry
 */
import { Queue, Worker } from '../src';

const queue = new Queue('tasks');

// Job with all options
await queue.add('process', { data: 'important' }, {
  priority: 10,                              // Higher = first
  delay: 1000,                               // Run after 1s
  attempts: 3,                               // Retry 3 times
  backoff: { type: 'exponential', delay: 1000 }, // Backoff
  timeout: 30000,                            // 30s timeout
  jobId: 'unique-task-1',                    // Custom ID
});

console.log('Job added with options');

// Worker
const worker = new Worker('tasks', async (job) => {
  console.log('Processing:', job.data);
  return { done: true };
});

await new Promise(r => setTimeout(r, 3000));

await worker.close();
await queue.close();
