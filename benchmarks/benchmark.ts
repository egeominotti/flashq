/**
 * flashQ vs BullMQ Performance Benchmark Suite
 *
 * Comprehensive comparison across multiple scenarios:
 * - Single job push/pull
 * - Batch operations
 * - Concurrent workers
 * - High-throughput processing
 * - Large payloads
 *
 * Run: bun run benchmark.ts
 */

import { FlashQ, Worker as FlashQWorker } from "flashq";
import { Queue as BullQueue, Worker as BullWorker } from "bullmq";
import IORedis from "ioredis";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  flashq: {
    host: "localhost",
    port: 6789,
    httpPort: 6790,
    timeout: 30000,  // 30s timeout for large batches
  },
  redis: {
    host: "localhost",
    port: 6379,
  },
  warmup: 100,           // Warmup jobs before benchmark
  iterations: 3,         // Number of benchmark iterations
};

// Benchmark scenarios
const SCENARIOS = {
  singlePush: { jobs: 10_000 },
  batchPush: { jobs: 100_000, batchSize: 1000 },
  processing: { jobs: 50_000, concurrency: 10 },
  highThroughput: { jobs: 50_000, concurrency: 10, batchSize: 100 },
  largePayload: { jobs: 5_000, payloadSize: 10_000 },  // 10KB payload
};

// ============================================================================
// Types
// ============================================================================

interface BenchmarkResult {
  name: string;
  system: "flashQ" | "BullMQ";
  scenario: string;
  jobCount: number;
  totalTimeMs: number;
  throughput: number;  // jobs/sec
  avgLatencyMs: number;
  p99LatencyMs?: number;
  memoryUsedMb?: number;
}

interface ScenarioResult {
  scenario: string;
  flashq: BenchmarkResult | null;
  bullmq: BenchmarkResult | null;
  speedup: number;  // flashQ speedup vs BullMQ
}

// ============================================================================
// Utilities
// ============================================================================

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function generatePayload(size: number): object {
  return {
    data: "x".repeat(size),
    timestamp: Date.now(),
    id: Math.random().toString(36),
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHeader(text: string): void {
  console.log("\n" + "=".repeat(70));
  console.log(` ${text}`);
  console.log("=".repeat(70));
}

function printResult(result: BenchmarkResult): void {
  console.log(`  ${result.system.padEnd(8)} | ${formatNumber(Math.round(result.throughput)).padStart(10)} jobs/sec | ${result.totalTimeMs.toFixed(0).padStart(6)}ms`);
}

// ============================================================================
// flashQ Benchmarks
// ============================================================================

async function benchFlashQSinglePush(jobCount: number): Promise<BenchmarkResult> {
  const client = new FlashQ(CONFIG.flashq);
  await client.connect();

  const queue = `bench-flashq-single-${Date.now()}`;

  // Warmup
  for (let i = 0; i < CONFIG.warmup; i++) {
    await client.push(queue, { warmup: i });
  }

  const start = performance.now();

  for (let i = 0; i < jobCount; i++) {
    await client.push(queue, { index: i, timestamp: Date.now() });
  }

  const totalTimeMs = performance.now() - start;

  // Cleanup
  await client.obliterate(queue);
  await client.close();

  return {
    name: "Single Push",
    system: "flashQ",
    scenario: "singlePush",
    jobCount,
    totalTimeMs,
    throughput: (jobCount / totalTimeMs) * 1000,
    avgLatencyMs: totalTimeMs / jobCount,
  };
}

async function benchFlashQBatchPush(jobCount: number, batchSize: number): Promise<BenchmarkResult> {
  const client = new FlashQ(CONFIG.flashq);
  await client.connect();

  const queue = `bench-flashq-batch-${Date.now()}`;

  // Prepare batches
  const batches: Array<Array<{ data: object }>> = [];
  for (let i = 0; i < jobCount; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < jobCount; j++) {
      batch.push({ data: { index: i + j } });
    }
    batches.push(batch);
  }

  const start = performance.now();

  for (const batch of batches) {
    await client.pushBatch(queue, batch);
  }

  const totalTimeMs = performance.now() - start;

  // Cleanup
  await client.obliterate(queue);
  await client.close();

  return {
    name: "Batch Push",
    system: "flashQ",
    scenario: "batchPush",
    jobCount,
    totalTimeMs,
    throughput: (jobCount / totalTimeMs) * 1000,
    avgLatencyMs: totalTimeMs / jobCount,
  };
}

async function benchFlashQProcessing(jobCount: number, concurrency: number): Promise<BenchmarkResult> {
  const client = new FlashQ(CONFIG.flashq);
  await client.connect();

  const queue = `bench-flashq-proc-${Date.now()}`;
  let completed = 0;

  // Push all jobs first (in batches)
  const batchSize = 1000;
  for (let i = 0; i < jobCount; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < jobCount; j++) {
      batch.push({ data: { index: i + j } });
    }
    await client.pushBatch(queue, batch);
  }

  // Create worker
  const worker = new FlashQWorker(queue, async (job) => {
    return { processed: true };
  }, {
    ...CONFIG.flashq,
    concurrency,
    batchSize: 100,
  });

  const start = performance.now();

  worker.on("completed", () => {
    completed++;
  });

  await worker.start();

  // Wait for completion
  while (completed < jobCount) {
    await sleep(50);
  }

  const totalTimeMs = performance.now() - start;

  await worker.stop();
  await client.obliterate(queue);
  await client.close();

  return {
    name: "Processing",
    system: "flashQ",
    scenario: "processing",
    jobCount,
    totalTimeMs,
    throughput: (jobCount / totalTimeMs) * 1000,
    avgLatencyMs: totalTimeMs / jobCount,
  };
}

