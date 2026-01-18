/**
 * Concurrency Control - Limit parallel processing
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

await client.obliterate('heavy-tasks');

// Set server-side concurrency limit
await client.setConcurrency('heavy-tasks', 2);
console.log('Concurrency limit: 2 jobs at a time\n');

let active = 0;
let maxActive = 0;

// Worker with high local concurrency (but server limits to 2)
const worker = new Worker('heavy-tasks', async (job) => {
  active++;
  maxActive = Math.max(maxActive, active);
  console.log(`Start job ${job.data.id} (active: ${active})`);

  await new Promise(r => setTimeout(r, 500));

  active--;
  console.log(`Done job ${job.data.id} (active: ${active})`);
  return { done: true };
}, { concurrency: 10 }); // Worker wants 10, but server limits to 2

await worker.start();

// Push 6 jobs
for (let i = 1; i <= 6; i++) {
  await client.push('heavy-tasks', { id: i });
}
console.log('Pushed 6 jobs\n');

await new Promise(r => setTimeout(r, 3000));

console.log(`\nMax concurrent: ${maxActive} (limit was 2)`);

await client.clearConcurrency('heavy-tasks');
await worker.stop();
await client.obliterate('heavy-tasks');
await client.close();
