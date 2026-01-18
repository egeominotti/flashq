/**
 * Concurrency - Parallel job processing
 */
import { Queue, Worker } from '../src';

const queue = new Queue('parallel');

// Add 10 jobs
for (let i = 1; i <= 10; i++) {
  await queue.add('task', { id: i });
}
console.log('Added 10 jobs\n');

let active = 0;
let maxActive = 0;

// Worker with concurrency 3
const worker = new Worker('parallel', async (job) => {
  active++;
  maxActive = Math.max(maxActive, active);
  console.log(`Start job ${job.data.id} (active: ${active})`);

  await new Promise(r => setTimeout(r, 500));

  active--;
  console.log(`Done job ${job.data.id} (active: ${active})`);
  return { done: true };
}, { concurrency: 3 });

await new Promise(r => setTimeout(r, 3000));

console.log(`\nMax concurrent jobs: ${maxActive}`);

await worker.close();
await queue.close();