async function benchFlashQHighThroughput(
  jobCount: number,
  concurrency: number,
  batchSize: number
): Promise<BenchmarkResult> {
  const client = new FlashQ({ ...CONFIG.flashq, timeout: 60000 });
  await client.connect();

  const queue = `bench-flashq-high-${Date.now()}`;
  let completed = 0;

  // Push jobs in moderate batches
  const pushBatchSize = 1000;
  for (let i = 0; i < jobCount; i += pushBatchSize) {
    const batch = [];
    for (let j = 0; j < pushBatchSize && i + j < jobCount; j++) {
      batch.push({ data: { i: i + j } });
    }
    await client.pushBatch(queue, batch);
  }

  // Create high-performance worker
  const worker = new FlashQWorker(queue, async () => ({ ok: true }), {
    ...CONFIG.flashq,
    timeout: 60000,
    concurrency,
    batchSize,
  });

  const start = performance.now();

  worker.on("completed", () => completed++);
  await worker.start();

  while (completed < jobCount) {
    await sleep(100);
  }

  const totalTimeMs = performance.now() - start;

  await worker.stop();
  await client.obliterate(queue);
  await client.close();

  return {
    name: "High Throughput",
    system: "flashQ",
    scenario: "highThroughput",
    jobCount,
    totalTimeMs,
    throughput: (jobCount / totalTimeMs) * 1000,
    avgLatencyMs: totalTimeMs / jobCount,
  };
}

async function benchFlashQLargePayload(jobCount: number, payloadSize: number): Promise<BenchmarkResult> {
  const client = new FlashQ(CONFIG.flashq);
  await client.connect();

  const queue = `bench-flashq-large-${Date.now()}`;
  const payload = generatePayload(payloadSize);

  const start = performance.now();

  for (let i = 0; i < jobCount; i++) {
    await client.push(queue, payload);
  }

  const totalTimeMs = performance.now() - start;

  await client.obliterate(queue);
  await client.close();

  return {
    name: "Large Payload",
    system: "flashQ",
    scenario: "largePayload",
    jobCount,
    totalTimeMs,
    throughput: (jobCount / totalTimeMs) * 1000,
    avgLatencyMs: totalTimeMs / jobCount,
  };
}

