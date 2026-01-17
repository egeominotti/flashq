/**
 * Test: Push 10,000 jobs and verify all 10,000 are processed
 *
 * Usage: bun run examples/test-10k-jobs.ts
 */

import { FlashQ, Worker } from "../src";

const TOTAL_JOBS = 10_000_000; // 10 million jobs
const QUEUE_NAME = `test-10k-${Date.now()}`;

async function main() {
  console.log(`\n=== Testing ${TOTAL_JOBS.toLocaleString()} jobs ===\n`);
  console.log(`Queue: ${QUEUE_NAME}`);

  const client = new FlashQ({
    host: "localhost",
    port: 6789,
    httpPort: 6790,
  });

  await client.connect();
  console.log("Connected to flashQ server");

  // Get initial stats
  const initialStats = await client.stats();
  console.log(`Initial stats: ${JSON.stringify(initialStats)}\n`);

  // Push 10,000 jobs
  console.log(`Pushing ${TOTAL_JOBS.toLocaleString()} jobs...`);
  const pushStart = Date.now();

  // Use batch push for efficiency
  const BATCH_SIZE = 1000;
  let pushed = 0;

  for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
    const batch = [];
    for (let j = 0; j < BATCH_SIZE && i + j < TOTAL_JOBS; j++) {
      batch.push({
        data: { index: i + j, timestamp: Date.now() },
        priority: 0,
      });
    }
    const ids = await client.pushBatch(QUEUE_NAME, batch);
    pushed += ids.length;
    process.stdout.write(
      `\rPushed: ${pushed.toLocaleString()} / ${TOTAL_JOBS.toLocaleString()}`,
    );
  }

  const pushTime = Date.now() - pushStart;
  console.log(
    `\nPush completed in ${pushTime}ms (${Math.round(TOTAL_JOBS / (pushTime / 1000))} jobs/sec)`,
  );

  // Verify queue count before processing
  const preProcessStats = await client.stats();
  console.log(`\nQueue state before processing:`);
  console.log(`  Queued: ${preProcessStats.queued}`);
  console.log(`  Processing: ${preProcessStats.processing}`);

  // Process jobs with NEW batch Worker (default: 10 workers x 100 batch)
  console.log(`\nStarting Worker (batch mode default)...`);

  let completed = 0;
  let failed = 0;
  const processStart = Date.now();

  const worker = new Worker<
    { index: number; timestamp: number },
    { processed: boolean }
  >(
    QUEUE_NAME,
    async () => {
      // No-op processor for max throughput
      return { processed: true };
    },
    {
      concurrency: 20,  // 20 parallel connections
      batchSize: 100,   // 100 jobs per batch (default)
      host: "localhost",
      port: 6789,
      httpPort: 6790,
    },
  );

  worker.on("completed", () => {
    completed++;
    if (completed % 1000 === 0 || completed === TOTAL_JOBS) {
      const elapsed = Date.now() - processStart;
      const rate = Math.round(completed / (elapsed / 1000));
      process.stdout.write(
        `\rCompleted: ${completed.toLocaleString()} / ${TOTAL_JOBS.toLocaleString()} (${rate} jobs/sec)`,
      );
    }
  });

  worker.on("failed", (job, error) => {
    failed++;
    console.error(`\nJob ${job.id} failed:`, error);
  });

  worker.on("error", (error) => {
    console.error("\nWorker error:", error);
  });

  await worker.start();

  // Wait for all jobs to complete with timeout
  const TIMEOUT_MS = 600_000; // 10 minutes for 10M jobs
  const startWait = Date.now();

  while (completed + failed < TOTAL_JOBS) {
    if (Date.now() - startWait > TIMEOUT_MS) {
      console.error(
        `\n\nTIMEOUT: Only processed ${completed + failed} out of ${TOTAL_JOBS} jobs`,
      );
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await worker.stop();
  const processTime = Date.now() - processStart;

  // Final stats
  const finalStats = await client.stats();

  console.log(`\n\n=== RESULTS ===`);
  console.log(`Total jobs pushed:     ${TOTAL_JOBS.toLocaleString()}`);
  console.log(`Jobs completed:        ${completed.toLocaleString()}`);
  console.log(`Jobs failed:           ${failed.toLocaleString()}`);
  console.log(`Processing time:       ${processTime}ms`);
  console.log(
    `Throughput:            ${Math.round((completed + failed) / (processTime / 1000))} jobs/sec`,
  );
  console.log(`\nFinal queue state:`);
  console.log(`  Queued:     ${finalStats.queued}`);
  console.log(`  Processing: ${finalStats.processing}`);
  console.log(`  DLQ:        ${finalStats.dlq}`);

  // Verify
  const success = completed === TOTAL_JOBS && failed === 0;
  console.log(
    `\n${success ? "✅ SUCCESS" : "❌ FAILURE"}: ${completed}/${TOTAL_JOBS} jobs processed`,
  );

  if (!success) {
    // Check what's left in the queue
    const queueInfo = await fetch(
      `http://localhost:6790/queues/${QUEUE_NAME}`,
    ).then((r) => r.json());
    console.log(`\nQueue info:`, JSON.stringify(queueInfo, null, 2));
  }

  await client.close();
  process.exit(success ? 0 : 1);
}

main().catch(console.error);
