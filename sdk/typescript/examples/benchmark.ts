/**
 * FlashQ Benchmark Suite - Full Scale Test
 * Tests: Push + Wait for Worker Completion
 * Run: bun run examples/benchmark.ts
 */

import { FlashQ, Worker } from '../src';

const QUEUE_NAME = 'benchmark-queue';

interface BenchmarkResult {
  jobs: number;
  pushDurationMs: number;
  consumeDurationMs: number;
  totalDurationMs: number;
  pushOpsPerSec: number;
  consumeOpsPerSec: number;
  totalOpsPerSec: number;
}

async function resetServer() {
  await fetch('http://localhost:6790/server/reset', { method: 'POST' });
}

async function runBenchmark(totalJobs: number): Promise<BenchmarkResult> {
  const client = new FlashQ({ host: 'localhost', port: 6789 });
  await client.connect();

  // ============== PUSH PHASE ==============
  const batchSize = Math.min(1000, totalJobs);
  const batches = Math.ceil(totalJobs / batchSize);

  const pushStart = Date.now();

  if (totalJobs === 1) {
    await client.push(QUEUE_NAME, { id: 0 });
  } else {
    for (let b = 0; b < batches; b++) {
      const jobs = [];
      const remaining = Math.min(batchSize, totalJobs - b * batchSize);
      for (let i = 0; i < remaining; i++) {
        jobs.push({ data: { id: b * batchSize + i } });
      }
      await client.pushBatch(QUEUE_NAME, jobs);
    }
  }

  const pushDuration = Date.now() - pushStart;
  await client.close();

  // ============== CONSUME PHASE ==============
  let processed = 0;
  const workers: Worker[] = [];
  const numWorkers = Math.min(10, Math.max(1, Math.ceil(totalJobs / 1000)));
  const concurrency = 10;

  // Start workers
  for (let i = 0; i < numWorkers; i++) {
    const worker = new Worker(
      QUEUE_NAME,
      async () => {
        processed++;
        return { ok: true };
      },
      {
        id: `bench-worker-${i}`,
        host: 'localhost',
        port: 6789,
        concurrency,
        heartbeatInterval: 300000, // Long interval for benchmark
      }
    );
    workers.push(worker);
  }

  await Promise.all(workers.map((w) => w.start()));

  const consumeStart = Date.now();

  // Wait for all jobs to be processed
  while (processed < totalJobs) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const consumeDuration = Date.now() - consumeStart;

  await Promise.all(workers.map((w) => w.stop()));

  const totalDuration = pushDuration + consumeDuration;

  return {
    jobs: totalJobs,
    pushDurationMs: pushDuration,
    consumeDurationMs: consumeDuration,
    totalDurationMs: totalDuration,
    pushOpsPerSec: pushDuration > 0 ? Math.round((totalJobs / pushDuration) * 1000) : totalJobs * 1000,
    consumeOpsPerSec: consumeDuration > 0 ? Math.round((totalJobs / consumeDuration) * 1000) : totalJobs * 1000,
    totalOpsPerSec: totalDuration > 0 ? Math.round((totalJobs / totalDuration) * 1000) : totalJobs * 1000,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatOps(ops: number): string {
  if (ops >= 1000000) return `${(ops / 1000000).toFixed(2)}M`;
  if (ops >= 1000) return `${(ops / 1000).toFixed(1)}K`;
  return `${ops}`;
}

// ============== MAIN ==============

async function main() {
  console.log('# FlashQ Benchmark Results\n');
  console.log('```');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Runtime: Bun ${Bun.version}`);
  console.log(`Server: flashQ (Rust) with TCP protocol`);
  console.log('```\n');

  // Test sizes from 1 to 1M
  const sizes = [
    1,
    10,
    100,
    1_000,
    10_000,
    100_000,
    1_000_000,
  ];

  console.log('## End-to-End Throughput (Push + Worker Processing)\n');
  console.log('| Jobs | Push Time | Process Time | Total Time | Push ops/s | Process ops/s | Total ops/s |');
  console.log('|------|-----------|--------------|------------|------------|---------------|-------------|');

  const results: BenchmarkResult[] = [];

  for (const size of sizes) {
    await resetServer();

    process.stdout.write(`Testing ${size.toLocaleString()} jobs... `);

    try {
      const result = await runBenchmark(size);
      results.push(result);

      console.log(
        `| ${size.toLocaleString()} | ${formatDuration(result.pushDurationMs)} | ${formatDuration(result.consumeDurationMs)} | ${formatDuration(result.totalDurationMs)} | **${formatOps(result.pushOpsPerSec)}** | **${formatOps(result.consumeOpsPerSec)}** | **${formatOps(result.totalOpsPerSec)}** |`
      );
    } catch (e: any) {
      console.log(`| ${size.toLocaleString()} | ERROR | - | - | ${e.message} | - | - |`);
      break;
    }
  }

  // Summary
  console.log('\n## Peak Performance\n');

  if (results.length > 0) {
    const maxPush = results.reduce((a, b) => (a.pushOpsPerSec > b.pushOpsPerSec ? a : b));
    const maxConsume = results.reduce((a, b) => (a.consumeOpsPerSec > b.consumeOpsPerSec ? a : b));
    const maxTotal = results.reduce((a, b) => (a.totalOpsPerSec > b.totalOpsPerSec ? a : b));

    console.log(`- **Push Peak**: ${formatOps(maxPush.pushOpsPerSec)} ops/sec (${maxPush.jobs.toLocaleString()} jobs)`);
    console.log(`- **Process Peak**: ${formatOps(maxConsume.consumeOpsPerSec)} ops/sec (${maxConsume.jobs.toLocaleString()} jobs)`);
    console.log(`- **Total Peak**: ${formatOps(maxTotal.totalOpsPerSec)} ops/sec (${maxTotal.jobs.toLocaleString()} jobs)`);
  }

  console.log('\n✅ Benchmark complete!');

  await resetServer();
  process.exit(0);
}

main().catch((e) => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