// ============================================================================
// BullMQ Benchmarks
// ============================================================================

async function benchBullMQSinglePush(jobCount: number): Promise<BenchmarkResult> {
  const connection = new IORedis(CONFIG.redis);
  const queue = new BullQueue(`bench-bull-single-${Date.now()}`, { connection });

  // Warmup
  for (let i = 0; i < CONFIG.warmup; i++) {
    await queue.add("job", { warmup: i });
  }

  const start = performance.now();

  for (let i = 0; i < jobCount; i++) {
    await queue.add("job", { index: i, timestamp: Date.now() });
  }

  const totalTimeMs = performance.now() - start;

  // Cleanup
  await queue.obliterate();
  await queue.close();
  await connection.quit();

  return {
    name: "Single Push",
    system: "BullMQ",
    scenario: "singlePush",
    jobCount,
    totalTimeMs,
    throughput: (jobCount / totalTimeMs) * 1000,
    avgLatencyMs: totalTimeMs / jobCount,
  };
}

async function benchBullMQBatchPush(jobCount: number, batchSize: number): Promise<BenchmarkResult> {
  const connection = new IORedis(CONFIG.redis);
  const queue = new BullQueue(`bench-bull-batch-${Date.now()}`, { connection });

  // Prepare batches
  const batches: Array<Array<{ name: string; data: object }>> = [];
  for (let i = 0; i < jobCount; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < jobCount; j++) {
      batch.push({ name: "job", data: { index: i + j } });
    }
    batches.push(batch);
  }

  const start = performance.now();

  for (const batch of batches) {
    await queue.addBulk(batch);
  }

  const totalTimeMs = performance.now() - start;

  await queue.obliterate();
  await queue.close();
  await connection.quit();

  return {
    name: "Batch Push",
    system: "BullMQ",
    scenario: "batchPush",
    jobCount,
    totalTimeMs,
    throughput: (jobCount / totalTimeMs) * 1000,
    avgLatencyMs: totalTimeMs / jobCount,
  };
}

async function benchBullMQProcessing(jobCount: number, concurrency: number): Promise<BenchmarkResult> {
  const connection = new IORedis({ ...CONFIG.redis, maxRetriesPerRequest: null });
  const queue = new BullQueue(`bench-bull-proc-${Date.now()}`, { connection });

  let completed = 0;

  // Push all jobs first (in batches for fairness)
  const batchSize = 1000;
  for (let i = 0; i < jobCount; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < jobCount; j++) {
      batch.push({ name: "job", data: { index: i + j } });
    }
    await queue.addBulk(batch);
  }

  // Create worker
  const worker = new BullWorker(
    queue.name,
    async () => ({ processed: true }),
    { connection, concurrency }
  );

  const start = performance.now();

  worker.on("completed", () => completed++);

  // Wait for completion
  while (completed < jobCount) {
    await sleep(50);
  }

  const totalTimeMs = performance.now() - start;

  await worker.close();
  await queue.obliterate();
  await queue.close();
  await connection.quit();

  return {
    name: "Processing",
    system: "BullMQ",
    scenario: "processing",
    jobCount,
    totalTimeMs,
    throughput: (jobCount / totalTimeMs) * 1000,
    avgLatencyMs: totalTimeMs / jobCount,
  };
}

