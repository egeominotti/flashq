/**
 * High-Performance Batch Test
 *
 * Uses batch pull/ack for maximum throughput
 *
 * Usage: bun run examples/test-batch-performance.ts
 */

import { FlashQ } from "../src";

const TOTAL_JOBS = 1_000_000;
const QUEUE_NAME = `batch-test-${Date.now()}`;
const BATCH_SIZE = 100; // Jobs per batch
const NUM_WORKERS = 20; // Parallel workers

async function main() {
  console.log(`\n=== Batch Performance Test ===\n`);
  console.log(`Jobs: ${TOTAL_JOBS.toLocaleString()}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Workers: ${NUM_WORKERS}`);
  console.log(`Queue: ${QUEUE_NAME}\n`);

  // Producer client
  const producer = new FlashQ({ host: "localhost", port: 6789, httpPort: 6790 });
  await producer.connect();

  // Get initial stats
  const initialStats = await producer.stats();
  console.log(`Initial: queued=${initialStats.queued}, processing=${initialStats.processing}\n`);

  // ==================== PUSH PHASE ====================
  console.log(`Pushing ${TOTAL_JOBS.toLocaleString()} jobs...`);
  const pushStart = Date.now();

  const PUSH_BATCH = 1000;
  let pushed = 0;

  for (let i = 0; i < TOTAL_JOBS; i += PUSH_BATCH) {
    const batch = [];
    for (let j = 0; j < PUSH_BATCH && i + j < TOTAL_JOBS; j++) {
      batch.push({ data: { i: i + j }, priority: 0 });
    }
    const ids = await producer.pushBatch(QUEUE_NAME, batch);
    pushed += ids.length;
    if (pushed % 100000 === 0) {
      process.stdout.write(`\rPushed: ${pushed.toLocaleString()}`);
    }
  }

  const pushTime = Date.now() - pushStart;
  const pushRate = Math.round(TOTAL_JOBS / (pushTime / 1000));
  console.log(`\rPush: ${TOTAL_JOBS.toLocaleString()} jobs in ${pushTime}ms (${pushRate.toLocaleString()} jobs/sec)\n`);

  // Verify queue state
  const preStats = await producer.stats();
  console.log(`Before processing: queued=${preStats.queued}\n`);

  // ==================== PROCESS PHASE ====================
  console.log(`Processing with ${NUM_WORKERS} batch workers (batch=${BATCH_SIZE})...`);
  const processStart = Date.now();

  let completed = 0;
  let running = true;

  // Create worker clients
  const workers: FlashQ[] = [];
  for (let i = 0; i < NUM_WORKERS; i++) {
    const w = new FlashQ({ host: "localhost", port: 6789, httpPort: 6790 });
    await w.connect();
    workers.push(w);
  }

  // Worker function - batch pull and ack
  async function batchWorker(client: FlashQ, workerId: number) {
    while (running) {
      try {
        // Batch pull
        const jobs = await client.pullBatch(QUEUE_NAME, BATCH_SIZE);

        if (jobs.length === 0) {
          // No jobs, check if we're done
          if (completed >= TOTAL_JOBS) break;
          await new Promise(r => setTimeout(r, 10));
          continue;
        }

        // Process jobs (no-op for benchmark)
        // In real use: await Promise.all(jobs.map(j => processJob(j)));

        // Batch ack
        const ids = jobs.map(j => j.id);
        await client.ackBatch(ids);

        completed += jobs.length;

        if (completed % 10000 === 0 || completed >= TOTAL_JOBS) {
          const elapsed = Date.now() - processStart;
          const rate = Math.round(completed / (elapsed / 1000));
          process.stdout.write(`\rCompleted: ${completed.toLocaleString()} (${rate.toLocaleString()} jobs/sec)`);
        }
      } catch (err) {
        // Connection error, retry
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }

  // Start all workers
  const workerPromises = workers.map((w, i) => batchWorker(w, i));

  // Wait for completion with timeout
  const TIMEOUT = 300_000; // 5 minutes
  const startWait = Date.now();

  while (completed < TOTAL_JOBS && Date.now() - startWait < TIMEOUT) {
    await new Promise(r => setTimeout(r, 100));
  }

  running = false;
  await Promise.all(workerPromises);

  const processTime = Date.now() - processStart;
  const processRate = Math.round(completed / (processTime / 1000));

  // Close all workers
  await Promise.all(workers.map(w => w.close()));

  // ==================== RESULTS ====================
  const finalStats = await producer.stats();

  console.log(`\n\n${"=".repeat(50)}`);
  console.log(`RESULTS`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Push:     ${pushRate.toLocaleString()} jobs/sec`);
  console.log(`Process:  ${processRate.toLocaleString()} jobs/sec`);
  console.log(`${"─".repeat(50)}`);
  console.log(`Total:    ${TOTAL_JOBS.toLocaleString()} jobs`);
  console.log(`Complete: ${completed.toLocaleString()} jobs`);
  console.log(`Failed:   ${(TOTAL_JOBS - completed).toLocaleString()} jobs`);
  console.log(`Time:     ${processTime}ms`);
  console.log(`${"─".repeat(50)}`);
  console.log(`Final:    queued=${finalStats.queued}, processing=${finalStats.processing}, dlq=${finalStats.dlq}`);
  console.log(`${"=".repeat(50)}`);

  const success = completed === TOTAL_JOBS;
  console.log(`\n${success ? "✅ SUCCESS" : "❌ FAILURE"}`);

  await producer.close();
  process.exit(success ? 0 : 1);
}

main().catch(console.error);
