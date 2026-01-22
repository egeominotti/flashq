/**
 * Benchmark - Measure throughput
 */
import { Queue, Worker } from '../src';

const JOBS = 10_000;
const BATCH = 1000;

const queue = new Queue('benchmark', {
  defaultJobOptions: { removeOnComplete: true }
});
await queue.obliterate();

// Push in batches
console.log(`Pushing ${JOBS.toLocaleString()} jobs...`);
const pushStart = Date.now();

for (let i = 0; i < JOBS; i += BATCH) {
  const jobs = Array.from({ length: Math.min(BATCH, JOBS - i) }, (_, j) => ({
    name: 'task',
    data: { i: i + j }
  }));
  await queue.addBulk(jobs);
}

const pushTime = Date.now() - pushStart;
console.log(`Push: ${Math.round(JOBS / pushTime * 1000).toLocaleString()} jobs/sec`);

// Process
let processed = 0;
const processStart = Date.now();

const worker = new Worker('benchmark', async () => {
  processed++;
  return { ok: true };
}, { concurrency: 20 });

// Wait for all jobs
while (processed < JOBS) {
  await new Promise(r => setTimeout(r, 100));
}

const processTime = Date.now() - processStart;
console.log(`Process: ${Math.round(processed / processTime * 1000).toLocaleString()} jobs/sec`);
console.log(`Total: ${processed.toLocaleString()} jobs`);

await worker.close();
await queue.obliterate();
await queue.close();
