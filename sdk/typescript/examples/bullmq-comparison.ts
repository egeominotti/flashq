/**
 * flashQ vs BullMQ - Real Benchmark Comparison
 *
 * Prerequisites:
 * 1. Redis running: docker run -d -p 6379:6379 redis
 * 2. flashQ running: make persist (or cargo run --release)
 * 3. Install BullMQ: bun add bullmq
 *
 * Run: bun run examples/bullmq-comparison.ts
 */

import { Queue as FlashQueue } from '../src';
import { Queue as BullQueue, Worker as BullWorker } from 'bullmq';

const REDIS_HOST = 'localhost';
const REDIS_PORT = 6379;
const FLASHQ_HOST = 'localhost';
const FLASHQ_PORT = 6789;

// Test configurations
const SINGLE_OPS = 1000;
const BATCH_SIZE = 1000;
const BATCH_COUNT = 10;

interface BenchmarkResult {
  name: string;
  flashQ: number;
  bullMQ: number;
  winner: string;
  improvement: string;
}

const results: BenchmarkResult[] = [];

function formatOps(ops: number): string {
  if (ops >= 1000000) return `${(ops / 1000000).toFixed(2)}M`;
  if (ops >= 1000) return `${(ops / 1000).toFixed(1)}K`;
  return ops.toFixed(0);
}

