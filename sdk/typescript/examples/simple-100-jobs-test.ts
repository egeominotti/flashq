/**
 * Simple 100 Jobs Test
 *
 * Creates 100 jobs with a single worker (concurrency 1)
 * and verifies all jobs are processed.
 *
 * Run: bun run examples/simple-100-jobs-test.ts
 */

import { FlashQ, Worker } from '../src';

const QUEUE_NAME = 'test-100-jobs';
const TOTAL_JOBS = 100;

async function main() {
  console.log('='.repeat(60));
  console.log(`Simple Test: ${TOTAL_JOBS} Jobs with Concurrency 1`);
  console.log('='.repeat(60));

  const client = new FlashQ({ host: 'localhost', port: 6789 });
  await client.connect();

  // Clean up any existing jobs
  await client.obliterate(QUEUE_NAME);

  // Track completed jobs
  let completed = 0;
  let failed = 0;
  const startTime = Date.now();
  const jobResults: number[] = [];

  // Create worker with concurrency 1
  const worker = new Worker(QUEUE_NAME, async (job) => {
    // Simulate some work (10ms)
    await new Promise((r) => setTimeout(r, 10));
    jobResults.push(job.id);
    return { processed: true, jobId: job.id };
  }, {
    host: 'localhost',
    port: 6789,
    concurrency: 1,
  });

  worker.on('completed', () => {
    completed++;
    if (completed % 10 === 0) {
      console.log(`Progress: ${completed}/${TOTAL_JOBS} completed`);
    }
  });

  worker.on('failed', (job, error) => {
    failed++;
    console.log(`Job ${job.id} failed: ${error}`);
  });

  // Start worker
  await worker.start();
  console.log('Worker started (concurrency: 1)\n');

  // Push 100 jobs
  console.log(`Pushing ${TOTAL_JOBS} jobs...`);
  const pushStart = Date.now();

  const jobIds: number[] = [];
  for (let i = 0; i < TOTAL_JOBS; i++) {
    const jobId = await client.push(QUEUE_NAME, { index: i, message: `Job ${i}` });
    jobIds.push(jobId);
  }

  const pushTime = Date.now() - pushStart;
  console.log(`Pushed ${TOTAL_JOBS} jobs in ${pushTime}ms\n`);

  // Wait for all jobs to complete
  console.log('Waiting for all jobs to complete...\n');

  while (completed + failed < TOTAL_JOBS) {
    await new Promise((r) => setTimeout(r, 100));
  }

  const totalTime = Date.now() - startTime;

  // Stop worker
  await worker.stop();

  // Results
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Total jobs:     ${TOTAL_JOBS}`);
  console.log(`Completed:      ${completed}`);
  console.log(`Failed:         ${failed}`);
  console.log(`Success rate:   ${((completed / TOTAL_JOBS) * 100).toFixed(1)}%`);
  console.log(`Total time:     ${totalTime}ms`);
  console.log(`Avg per job:    ${(totalTime / TOTAL_JOBS).toFixed(2)}ms`);
  console.log(`Throughput:     ${((TOTAL_JOBS / totalTime) * 1000).toFixed(1)} jobs/sec`);

  // Verify all jobs were processed
  const allProcessed = completed === TOTAL_JOBS;
  const uniqueResults = new Set(jobResults).size;

  console.log('\n' + '='.repeat(60));
  console.log('VERIFICATION');
  console.log('='.repeat(60));
  console.log(`All jobs completed: ${allProcessed ? 'YES ✓' : 'NO ✗'}`);
  console.log(`Unique jobs processed: ${uniqueResults}/${TOTAL_JOBS}`);
  console.log(`No duplicates: ${uniqueResults === TOTAL_JOBS ? 'YES ✓' : 'NO ✗'}`);

  // Cleanup
  await client.obliterate(QUEUE_NAME);
  await client.close();

  console.log('\n' + (allProcessed ? '✓ TEST PASSED' : '✗ TEST FAILED'));
}

main().catch(console.error);