async function benchBullMQHighThroughput(
  jobCount: number,
  concurrency: number,
  _batchSize: number
): Promise<BenchmarkResult> {
  const connection = new IORedis({ ...CONFIG.redis, maxRetriesPerRequest: null });
  const queue = new BullQueue(`bench-bull-high-${Date.now()}`, { connection });

  let completed = 0;

  // Push jobs in large batches
  const pushBatchSize = 10000;
  for (let i = 0; i < jobCount; i += pushBatchSize) {
    const batch = [];
    for (let j = 0; j < pushBatchSize && i + j < jobCount; j++) {
      batch.push({ name: "job", data: { i: i + j } });
    }
    await queue.addBulk(batch);
  }

  // Create worker
  const worker = new BullWorker(
    queue.name,
    async () => ({ ok: true }),
    { connection, concurrency }
  );

  const start = performance.now();

  worker.on("completed", () => completed++);

  while (completed < jobCount) {
    await sleep(100);
  }

  const totalTimeMs = performance.now() - start;

  await worker.close();
  await queue.obliterate();
  await queue.close();
  await connection.quit();

  return {
    name: "High Throughput",
    system: "BullMQ",
    scenario: "highThroughput",
    jobCount,
    totalTimeMs,
    throughput: (jobCount / totalTimeMs) * 1000,
    avgLatencyMs: totalTimeMs / jobCount,
  };
}

async function benchBullMQLargePayload(jobCount: number, payloadSize: number): Promise<BenchmarkResult> {
  const connection = new IORedis(CONFIG.redis);
  const queue = new BullQueue(`bench-bull-large-${Date.now()}`, { connection });

  const payload = generatePayload(payloadSize);

  const start = performance.now();

  for (let i = 0; i < jobCount; i++) {
    await queue.add("job", payload);
  }

  const totalTimeMs = performance.now() - start;

  await queue.obliterate();
  await queue.close();
  await connection.quit();

  return {
    name: "Large Payload",
    system: "BullMQ",
    scenario: "largePayload",
    jobCount,
    totalTimeMs,
    throughput: (jobCount / totalTimeMs) * 1000,
    avgLatencyMs: totalTimeMs / jobCount,
  };
}

// ============================================================================
// Main Benchmark Runner
// ============================================================================

