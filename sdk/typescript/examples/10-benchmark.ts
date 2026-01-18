/**
 * Benchmark - Measure throughput
 */
import { FlashQ } from '../src';

const JOBS = 10_000;
const BATCH_SIZE = 1000; // Server limit
const client = new FlashQ();

// Cleanup
await client.obliterate('bench');

// Push in batches (server has 1000 job batch limit)
console.log(`Pushing ${JOBS.toLocaleString()} jobs...`);
const pushStart = Date.now();
for (let i = 0; i < JOBS; i += BATCH_SIZE) {
  const batch = Array.from({ length: Math.min(BATCH_SIZE, JOBS - i) }, (_, j) => ({ data: { i: i + j } }));
  await client.pushBatch('bench', batch);
}
const pushTime = Date.now() - pushStart;
console.log(`Push: ${Math.round(JOBS / pushTime * 1000).toLocaleString()} jobs/sec`);

// Pull and ack
console.log('Processing...');
const processStart = Date.now();
let processed = 0;

while (processed < JOBS) {
  const batch = await client.pullBatch('bench', 100, 1000);
  if (batch.length === 0) break;
  await client.ackBatch(batch.map(j => j.id));
  processed += batch.length;
}

const processTime = Date.now() - processStart;
console.log(`Process: ${Math.round(processed / processTime * 1000).toLocaleString()} jobs/sec`);
console.log(`Total: ${processed}/${JOBS}`);

await client.obliterate('bench');
await client.close();
