/**
 * BENCHMARK: flashQ vs BullMQ
 *
 * Direct comparison on the same hardware with identical workload.
 *
 * Run: bun run examples/benchmark-flashq-vs-bullmq.ts
 */

import { FlashQ, Worker as FlashQWorker } from '../src';
import { Queue as BullQueue, Worker as BullWorker } from 'bullmq';
import Redis from 'ioredis';

const TOTAL_JOBS = 50_000;
const BATCH_SIZE = 500;
const CONCURRENCY = 100;
const NUM_WORKERS = 8;

interface BenchmarkResult {
  name: string;
  pushTime: number;
  pushRate: number;
  processTime: number;
  processRate: number;
  totalTime: number;
  throughput: number;
}

// ============================================================
// flashQ Benchmark
// ============================================================
async function benchmarkFlashQ(): Promise<BenchmarkResult> {
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│           flashQ Benchmark              │');
  console.log('└─────────────────────────────────────────┘\n');

  const client = new FlashQ({ timeout: 30000 });
  await client.connect();

  const queueName = 'bench-flashq';
  await client.obliterate(queueName);

  let completed = 0;
  const workers: FlashQWorker[] = [];

  // Create workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new FlashQWorker(
      queueName,
      async () => ({ ok: true }),
      { host: 'localhost', port: 6789, concurrency: CONCURRENCY, timeout: 30000 }
    );
    worker.on('completed', () => completed++);
    workers.push(worker);
  }

  await Promise.all(workers.map(w => w.start()));

  // Push jobs
  const startTime = Date.now();
  const pushStart = Date.now();

  for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_JOBS - i) }, (_, j) => ({
      data: { i: i + j },
    }));
    await client.pushBatch(queueName, batch);
  }

  const pushTime = Date.now() - pushStart;
  console.log(`  Push: ${TOTAL_JOBS.toLocaleString()} jobs in ${pushTime}ms`);

  // Wait for completion
  const processStart = Date.now();
  while (completed < TOTAL_JOBS) {
    await new Promise(r => setTimeout(r, 10));
  }
  const processTime = Date.now() - processStart;
  const totalTime = Date.now() - startTime;

  console.log(`  Process: ${completed.toLocaleString()} jobs in ${processTime}ms`);

  // Cleanup
  await Promise.all(workers.map(w => w.stop()));
  await client.obliterate(queueName);
  await client.close();

  return {
    name: 'flashQ',
    pushTime,
    pushRate: Math.round((TOTAL_JOBS / pushTime) * 1000),
    processTime,
    processRate: Math.round((TOTAL_JOBS / processTime) * 1000),
    totalTime,
    throughput: Math.round((TOTAL_JOBS / totalTime) * 1000),
  };
}

// ============================================================
// BullMQ Benchmark
// ============================================================
async function benchmarkBullMQ(): Promise<BenchmarkResult> {
  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│           BullMQ Benchmark              │');
  console.log('└─────────────────────────────────────────┘\n');

  const connection = new Redis({ maxRetriesPerRequest: null });
  const queueName = 'bench-bullmq';

  // Clean up
  const queue = new BullQueue(queueName, { connection });
  await queue.obliterate({ force: true });

  let completed = 0;
  const workers: BullWorker[] = [];

  // Create workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new BullWorker(
      queueName,
      async () => ({ ok: true }),
      { connection, concurrency: CONCURRENCY }
    );
    worker.on('completed', () => completed++);
    workers.push(worker);
  }

  // Push jobs
  const startTime = Date.now();
  const pushStart = Date.now();

  for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_JOBS - i) }, (_, j) => ({
      name: 'job',
      data: { i: i + j },
    }));
    await queue.addBulk(batch);
  }

  const pushTime = Date.now() - pushStart;
  console.log(`  Push: ${TOTAL_JOBS.toLocaleString()} jobs in ${pushTime}ms`);

  // Wait for completion
  const processStart = Date.now();
  while (completed < TOTAL_JOBS) {
    await new Promise(r => setTimeout(r, 10));
  }
  const processTime = Date.now() - processStart;
  const totalTime = Date.now() - startTime;

  console.log(`  Process: ${completed.toLocaleString()} jobs in ${processTime}ms`);

  // Cleanup
  await Promise.all(workers.map(w => w.close()));
  await queue.obliterate({ force: true });
  await queue.close();
  await connection.quit();

  return {
    name: 'BullMQ',
    pushTime,
    pushRate: Math.round((TOTAL_JOBS / pushTime) * 1000),
    processTime,
    processRate: Math.round((TOTAL_JOBS / processTime) * 1000),
    totalTime,
    throughput: Math.round((TOTAL_JOBS / totalTime) * 1000),
  };
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║         BENCHMARK: flashQ vs BullMQ                       ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Jobs: ${TOTAL_JOBS.toLocaleString().padEnd(10)} Workers: ${NUM_WORKERS}    Concurrency: ${CONCURRENCY}    ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');

  // Run benchmarks
  const flashqResult = await benchmarkFlashQ();
  const bullmqResult = await benchmarkBullMQ();

  // Results
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                      RESULTS                              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('┌────────────────┬────────────────┬────────────────┬─────────┐');
  console.log('│ Metric         │ flashQ         │ BullMQ         │ Winner  │');
  console.log('├────────────────┼────────────────┼────────────────┼─────────┤');

  const metrics = [
    {
      name: 'Push Rate',
      flashq: `${flashqResult.pushRate.toLocaleString()}/s`,
      bullmq: `${bullmqResult.pushRate.toLocaleString()}/s`,
      winner: flashqResult.pushRate > bullmqResult.pushRate ? 'flashQ' : 'BullMQ',
      ratio: flashqResult.pushRate / bullmqResult.pushRate,
    },
    {
      name: 'Process Rate',
      flashq: `${flashqResult.processRate.toLocaleString()}/s`,
      bullmq: `${bullmqResult.processRate.toLocaleString()}/s`,
      winner: flashqResult.processRate > bullmqResult.processRate ? 'flashQ' : 'BullMQ',
      ratio: flashqResult.processRate / bullmqResult.processRate,
    },
    {
      name: 'Total Time',
      flashq: `${flashqResult.totalTime}ms`,
      bullmq: `${bullmqResult.totalTime}ms`,
      winner: flashqResult.totalTime < bullmqResult.totalTime ? 'flashQ' : 'BullMQ',
      ratio: bullmqResult.totalTime / flashqResult.totalTime,
    },
    {
      name: 'Throughput',
      flashq: `${flashqResult.throughput.toLocaleString()}/s`,
      bullmq: `${bullmqResult.throughput.toLocaleString()}/s`,
      winner: flashqResult.throughput > bullmqResult.throughput ? 'flashQ' : 'BullMQ',
      ratio: flashqResult.throughput / bullmqResult.throughput,
    },
  ];

  for (const m of metrics) {
    const flashqPad = m.flashq.padEnd(14);
    const bullmqPad = m.bullmq.padEnd(14);
    const winnerPad = m.winner.padEnd(7);
    console.log(`│ ${m.name.padEnd(14)} │ ${flashqPad} │ ${bullmqPad} │ ${winnerPad} │`);
  }

  console.log('└────────────────┴────────────────┴────────────────┴─────────┘');

  // Summary
  const speedup = (flashqResult.throughput / bullmqResult.throughput).toFixed(1);
  console.log(`\n🏆 flashQ is ${speedup}x faster than BullMQ\n`);
}

main().catch(console.error);