async function runBenchmarks(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const args = process.argv.slice(2);
  const flashqOnly = args.includes("--flashq-only");
  const bullmqOnly = args.includes("--bullmq-only");

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║           flashQ vs BullMQ Performance Benchmark                     ║");
  console.log("╠══════════════════════════════════════════════════════════════════════╣");
  console.log(`║  Date: ${new Date().toISOString().padEnd(62)}║`);
  console.log(`║  Platform: ${process.platform} ${process.arch}`.padEnd(71) + "║");
  console.log(`║  Bun: ${Bun.version}`.padEnd(71) + "║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  // ----- Single Push -----
  printHeader("Scenario 1: Single Job Push");
  console.log(`  Jobs: ${formatNumber(SCENARIOS.singlePush.jobs)}`);

  let flashqResult: BenchmarkResult | null = null;
  let bullmqResult: BenchmarkResult | null = null;

  if (!bullmqOnly) {
    flashqResult = await benchFlashQSinglePush(SCENARIOS.singlePush.jobs);
    printResult(flashqResult);
  }

  if (!flashqOnly) {
    bullmqResult = await benchBullMQSinglePush(SCENARIOS.singlePush.jobs);
    printResult(bullmqResult);
  }

  results.push({
    scenario: "Single Push",
    flashq: flashqResult,
    bullmq: bullmqResult,
    speedup: flashqResult && bullmqResult ? flashqResult.throughput / bullmqResult.throughput : 0,
  });

  // ----- Batch Push -----
  printHeader("Scenario 2: Batch Push");
  console.log(`  Jobs: ${formatNumber(SCENARIOS.batchPush.jobs)} (batch size: ${SCENARIOS.batchPush.batchSize})`);

  flashqResult = null;
  bullmqResult = null;

  if (!bullmqOnly) {
    flashqResult = await benchFlashQBatchPush(SCENARIOS.batchPush.jobs, SCENARIOS.batchPush.batchSize);
    printResult(flashqResult);
  }

  if (!flashqOnly) {
    bullmqResult = await benchBullMQBatchPush(SCENARIOS.batchPush.jobs, SCENARIOS.batchPush.batchSize);
    printResult(bullmqResult);
  }

  results.push({
    scenario: "Batch Push",
    flashq: flashqResult,
    bullmq: bullmqResult,
    speedup: flashqResult && bullmqResult ? flashqResult.throughput / bullmqResult.throughput : 0,
  });

  // ----- Processing -----
  printHeader("Scenario 3: Job Processing");
  console.log(`  Jobs: ${formatNumber(SCENARIOS.processing.jobs)} (concurrency: ${SCENARIOS.processing.concurrency})`);

  flashqResult = null;
  bullmqResult = null;

  if (!bullmqOnly) {
    flashqResult = await benchFlashQProcessing(SCENARIOS.processing.jobs, SCENARIOS.processing.concurrency);
    printResult(flashqResult);
  }

  if (!flashqOnly) {
    bullmqResult = await benchBullMQProcessing(SCENARIOS.processing.jobs, SCENARIOS.processing.concurrency);
    printResult(bullmqResult);
  }

  results.push({
    scenario: "Processing",
    flashq: flashqResult,
    bullmq: bullmqResult,
    speedup: flashqResult && bullmqResult ? flashqResult.throughput / bullmqResult.throughput : 0,
  });

  // ----- High Throughput -----
  printHeader("Scenario 4: High Throughput");
  console.log(`  Jobs: ${formatNumber(SCENARIOS.highThroughput.jobs)} (concurrency: ${SCENARIOS.highThroughput.concurrency})`);

  flashqResult = null;
  bullmqResult = null;

  if (!bullmqOnly) {
    flashqResult = await benchFlashQHighThroughput(
      SCENARIOS.highThroughput.jobs,
      SCENARIOS.highThroughput.concurrency,
      SCENARIOS.highThroughput.batchSize
    );
    printResult(flashqResult);
  }

  if (!flashqOnly) {
    bullmqResult = await benchBullMQHighThroughput(
      SCENARIOS.highThroughput.jobs,
      SCENARIOS.highThroughput.concurrency,
      SCENARIOS.highThroughput.batchSize
    );
    printResult(bullmqResult);
  }

  results.push({
    scenario: "High Throughput",
    flashq: flashqResult,
    bullmq: bullmqResult,
    speedup: flashqResult && bullmqResult ? flashqResult.throughput / bullmqResult.throughput : 0,
  });

  // ----- Large Payload -----
  printHeader("Scenario 5: Large Payload (10KB)");
  console.log(`  Jobs: ${formatNumber(SCENARIOS.largePayload.jobs)}`);

  flashqResult = null;
  bullmqResult = null;

  if (!bullmqOnly) {
    flashqResult = await benchFlashQLargePayload(SCENARIOS.largePayload.jobs, SCENARIOS.largePayload.payloadSize);
    printResult(flashqResult);
  }

  if (!flashqOnly) {
    bullmqResult = await benchBullMQLargePayload(SCENARIOS.largePayload.jobs, SCENARIOS.largePayload.payloadSize);
    printResult(bullmqResult);
  }

  results.push({
    scenario: "Large Payload",
    flashq: flashqResult,
    bullmq: bullmqResult,
    speedup: flashqResult && bullmqResult ? flashqResult.throughput / bullmqResult.throughput : 0,
  });

  return results;
}

function printSummary(results: ScenarioResult[]): void {
  printHeader("SUMMARY: flashQ vs BullMQ");

  console.log("\n  ┌─────────────────────┬────────────────┬────────────────┬──────────┐");
  console.log("  │ Scenario            │ flashQ (j/s)   │ BullMQ (j/s)   │ Speedup  │");
  console.log("  ├─────────────────────┼────────────────┼────────────────┼──────────┤");

  for (const r of results) {
    const flashqStr = r.flashq ? formatNumber(Math.round(r.flashq.throughput)).padStart(12) : "N/A".padStart(12);
    const bullmqStr = r.bullmq ? formatNumber(Math.round(r.bullmq.throughput)).padStart(12) : "N/A".padStart(12);
    const speedupStr = r.speedup > 0 ? `${r.speedup.toFixed(1)}x`.padStart(6) : "N/A".padStart(6);
    console.log(`  │ ${r.scenario.padEnd(19)} │ ${flashqStr}   │ ${bullmqStr}   │ ${speedupStr}   │`);
  }

  console.log("  └─────────────────────┴────────────────┴────────────────┴──────────┘");

  // Calculate average speedup
  const validSpeedups = results.filter(r => r.speedup > 0).map(r => r.speedup);
  if (validSpeedups.length > 0) {
    const avgSpeedup = validSpeedups.reduce((a, b) => a + b, 0) / validSpeedups.length;
    console.log(`\n  Average speedup: ${avgSpeedup.toFixed(1)}x faster than BullMQ`);
  }
}

function generateMarkdownReport(results: ScenarioResult[]): string {
  const date = new Date().toISOString().split("T")[0];

  let md = `# flashQ vs BullMQ Performance Benchmark

**Date:** ${date}
**Platform:** ${process.platform} ${process.arch}
**Bun Version:** ${Bun.version}

## Results

| Scenario | flashQ (jobs/sec) | BullMQ (jobs/sec) | Speedup |
|----------|-------------------|-------------------|---------|
`;

  for (const r of results) {
    const flashqStr = r.flashq ? formatNumber(Math.round(r.flashq.throughput)) : "N/A";
    const bullmqStr = r.bullmq ? formatNumber(Math.round(r.bullmq.throughput)) : "N/A";
    const speedupStr = r.speedup > 0 ? `**${r.speedup.toFixed(1)}x**` : "N/A";
    md += `| ${r.scenario} | ${flashqStr} | ${bullmqStr} | ${speedupStr} |\n`;
  }

  const validSpeedups = results.filter(r => r.speedup > 0).map(r => r.speedup);
  const avgSpeedup = validSpeedups.length > 0
    ? (validSpeedups.reduce((a, b) => a + b, 0) / validSpeedups.length).toFixed(1)
    : "N/A";

  md += `
## Summary

**flashQ is ${avgSpeedup}x faster than BullMQ on average.**

### Why flashQ is faster

1. **Rust vs Node.js** - No garbage collection pauses, zero-cost abstractions
2. **In-memory first** - Optional PostgreSQL persistence, no Redis dependency
3. **Batch operations** - Native batch push/pull/ack for high throughput
4. **32 sharded queues** - Parallel access with minimal lock contention
5. **Binary protocol** - MessagePack support for 40% smaller payloads
6. **Lock-free data structures** - DashMap for O(1) concurrent lookups

### Test Configuration

| Parameter | Value |
|-----------|-------|
| Single Push Jobs | ${formatNumber(SCENARIOS.singlePush.jobs)} |
| Batch Push Jobs | ${formatNumber(SCENARIOS.batchPush.jobs)} |
| Batch Size | ${SCENARIOS.batchPush.batchSize} |
| Processing Jobs | ${formatNumber(SCENARIOS.processing.jobs)} |
| High Throughput Jobs | ${formatNumber(SCENARIOS.highThroughput.jobs)} |
| Concurrency | ${SCENARIOS.highThroughput.concurrency} workers |
| Large Payload Size | ${SCENARIOS.largePayload.payloadSize / 1000}KB |

## How to Reproduce

\`\`\`bash
# Start flashQ server
cd engine && HTTP=1 cargo run --release

# Start Redis (for BullMQ)
docker run -d -p 6379:6379 redis:alpine

# Run benchmarks
cd benchmarks && bun install && bun run benchmark.ts
\`\`\`
`;

  return md;
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    const results = await runBenchmarks();
    printSummary(results);

    // Save markdown report
    const report = generateMarkdownReport(results);
    await Bun.write("BENCHMARK_RESULTS.md", report);
    console.log("\n  Report saved to: BENCHMARK_RESULTS.md");

    // Save JSON results
    await Bun.write("benchmark-results.json", JSON.stringify(results, null, 2));
    console.log("  JSON saved to: benchmark-results.json\n");

  } catch (error) {
    console.error("Benchmark failed:", error);
    process.exit(1);
  }
}

main();
