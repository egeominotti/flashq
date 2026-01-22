/**
 * 1 Million Jobs Benchmark with Data Integrity Verification
 * Runs 10 consecutive iterations to test stability
 */
import { Queue, Worker } from "../src";

const TOTAL_JOBS = 1_000_000; // Full million jobs test
const BATCH_SIZE = 1000; // Server limit: max 1000 per batch
const NUM_WORKERS = 8;
const CONCURRENCY_PER_WORKER = 100;
const NUM_RUNS = 50;

interface RunResult {
  run: number;
  pushTime: number;
  pushRate: number;
  processTime: number;
  processRate: number;
  totalTime: number;
  processed: number;
  errors: number;
  dataErrors: number;
  missing: number;
  success: boolean;
}

async function runBenchmark(runNumber: number): Promise<RunResult> {
  const queue = new Queue("million-benchmark", {
    timeout: 30000, // Client request timeout (30s to handle heavy load)
    defaultJobOptions: {
      removeOnComplete: true,
      timeout: 60000, // Job processing timeout
    },
  });

  console.log(`\n${"=".repeat(70)}`);
  console.log(
    `🚀 RUN ${runNumber}/${NUM_RUNS} - ${TOTAL_JOBS.toLocaleString()} Jobs`,
  );
  console.log("=".repeat(70));

  // Clean up before starting
  console.log("📋 Cleaning up queue...");
  await queue.obliterate();

  // Push jobs in batches
  console.log(`📤 Pushing ${TOTAL_JOBS.toLocaleString()} jobs...`);
  const pushStart = Date.now();

  let pushed = 0;
  for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
    const batchCount = Math.min(BATCH_SIZE, TOTAL_JOBS - i);
    const jobs = Array.from({ length: batchCount }, (_, j) => ({
      name: "task",
      data: {
        index: i + j,
        value: `job-${i + j}`,
        timestamp: Date.now(),
      },
    }));
    await queue.addBulk(jobs);
    pushed += batchCount;

    // Progress update every 100K
    if (pushed % 100_000 === 0) {
      const elapsed = (Date.now() - pushStart) / 1000;
      const rate = Math.round(pushed / elapsed);
      console.log(
        `   Pushed: ${pushed.toLocaleString()} (${rate.toLocaleString()} jobs/sec)`,
      );
    }
  }

  const pushTime = Date.now() - pushStart;
  const pushRate = Math.round(TOTAL_JOBS / (pushTime / 1000));
  console.log(
    `✅ Push complete: ${pushRate.toLocaleString()} jobs/sec (${(pushTime / 1000).toFixed(2)}s)`,
  );

  // Create workers
  console.log(`👷 Starting ${NUM_WORKERS} workers...`);
  const workers: Worker[] = [];
  let processed = 0;
  let errors = 0;
  let dataErrors = 0;
  const processStart = Date.now();
  let lastReport = processStart;
  let lastProcessed = 0;

  for (let w = 0; w < NUM_WORKERS; w++) {
    const worker = new Worker(
      "million-benchmark",
      async (job) => {
        const data = job.data as {
          index: number;
          value: string;
          timestamp: number;
        };
        return {
          index: data.index,
          value: data.value,
          originalTimestamp: data.timestamp,
          processedAt: Date.now(),
        };
      },
      {
        concurrency: CONCURRENCY_PER_WORKER,
        batchSize: 100,
        autorun: false,
      },
    );

    worker.on("completed", (job, result) => {
      processed++;
      const input = job.data as { index: number; value: string };
      const output = result as { index: number; value: string };
      if (input.index !== output.index || input.value !== output.value) {
        dataErrors++;
      }
    });

    worker.on("failed", () => {
      errors++;
    });

    workers.push(worker);
  }

  // Start all workers
  await Promise.all(workers.map((w) => w.start()));

  // Progress reporter
  const progressInterval = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - processStart) / 1000;
    const intervalElapsed = (now - lastReport) / 1000;
    const intervalProcessed = processed - lastProcessed;
    const currentRate = Math.round(intervalProcessed / intervalElapsed);
    const avgRate = Math.round(processed / elapsed);
    const pct = ((processed / TOTAL_JOBS) * 100).toFixed(1);

    console.log(
      `   ${processed.toLocaleString()}/${TOTAL_JOBS.toLocaleString()} (${pct}%) | ${currentRate.toLocaleString()}/s | Avg: ${avgRate.toLocaleString()}/s`,
    );

    lastReport = now;
    lastProcessed = processed;
  }, 5000);

  // Wait for all jobs to be processed or failed
  const timeout = Date.now() + 600_000; // 10 minute timeout
  while (processed + errors < TOTAL_JOBS) {
    if (Date.now() > timeout) {
      console.error(
        `❌ TIMEOUT: Only ${processed + errors}/${TOTAL_JOBS} jobs completed`,
      );
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  clearInterval(progressInterval);

  const processTime = Date.now() - processStart;
  const processRate = Math.round(TOTAL_JOBS / (processTime / 1000));

  // Stop all workers
  await Promise.all(workers.map((w) => w.close()));

  // Cleanup
  await queue.obliterate();
  await queue.close();

  const totalTime = pushTime + processTime;
  const totalHandled = processed + errors;
  const allAccountedFor = totalHandled === TOTAL_JOBS;
  const success = errors === 0 && dataErrors === 0 && allAccountedFor;

  if (!allAccountedFor) {
    console.error(
      `❌ MISSING JOBS: ${totalHandled}/${TOTAL_JOBS} (${TOTAL_JOBS - totalHandled} lost)`,
    );
  }

  console.log(
    `\n📊 Run ${runNumber} Result: Push ${pushRate.toLocaleString()}/s | Process ${processRate.toLocaleString()}/s | Total ${(totalTime / 1000).toFixed(2)}s | ${success ? "✅" : "❌"}`,
  );

  return {
    run: runNumber,
    pushTime,
    pushRate,
    processTime,
    processRate,
    totalTime,
    processed,
    errors,
    dataErrors,
    missing: TOTAL_JOBS - totalHandled,
    success,
  };
}

// Main execution
console.log("=".repeat(70));
console.log("🚀 flashQ STABILITY BENCHMARK - 10 Consecutive Runs");
console.log("=".repeat(70));
console.log(`Jobs per run: ${TOTAL_JOBS.toLocaleString()}`);
console.log(`Total jobs: ${(TOTAL_JOBS * NUM_RUNS).toLocaleString()}`);
console.log(`Workers: ${NUM_WORKERS}`);
console.log(`Concurrency/worker: ${CONCURRENCY_PER_WORKER}`);
console.log(`Total concurrency: ${NUM_WORKERS * CONCURRENCY_PER_WORKER}`);
console.log("=".repeat(70));

const results: RunResult[] = [];
const overallStart = Date.now();

for (let run = 1; run <= NUM_RUNS; run++) {
  const result = await runBenchmark(run);
  results.push(result);
}

const overallTime = Date.now() - overallStart;

// Final summary
console.log("\n" + "=".repeat(70));
console.log("📊 FINAL SUMMARY - 10 RUNS");
console.log("=".repeat(70));
console.log("");
console.log("Run  | Push Rate    | Process Rate | Total Time | Status");
console.log("-".repeat(70));

for (const r of results) {
  let status = "✅ OK";
  if (!r.success) {
    const issues = [];
    if (r.errors > 0) issues.push(`E:${r.errors}`);
    if (r.dataErrors > 0) issues.push(`D:${r.dataErrors}`);
    if (r.missing > 0) issues.push(`M:${r.missing}`);
    status = `❌ ${issues.join(" ")}`;
  }
  console.log(
    `#${r.run.toString().padStart(2)}  | ` +
      `${r.pushRate.toLocaleString().padStart(12)}/s | ` +
      `${r.processRate.toLocaleString().padStart(12)}/s | ` +
      `${(r.totalTime / 1000).toFixed(2).padStart(8)}s | ` +
      status,
  );
}

console.log("-".repeat(70));

// Averages
const avgPushRate = Math.round(
  results.reduce((s, r) => s + r.pushRate, 0) / results.length,
);
const avgProcessRate = Math.round(
  results.reduce((s, r) => s + r.processRate, 0) / results.length,
);
const avgTotalTime =
  results.reduce((s, r) => s + r.totalTime, 0) / results.length;
const successCount = results.filter((r) => r.success).length;

console.log(
  `AVG  | ` +
    `${avgPushRate.toLocaleString().padStart(12)}/s | ` +
    `${avgProcessRate.toLocaleString().padStart(12)}/s | ` +
    `${(avgTotalTime / 1000).toFixed(2).padStart(8)}s | ` +
    `${successCount}/${NUM_RUNS} passed`,
);

// Min/Max
const minProcessRate = Math.min(...results.map((r) => r.processRate));
const maxProcessRate = Math.max(...results.map((r) => r.processRate));
const totalProcessed = results.reduce((s, r) => s + r.processed, 0);
const totalErrors = results.reduce((s, r) => s + r.errors, 0);
const totalDataErrors = results.reduce((s, r) => s + r.dataErrors, 0);
const totalMissing = results.reduce((s, r) => s + r.missing, 0);

console.log("");
console.log(
  `Process rate range: ${minProcessRate.toLocaleString()}/s - ${maxProcessRate.toLocaleString()}/s`,
);
console.log(`Total jobs pushed: ${(TOTAL_JOBS * NUM_RUNS).toLocaleString()}`);
console.log(`Total processed: ${totalProcessed.toLocaleString()}`);
if (totalErrors > 0)
  console.log(`Total errors: ${totalErrors.toLocaleString()}`);
if (totalDataErrors > 0)
  console.log(`Total data errors: ${totalDataErrors.toLocaleString()}`);
if (totalMissing > 0)
  console.log(`Total missing: ${totalMissing.toLocaleString()}`);
console.log(`Total time: ${(overallTime / 1000 / 60).toFixed(2)} minutes`);
console.log("=".repeat(70));

if (successCount === NUM_RUNS) {
  console.log("\n✅ ALL RUNS PASSED - System is stable!");
} else {
  console.log(`\n❌ ${NUM_RUNS - successCount} RUNS FAILED`);
}

process.exit(successCount === NUM_RUNS ? 0 : 1);
