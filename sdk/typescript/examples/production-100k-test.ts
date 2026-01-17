/**
 * Production Test: 100,000 Jobs
 *
 * Pushes 100k jobs in batches and processes them with multiple workers.
 * Waits until ALL jobs are completed.
 *
 * Run: bun run examples/production-100k-test.ts
 */

import { FlashQ, Worker } from '../src';

const QUEUE_NAME = 'production-100k';
const TOTAL_JOBS = 100_000;
const BATCH_SIZE = 1000;
const WORKER_CONCURRENCY = 50;
const NUM_WORKERS = 4;

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║        PRODUCTION TEST: 100,000 JOBS                   ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Total Jobs:     ${TOTAL_JOBS.toLocaleString()}`);
  console.log(`  Batch Size:     ${BATCH_SIZE.toLocaleString()}`);
  console.log(`  Workers:        ${NUM_WORKERS}`);
  console.log(`  Concurrency:    ${WORKER_CONCURRENCY} per worker`);
  console.log(`  Total Parallel: ${NUM_WORKERS * WORKER_CONCURRENCY}\n`);

  const client = new FlashQ();
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
      async (job) => {
        // Minimal work - just return success
        return { processed: true, id: job.id };
      },
      {
        host: 'localhost',
        port: 6789,
        concurrency: WORKER_CONCURRENCY,
      }
    );

    worker.on('completed', () => {
      completed++;
    });

    worker.on('failed', () => {
      failed++;
    });

    workers.push(worker);
  }

  // Start all workers
  console.log(`Starting ${NUM_WORKERS} workers...\n`);
  await Promise.all(workers.map((w) => w.start()));

  // Push jobs in batches
  console.log(`Pushing ${TOTAL_JOBS.toLocaleString()} jobs in batches of ${BATCH_SIZE}...`);
  const pushStart = Date.now();

  for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_JOBS - i) }, (_, j) => ({
      data: { index: i + j, timestamp: Date.now() },
    }));
    await client.pushBatch(QUEUE_NAME, batch);

    if ((i + BATCH_SIZE) % 10000 === 0) {
      console.log(`  Pushed: ${Math.min(i + BATCH_SIZE, TOTAL_JOBS).toLocaleString()}/${TOTAL_JOBS.toLocaleString()}`);
    }
  }

  const pushTime = Date.now() - pushStart;
  const pushRate = Math.round((TOTAL_JOBS / pushTime) * 1000);
  console.log(`\nPush complete: ${TOTAL_JOBS.toLocaleString()} jobs in ${pushTime}ms (${pushRate.toLocaleString()} jobs/sec)\n`);

  // Wait for all jobs to complete with progress updates
  console.log('Processing jobs...\n');
  let lastPrint = Date.now();

  while (completed + failed < TOTAL_JOBS) {
    await new Promise((r) => setTimeout(r, 100));

    const now = Date.now();
    if (now - lastPrint >= 1000) {
      const elapsed = ((now - startTime) / 1000).toFixed(1);
      const rate = Math.round(completed / ((now - startTime) / 1000));
      const pct = ((completed / TOTAL_JOBS) * 100).toFixed(1);
      const remaining = TOTAL_JOBS - completed - failed;
      const eta = rate > 0 ? Math.round(remaining / rate) : '?';

      console.log(
        `[${elapsed}s] Completed: ${completed.toLocaleString()} (${pct}%) | ` +
          `Rate: ${rate.toLocaleString()}/s | ETA: ${eta}s`
      );
      lastPrint = now;
    }
  }

  const totalTime = Date.now() - startTime;

  // Stop workers
  console.log('\nStopping workers...');
  await Promise.all(workers.map((w) => w.stop()));

  // Final results
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL RESULTS                       ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log(`Total Jobs:       ${TOTAL_JOBS.toLocaleString()}`);
  console.log(`Completed:        ${completed.toLocaleString()}`);
  console.log(`Failed:           ${failed.toLocaleString()}`);
  console.log(`Success Rate:     ${((completed / TOTAL_JOBS) * 100).toFixed(2)}%`);
  console.log(`\nPush Time:        ${pushTime}ms (${pushRate.toLocaleString()} jobs/sec)`);
  console.log(`Processing Time:  ${totalTime - pushTime}ms`);
  console.log(`Total Time:       ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
  console.log(
    `Throughput:       ${Math.round((completed / totalTime) * 1000).toLocaleString()} jobs/sec`
  );

  // Verify with server stats
  const stats = await client.stats();
  console.log('\nServer Stats:', stats);

  // Cleanup
  await client.obliterate(QUEUE_NAME);
  await client.close();

  const success = completed === TOTAL_JOBS && failed === 0;
  console.log(`\n${success ? '✓ TEST PASSED' : '✗ TEST FAILED'}\n`);
}

main().catch(console.error);
