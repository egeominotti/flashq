/**
 * Production Test: 100,000 Jobs - MAX THROUGHPUT
 *
 * Run: bun run examples/production-100k-max.ts
 */

import { FlashQ, Worker } from '../src';

const QUEUE_NAME = 'production-max';
const TOTAL_JOBS = 100_000;
const BATCH_SIZE = 1000;
const WORKER_CONCURRENCY = 150;
const NUM_WORKERS = 12;

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   PRODUCTION TEST: 100K JOBS - MAX THROUGHPUT          ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Total Jobs:     ${TOTAL_JOBS.toLocaleString()}`);
  console.log(`  Batch Size:     ${BATCH_SIZE.toLocaleString()}`);
  console.log(`  Workers:        ${NUM_WORKERS}`);
  console.log(`  Concurrency:    ${WORKER_CONCURRENCY} per worker`);
  console.log(`  Total Parallel: ${(NUM_WORKERS * WORKER_CONCURRENCY).toLocaleString()}\n`);

  const client = new FlashQ({ timeout: 30000 });
  await client.connect();

  // Cleanup
  console.log('Cleaning up queue...');
  await client.obliterate(QUEUE_NAME);

  // Stats tracking
  let completed = 0;
  let failed = 0;
  const startTime = Date.now();

  // Create workers
  const workers: Worker[] = [];
  for (let w = 0; w < NUM_WORKERS; w++) {
    const worker = new Worker(
      QUEUE_NAME,
      async () => ({ ok: true }),
      {
        host: 'localhost',
        port: 6789,
        concurrency: WORKER_CONCURRENCY,
        timeout: 30000,
      }
    );

    worker.on('completed', () => completed++);
    worker.on('failed', () => failed++);
    workers.push(worker);
  }

  // Start all workers
  console.log(`Starting ${NUM_WORKERS} workers (${(NUM_WORKERS * WORKER_CONCURRENCY).toLocaleString()} total concurrency)...\n`);
  await Promise.all(workers.map((w) => w.start()));

  // Push jobs in batches
  console.log(`Pushing ${TOTAL_JOBS.toLocaleString()} jobs...`);
  const pushStart = Date.now();

  for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_JOBS - i) }, (_, j) => ({
      data: { i: i + j },
    }));
    await client.pushBatch(QUEUE_NAME, batch);
  }

  const pushTime = Date.now() - pushStart;
  const pushRate = Math.round((TOTAL_JOBS / pushTime) * 1000);
  console.log(`Push complete: ${pushTime}ms (${pushRate.toLocaleString()} jobs/sec)\n`);

  // Wait for all jobs to complete
  console.log('Processing...\n');
  let lastPrint = Date.now();

  while (completed + failed < TOTAL_JOBS) {
    await new Promise((r) => setTimeout(r, 50));

    const now = Date.now();
    if (now - lastPrint >= 500) {
      const elapsed = ((now - startTime) / 1000).toFixed(1);
      const rate = Math.round(completed / ((now - startTime) / 1000));
      const pct = ((completed / TOTAL_JOBS) * 100).toFixed(1);

      console.log(`[${elapsed}s] ${completed.toLocaleString()}/${TOTAL_JOBS.toLocaleString()} (${pct}%) | ${rate.toLocaleString()}/s`);
      lastPrint = now;
    }
  }

  const totalTime = Date.now() - startTime;

  // Stop workers
  await Promise.all(workers.map((w) => w.stop()));

  // Results
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║                    RESULTS                             ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log(`Total Jobs:       ${TOTAL_JOBS.toLocaleString()}`);
  console.log(`Completed:        ${completed.toLocaleString()}`);
  console.log(`Failed:           ${failed}`);
  console.log(`Success Rate:     ${((completed / TOTAL_JOBS) * 100).toFixed(2)}%`);
  console.log(`\nPush:             ${pushRate.toLocaleString()} jobs/sec`);
  console.log(`Total Time:       ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`Throughput:       ${Math.round((completed / totalTime) * 1000).toLocaleString()} jobs/sec`);

  const stats = await client.stats();
  console.log('\nServer:', stats);

  await client.obliterate(QUEUE_NAME);
  await client.close();

  console.log(`\n${completed === TOTAL_JOBS ? '✓ TEST PASSED' : '✗ TEST FAILED'}\n`);
}

main().catch(console.error);