async function benchmark(name: string, flashQFn: () => Promise<void>, bullMQFn: () => Promise<void>, count: number) {
  console.log(`\n⏱️  ${name}...`);

  // flashQ
  const flashStart = performance.now();
  await flashQFn();
  const flashTime = performance.now() - flashStart;
  const flashOps = (count / flashTime) * 1000;

  // BullMQ
  const bullStart = performance.now();
  await bullMQFn();
  const bullTime = performance.now() - bullStart;
  const bullOps = (count / bullTime) * 1000;

  const winner = flashOps > bullOps ? 'flashQ' : 'BullMQ';
  const ratio = flashOps > bullOps ? flashOps / bullOps : bullOps / flashOps;
  const improvement = `${ratio.toFixed(1)}x`;

  results.push({
    name,
    flashQ: flashOps,
    bullMQ: bullOps,
    winner,
    improvement
  });

  console.log(`   flashQ: ${formatOps(flashOps)} ops/sec (${flashTime.toFixed(0)}ms)`);
  console.log(`   BullMQ: ${formatOps(bullOps)} ops/sec (${bullTime.toFixed(0)}ms)`);
  console.log(`   Winner: ${winner} (${improvement} faster)`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          flashQ vs BullMQ - Real Benchmark                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Initialize flashQ
  const flashQueue = new FlashQueue('benchmark-flash', {
    connection: { host: FLASHQ_HOST, port: FLASHQ_PORT }
  });

  // Initialize BullMQ
  const bullQueue = new BullQueue('benchmark-bull', {
    connection: { host: REDIS_HOST, port: REDIS_PORT }
  });

  try {
    // ═══════════════════════════════════════════════════════════════
    // Test 1: Sequential Push
    // ═══════════════════════════════════════════════════════════════
    await benchmark(
      `Sequential Push (${SINGLE_OPS} jobs)`,
      async () => {
        for (let i = 0; i < SINGLE_OPS; i++) {
          await flashQueue.add({ index: i, data: 'test' });
        }
      },
      async () => {
        for (let i = 0; i < SINGLE_OPS; i++) {
          await bullQueue.add('job', { index: i, data: 'test' });
        }
      },
      SINGLE_OPS
    );

    // ═══════════════════════════════════════════════════════════════
    // Test 2: Batch Push
    // ═══════════════════════════════════════════════════════════════
    const totalBatchJobs = BATCH_SIZE * BATCH_COUNT;

    await benchmark(
      `Batch Push (${totalBatchJobs} jobs, ${BATCH_COUNT} batches of ${BATCH_SIZE})`,
      async () => {
        for (let b = 0; b < BATCH_COUNT; b++) {
          const jobs = Array.from({ length: BATCH_SIZE }, (_, i) => ({
            data: { batch: b, index: i }
          }));
          await flashQueue.addBulk(jobs);
        }
      },
      async () => {
        for (let b = 0; b < BATCH_COUNT; b++) {
          const jobs = Array.from({ length: BATCH_SIZE }, (_, i) => ({
            name: 'job',
            data: { batch: b, index: i }
          }));
          await bullQueue.addBulk(jobs);
        }
      },
      totalBatchJobs
    );

    // ═══════════════════════════════════════════════════════════════
    // Test 3: Push with Options
    // ═══════════════════════════════════════════════════════════════
    await benchmark(
      `Push with Priority (${SINGLE_OPS} jobs)`,
      async () => {
        for (let i = 0; i < SINGLE_OPS; i++) {
          await flashQueue.add({ index: i }, { priority: i % 10 });
        }
      },
      async () => {
        for (let i = 0; i < SINGLE_OPS; i++) {
          await bullQueue.add('job', { index: i }, { priority: i % 10 });
        }
      },
      SINGLE_OPS
    );

    // ═══════════════════════════════════════════════════════════════
    // Test 4: Push with Delay
    // ═══════════════════════════════════════════════════════════════
    await benchmark(
      `Push with Delay (${SINGLE_OPS} jobs)`,
      async () => {
        for (let i = 0; i < SINGLE_OPS; i++) {
          await flashQueue.add({ index: i }, { delay: 60000 }); // 1 minute delay
        }
      },
      async () => {
        for (let i = 0; i < SINGLE_OPS; i++) {
          await bullQueue.add('job', { index: i }, { delay: 60000 });
        }
      },
      SINGLE_OPS
    );

    // ═══════════════════════════════════════════════════════════════
    // Test 5: Large Payload
    // ═══════════════════════════════════════════════════════════════
    const largePayload = { data: 'x'.repeat(10000) }; // 10KB payload
    const LARGE_OPS = 500;

    await benchmark(
      `Large Payload 10KB (${LARGE_OPS} jobs)`,
      async () => {
        for (let i = 0; i < LARGE_OPS; i++) {
          await flashQueue.add({ ...largePayload, index: i });
        }
      },
      async () => {
        for (let i = 0; i < LARGE_OPS; i++) {
          await bullQueue.add('job', { ...largePayload, index: i });
        }
      },
      LARGE_OPS
    );

    // ═══════════════════════════════════════════════════════════════
    // Results Summary
    // ═══════════════════════════════════════════════════════════════
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                      RESULTS SUMMARY                       ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('┌─────────────────────────────┬───────────┬───────────┬────────────┐');
    console.log('│ Test                        │ flashQ    │ BullMQ    │ Winner     │');
    console.log('├─────────────────────────────┼───────────┼───────────┼────────────┤');

    for (const r of results) {
      const name = r.name.substring(0, 27).padEnd(27);
      const flash = formatOps(r.flashQ).padStart(9);
      const bull = formatOps(r.bullMQ).padStart(9);
      const winner = `${r.winner} ${r.improvement}`.padEnd(10);
      console.log(`│ ${name} │ ${flash} │ ${bull} │ ${winner} │`);
    }

    console.log('└─────────────────────────────┴───────────┴───────────┴────────────┘');

    // Calculate averages
    const flashQWins = results.filter(r => r.winner === 'flashQ').length;
    const avgImprovement = results
      .filter(r => r.winner === 'flashQ')
      .reduce((acc, r) => acc + r.flashQ / r.bullMQ, 0) / flashQWins;

    console.log('');
    console.log(`flashQ wins: ${flashQWins}/${results.length} tests`);
    if (flashQWins > 0) {
      console.log(`Average improvement: ${avgImprovement.toFixed(1)}x faster`);
    }

  } finally {
    // Cleanup
    await flashQueue.close();
    await bullQueue.close();
  }
}

main().catch(console.error);
