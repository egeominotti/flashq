/**
 * Priority Queue - Process important jobs first
 */
import { Queue, Worker } from '../src';

const queue = new Queue('priority-demo');

// Add jobs with different priorities
await queue.add('low', { level: 'low' }, { priority: 1 });
await queue.add('medium', { level: 'medium' }, { priority: 5 });
await queue.add('high', { level: 'HIGH' }, { priority: 10 });
await queue.add('critical', { level: 'CRITICAL' }, { priority: 100 });
await queue.add('normal', { level: 'normal' }, { priority: 3 });

console.log('Added 5 jobs with different priorities\n');

// Process in priority order
const worker = new Worker('priority-demo', async (job) => {
  console.log(`Processing: ${job.data.level} (priority: ${job.priority})`);
  return { done: true };
}, { concurrency: 1 }); // Process one at a time to show order

await new Promise(r => setTimeout(r, 2000));

await worker.close();
await queue.close();
