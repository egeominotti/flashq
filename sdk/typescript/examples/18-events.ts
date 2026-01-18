/**
 * Job Lifecycle Events - Polling approach
 *
 * Note: For real-time SSE/WebSocket events, use a browser
 * or Node.js with EventSource polyfill.
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

await client.obliterate('tasks');

// Track job states
const jobStates = new Map<number, string>();

// Worker with state logging
const worker = new Worker('tasks', async (job) => {
  jobStates.set(job.id, 'active');
  console.log(`[ACTIVE] Job ${job.id}: ${job.data.name}`);

  await new Promise(r => setTimeout(r, 300));

  if (job.data.shouldFail) {
    throw new Error('Intentional failure');
  }

  jobStates.set(job.id, 'completed');
  console.log(`[COMPLETED] Job ${job.id}`);
  return { done: true };
}, { concurrency: 2 });

worker.on('failed', (job, error) => {
  jobStates.set(job.id, 'failed');
  console.log(`[FAILED] Job ${job.id}: ${error}`);
});

await worker.start();

// Push jobs
const job1 = await client.push('tasks', { name: 'Task A' });
const job2 = await client.push('tasks', { name: 'Task B' });
const job3 = await client.push('tasks', { name: 'Task C', shouldFail: true }, { max_attempts: 1 });

console.log(`Pushed jobs: ${job1.id}, ${job2.id}, ${job3.id}\n`);

await new Promise(r => setTimeout(r, 2000));

// Final states
console.log('\nFinal job states:');
for (const [id, state] of jobStates) {
  console.log(`  Job ${id}: ${state}`);
}

await worker.stop();
await client.obliterate('tasks');
await client.close();
