/**
 * flashQ vs BullMQ - Latency Benchmark with Statistical Analysis
 *
 * Measures:
 * - P50, P95, P99, P99.9 latencies
 * - Mean, Median, Std Dev
 * - Min/Max
 *
 * Prerequisites:
 * 1. Redis: docker run -d -p 6379:6379 redis
 * 2. flashQ: HTTP=1 cargo run --release
 * 3. BullMQ: bun add bullmq
 *
 * Run: bun run examples/latency-benchmark.ts
 */

import { FlashQ } from '../src';
import { Queue as BullQueue } from 'bullmq';

const WARMUP_OPS = 100;
const TEST_OPS = 1000;

interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
  p50: number;
  p95: number;
  p99: number;
  p999: number;
}

function calculateStats(latencies: number[]): LatencyStats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;

  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const squaredDiffs = sorted.map(x => Math.pow(x - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / n;
  const stdDev = Math.sqrt(variance);

  const percentile = (p: number) => {
    const idx = Math.ceil((p / 100) * n) - 1;
    return sorted[Math.max(0, idx)];
  };

  return {
    count: n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: percentile(50),
    stdDev,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    p999: percentile(99.9),
  };
}

function formatMs(us: number): string {
  if (us >= 1000) return `${(us / 1000).toFixed(2)}ms`;
  return `${us.toFixed(0)}μs`;
}

function printStats(name: string, stats: LatencyStats) {
  console.log(`\n📊 ${name}`);
  console.log(`   Operations: ${stats.count}`);
  console.log(`   Min:    ${formatMs(stats.min)}`);
  console.log(`   Max:    ${formatMs(stats.max)}`);
  console.log(`   Mean:   ${formatMs(stats.mean)}`);
  console.log(`   StdDev: ${formatMs(stats.stdDev)}`);
  console.log(`   ─────────────────────`);
  console.log(`   P50:    ${formatMs(stats.p50)}`);
  console.log(`   P95:    ${formatMs(stats.p95)}`);
  console.log(`   P99:    ${formatMs(stats.p99)}`);
  console.log(`   P99.9:  ${formatMs(stats.p999)}`);
}

async function measureLatency(name: string, fn: () => Promise<void>, ops: number): Promise<LatencyStats> {
  const latencies: number[] = [];

  // Warmup
  console.log(`   Warming up ${name}...`);
  for (let i = 0; i < WARMUP_OPS; i++) {
    await fn();
  }

  // Measure
  console.log(`   Measuring ${name} (${ops} ops)...`);
  for (let i = 0; i < ops; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    latencies.push((end - start) * 1000); // Convert to microseconds
  }

  return calculateStats(latencies);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       flashQ vs BullMQ - Latency Analysis                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Warmup: ${WARMUP_OPS} ops | Test: ${TEST_OPS} ops`);

  // Initialize clients
  const flashQ = new FlashQ({ host: 'localhost', port: 6789 });
  await flashQ.connect();

  const bullQueue = new BullQueue('latency-test', {
    connection: { host: 'localhost', port: 6379 }
  });

  const results: { test: string; flashQ: LatencyStats; bullMQ: LatencyStats }[] = [];

  try {
    // ═══════════════════════════════════════════════════════════════
    // Test 1: Single Push Latency
    // ═══════════════════════════════════════════════════════════════
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 1: Single Push Latency');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    let counter = 0;

    const flashPushStats = await measureLatency(
      'flashQ Push',
      async () => { await flashQ.add('latency', { i: counter++ }); },
      TEST_OPS
    );

    const bullPushStats = await measureLatency(
      'BullMQ Push',
      async () => { await bullQueue.add('job', { i: counter++ }); },
      TEST_OPS
    );

    results.push({ test: 'Single Push', flashQ: flashPushStats, bullMQ: bullPushStats });

    printStats('flashQ Single Push', flashPushStats);
    printStats('BullMQ Single Push', bullPushStats);

    // ═══════════════════════════════════════════════════════════════
    // Test 2: Push with Priority
    // ═══════════════════════════════════════════════════════════════
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 2: Push with Priority');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const flashPriorityStats = await measureLatency(
      'flashQ Priority Push',
      async () => { await flashQ.add('latency', { i: counter++ }, { priority: counter % 10 }); },
      TEST_OPS
    );

    const bullPriorityStats = await measureLatency(
      'BullMQ Priority Push',
      async () => { await bullQueue.add('job', { i: counter++ }, { priority: counter % 10 }); },
      TEST_OPS
    );

    results.push({ test: 'Priority Push', flashQ: flashPriorityStats, bullMQ: bullPriorityStats });

    printStats('flashQ Priority Push', flashPriorityStats);
    printStats('BullMQ Priority Push', bullPriorityStats);

    // ═══════════════════════════════════════════════════════════════
    // Test 3: Small Payload (100 bytes)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 3: Small Payload (100 bytes)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const smallPayload = { data: 'x'.repeat(100) };

    const flashSmallStats = await measureLatency(
      'flashQ Small',
      async () => { await flashQ.add('latency', { ...smallPayload, i: counter++ }); },
      TEST_OPS
    );

    const bullSmallStats = await measureLatency(
      'BullMQ Small',
      async () => { await bullQueue.add('job', { ...smallPayload, i: counter++ }); },
      TEST_OPS
    );

    results.push({ test: '100B Payload', flashQ: flashSmallStats, bullMQ: bullSmallStats });

    printStats('flashQ 100B Payload', flashSmallStats);
    printStats('BullMQ 100B Payload', bullSmallStats);

    // ═══════════════════════════════════════════════════════════════
    // Test 4: Medium Payload (1KB)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 4: Medium Payload (1KB)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const mediumPayload = { data: 'x'.repeat(1000) };

    const flashMediumStats = await measureLatency(
      'flashQ Medium',
      async () => { await flashQ.add('latency', { ...mediumPayload, i: counter++ }); },
      TEST_OPS
    );

    const bullMediumStats = await measureLatency(
      'BullMQ Medium',
      async () => { await bullQueue.add('job', { ...mediumPayload, i: counter++ }); },
      TEST_OPS
    );

    results.push({ test: '1KB Payload', flashQ: flashMediumStats, bullMQ: bullMediumStats });

    printStats('flashQ 1KB Payload', flashMediumStats);
    printStats('BullMQ 1KB Payload', bullMediumStats);

    // ═══════════════════════════════════════════════════════════════
    // Test 5: Large Payload (10KB)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST 5: Large Payload (10KB)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const largePayload = { data: 'x'.repeat(10000) };
    const LARGE_OPS = 500;

    const flashLargeStats = await measureLatency(
      'flashQ Large',
      async () => { await flashQ.add('latency', { ...largePayload, i: counter++ }); },
      LARGE_OPS
    );

    const bullLargeStats = await measureLatency(
      'BullMQ Large',
      async () => { await bullQueue.add('job', { ...largePayload, i: counter++ }); },
      LARGE_OPS
    );

    results.push({ test: '10KB Payload', flashQ: flashLargeStats, bullMQ: bullLargeStats });

    printStats('flashQ 10KB Payload', flashLargeStats);
    printStats('BullMQ 10KB Payload', bullLargeStats);

    // ═══════════════════════════════════════════════════════════════
    // Summary Table
    // ═══════════════════════════════════════════════════════════════
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                           LATENCY COMPARISON SUMMARY                           ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('P99 Latency (lower is better):');
    console.log('┌─────────────────┬─────────────────┬─────────────────┬─────────────────────────┐');
    console.log('│ Test            │ flashQ P99      │ BullMQ P99      │ Difference              │');
    console.log('├─────────────────┼─────────────────┼─────────────────┼─────────────────────────┤');

    for (const r of results) {
      const test = r.test.padEnd(15);
      const flashP99 = formatMs(r.flashQ.p99).padStart(13);
      const bullP99 = formatMs(r.bullMQ.p99).padStart(13);
      const ratio = r.bullMQ.p99 / r.flashQ.p99;
      const diff = ratio >= 1
        ? `flashQ ${ratio.toFixed(1)}x faster`.padEnd(23)
        : `BullMQ ${(1/ratio).toFixed(1)}x faster`.padEnd(23);
      console.log(`│ ${test} │ ${flashP99} │ ${bullP99} │ ${diff} │`);
    }

    console.log('└─────────────────┴─────────────────┴─────────────────┴─────────────────────────┘');

    // Mean Latency
    console.log('');
    console.log('Mean Latency:');
    console.log('┌─────────────────┬─────────────────┬─────────────────┬─────────────────────────┐');
    console.log('│ Test            │ flashQ Mean     │ BullMQ Mean     │ Difference              │');
    console.log('├─────────────────┼─────────────────┼─────────────────┼─────────────────────────┤');

    for (const r of results) {
      const test = r.test.padEnd(15);
      const flashMean = formatMs(r.flashQ.mean).padStart(13);
      const bullMean = formatMs(r.bullMQ.mean).padStart(13);
      const ratio = r.bullMQ.mean / r.flashQ.mean;
      const diff = ratio >= 1
        ? `flashQ ${ratio.toFixed(1)}x faster`.padEnd(23)
        : `BullMQ ${(1/ratio).toFixed(1)}x faster`.padEnd(23);
      console.log(`│ ${test} │ ${flashMean} │ ${bullMean} │ ${diff} │`);
    }

    console.log('└─────────────────┴─────────────────┴─────────────────┴─────────────────────────┘');

    // Export raw data
    console.log('\n📁 Raw Data (JSON):');
    console.log(JSON.stringify(results, null, 2));

  } finally {
    await flashQ.close();
    await bullQueue.close();
  }
}

main().catch(console.error);
