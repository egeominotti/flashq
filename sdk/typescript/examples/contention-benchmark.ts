/**
 * Lock Contention Benchmark
 *
 * Measures pull throughput with varying levels of contention:
 * - Single queue (all workers compete for same lock)
 * - Multiple queues (workers distributed, less contention)
 *
 * This helps determine if event-driven would improve performance.
 */
import { FlashQ } from "../src";

const TOTAL_JOBS = 100_000;
const BATCH_SIZE = 500;
const SERVER_HTTP_PORT = 6790;

interface TestResult {
  name: string;
  numQueues: number;
  numWorkers: number;
  pushTime: number;
  pullTime: number;
  pushRate: number;
  pullRate: number;
  avgPullLatencyUs: number;
  p99PullLatencyUs: number;
}

async function resetServer(): Promise<boolean> {
  try {
    const response = await fetch(
      `http://localhost:${SERVER_HTTP_PORT}/server/reset`,
      { method: "POST" }
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function runTest(
  numQueues: number,
  numWorkers: number
): Promise<TestResult> {
  const name = `${numQueues}Q x ${numWorkers}W`;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`🧪 Test: ${name} (${numQueues} queues, ${numWorkers} workers)`);
  console.log(`${"─".repeat(60)}`);

  // Reset server
  await resetServer();
  await new Promise((r) => setTimeout(r, 200));

  // Create clients for workers
  const clients: FlashQ[] = [];
  for (let i = 0; i < numWorkers; i++) {
    const client = new FlashQ({ port: 6789, timeout: 30000 });
    await client.connect();
    clients.push(client);
  }

  // Create producer client
  const producer = new FlashQ({ port: 6789, timeout: 30000 });
  await producer.connect();

  const queueNames = Array.from({ length: numQueues }, (_, i) => `bench-q-${i}`);

  // Clean queues
  for (const q of queueNames) {
    await producer.obliterate(q);
  }

  // === PHASE 1: Push jobs ===
  console.log(`📤 Pushing ${TOTAL_JOBS.toLocaleString()} jobs...`);
  const pushStart = Date.now();

  const jobsPerQueue = Math.ceil(TOTAL_JOBS / numQueues);
  let pushed = 0;

  for (let q = 0; q < numQueues; q++) {
    const queueName = queueNames[q];
    const jobsForThisQueue = Math.min(jobsPerQueue, TOTAL_JOBS - pushed);

    for (let i = 0; i < jobsForThisQueue; i += BATCH_SIZE) {
      const batchCount = Math.min(BATCH_SIZE, jobsForThisQueue - i);
      const jobs = Array.from({ length: batchCount }, (_, j) => ({
        data: { idx: pushed + j },
        removeOnComplete: true,
      }));
      await producer.pushBatch(queueName, jobs);
      pushed += batchCount;
    }
  }

  const pushTime = Date.now() - pushStart;
  const pushRate = Math.round(TOTAL_JOBS / (pushTime / 1000));
  console.log(`✅ Push: ${pushRate.toLocaleString()}/s (${pushTime}ms)`);

  // === PHASE 2: Pull jobs with workers (contention test) ===
  console.log(`📥 Pulling with ${numWorkers} workers on ${numQueues} queues...`);

  let pulled = 0;
  const pullLatencies: number[] = [];
  const pullStart = Date.now();

  // Assign workers to queues (round-robin)
  const workerQueues = clients.map((_, i) => queueNames[i % numQueues]);

  // Pull loop - each worker pulls from its assigned queue
  const pullPromises = clients.map(async (client, workerIdx) => {
    const queueName = workerQueues[workerIdx];
    let localPulled = 0;
    const targetPerWorker = Math.ceil(TOTAL_JOBS / numWorkers);

    while (localPulled < targetPerWorker && pulled < TOTAL_JOBS) {
      const latencyStart = performance.now();

      try {
        // Pull batch
        const jobs = await client.pullBatch(queueName, 10);
        const latencyUs = (performance.now() - latencyStart) * 1000;

        if (jobs.length > 0) {
          pullLatencies.push(latencyUs / jobs.length); // Per-job latency

          // Ack all
          const ids = jobs.map((j) => j.id);
          await client.ackBatch(ids);

          localPulled += jobs.length;
          pulled += jobs.length;
        } else {
          // Queue empty for this worker
          break;
        }
      } catch {
        break;
      }
    }
  });

  await Promise.all(pullPromises);

  const pullTime = Date.now() - pullStart;
  const pullRate = Math.round(pulled / (pullTime / 1000));

  // Calculate latency stats
  pullLatencies.sort((a, b) => a - b);
  const avgLatency = pullLatencies.reduce((s, v) => s + v, 0) / pullLatencies.length;
  const p99Idx = Math.floor(pullLatencies.length * 0.99);
  const p99Latency = pullLatencies[p99Idx] || 0;

  console.log(`✅ Pull: ${pullRate.toLocaleString()}/s (${pullTime}ms)`);
  console.log(`   Latency: avg=${avgLatency.toFixed(0)}µs p99=${p99Latency.toFixed(0)}µs`);

  // Cleanup
  for (const client of clients) {
    await client.close();
  }
  for (const q of queueNames) {
    await producer.obliterate(q);
  }
  await producer.close();

  return {
    name,
    numQueues,
    numWorkers,
    pushTime,
    pullTime,
    pushRate,
    pullRate,
    avgPullLatencyUs: avgLatency,
    p99PullLatencyUs: p99Latency,
  };
}

// Main
console.log("═".repeat(60));
console.log("🔬 LOCK CONTENTION BENCHMARK");
console.log("═".repeat(60));
console.log(`Jobs: ${TOTAL_JOBS.toLocaleString()}`);
console.log(`Batch size: ${BATCH_SIZE}`);
console.log("═".repeat(60));

const results: TestResult[] = [];

// Test matrix: varying queues and workers
const tests = [
  // High contention: 1 queue, many workers
  { queues: 1, workers: 1 },    // Baseline (no contention)
  { queues: 1, workers: 4 },    // Some contention
  { queues: 1, workers: 8 },    // More contention
  { queues: 1, workers: 16 },   // High contention
  { queues: 1, workers: 32 },   // Very high contention

  // Sharded: multiple queues
  { queues: 4, workers: 16 },   // 4 workers per queue
  { queues: 8, workers: 16 },   // 2 workers per queue
  { queues: 16, workers: 16 },  // 1 worker per queue (no contention)
  { queues: 32, workers: 32 },  // 1 worker per queue, more parallelism
];

for (const test of tests) {
  const result = await runTest(test.queues, test.workers);
  results.push(result);
}

// === FINAL REPORT ===
console.log("\n" + "═".repeat(80));
console.log("📊 CONTENTION ANALYSIS REPORT");
console.log("═".repeat(80));

console.log("\n┌─ RESULTS ─────────────────────────────────────────────────────────────────┐");
console.log("│ Config          │ Pull Rate    │ Avg Latency │ P99 Latency │ Contention  │");
console.log("├─────────────────┼──────────────┼─────────────┼─────────────┼─────────────┤");

const baseline = results.find(r => r.numQueues === 1 && r.numWorkers === 1);
const baselineRate = baseline?.pullRate || 1;

for (const r of results) {
  const contention = r.numWorkers / r.numQueues;
  const efficiency = ((r.pullRate / baselineRate) * 100).toFixed(0);
  const contentionLevel = contention > 8 ? "🔴 HIGH" : contention > 2 ? "🟡 MED" : "🟢 LOW";

  console.log(
    `│ ${r.name.padEnd(15)} │ ` +
    `${r.pullRate.toLocaleString().padStart(10)}/s │ ` +
    `${r.avgPullLatencyUs.toFixed(0).padStart(9)}µs │ ` +
    `${r.p99PullLatencyUs.toFixed(0).padStart(9)}µs │ ` +
    `${contentionLevel.padStart(11)} │`
  );
}
console.log("└─────────────────┴──────────────┴─────────────┴─────────────┴─────────────┘");

// Analysis
const singleQueue16W = results.find(r => r.numQueues === 1 && r.numWorkers === 16);
const sharded16Q16W = results.find(r => r.numQueues === 16 && r.numWorkers === 16);

if (singleQueue16W && sharded16Q16W) {
  const improvement = ((sharded16Q16W.pullRate / singleQueue16W.pullRate - 1) * 100).toFixed(1);
  const latencyReduction = ((1 - sharded16Q16W.avgPullLatencyUs / singleQueue16W.avgPullLatencyUs) * 100).toFixed(1);

  console.log("\n┌─ CONTENTION IMPACT ───────────────────────────────────────────────────────┐");
  console.log(`│ 1 queue vs 16 queues (16 workers each):                                   │`);
  console.log(`│   Throughput: ${singleQueue16W.pullRate.toLocaleString()}/s → ${sharded16Q16W.pullRate.toLocaleString()}/s (${improvement}% ${Number(improvement) > 0 ? "better" : "worse"})       │`);
  console.log(`│   Latency: ${singleQueue16W.avgPullLatencyUs.toFixed(0)}µs → ${sharded16Q16W.avgPullLatencyUs.toFixed(0)}µs (${latencyReduction}% reduction)                  │`);
  console.log("└───────────────────────────────────────────────────────────────────────────┘");

  console.log("\n📋 CONCLUSION:");
  if (Number(improvement) > 20) {
    console.log("   🔴 HIGH CONTENTION DETECTED - Event-driven could help significantly");
    console.log(`   Potential improvement: ~${improvement}% throughput gain`);
  } else if (Number(improvement) > 5) {
    console.log("   🟡 MODERATE CONTENTION - Event-driven might help");
    console.log(`   Potential improvement: ~${improvement}% throughput gain`);
  } else {
    console.log("   🟢 LOW CONTENTION - Current polling is efficient");
    console.log("   Event-driven would NOT provide significant benefit");
  }
}

console.log("\n" + "═".repeat(80));
process.exit(0);
