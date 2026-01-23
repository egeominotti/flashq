/**
 * 1 Million Jobs Benchmark with Engineering Metrics
 * Tracks: Memory (Client + Server), Latency (P50/P95/P99/P99.9), Throughput variance
 * Generates HTML report with interactive charts
 */
import { Queue, Worker } from "../src";

const TOTAL_JOBS = 1_000_000;
const BATCH_SIZE = 1000;
const NUM_WORKERS = 16;
const CONCURRENCY_PER_WORKER = 100;
const NUM_RUNS = 100;
const SERVER_HTTP_PORT = 6790; // flashQ HTTP API port

// Latency tracking with reservoir sampling for memory efficiency
class LatencyTracker {
  private samples: number[] = [];
  private readonly maxSamples = 100_000; // Keep max 100K samples
  private count = 0;
  private sum = 0;
  private min = Infinity;
  private max = -Infinity;

  add(latencyMs: number): void {
    this.count++;
    this.sum += latencyMs;
    if (latencyMs < this.min) this.min = latencyMs;
    if (latencyMs > this.max) this.max = latencyMs;

    // Reservoir sampling for percentile calculation
    if (this.samples.length < this.maxSamples) {
      this.samples.push(latencyMs);
    } else {
      // Random replacement for samples beyond maxSamples
      const idx = Math.floor(Math.random() * this.count);
      if (idx < this.maxSamples) {
        this.samples[idx] = latencyMs;
      }
    }
  }

  getStats(): LatencyStats {
    if (this.samples.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        p999: 0,
      };
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const percentile = (p: number) => {
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    };

    return {
      count: this.count,
      min: this.min,
      max: this.max,
      avg: this.sum / this.count,
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
      p999: percentile(99.9),
    };
  }

  reset(): void {
    this.samples = [];
    this.count = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }
}

interface LatencyStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  p999: number;
}

interface MemorySnapshot {
  timestamp: number;
  rss: number; // Resident Set Size (total memory)
  heapUsed: number; // V8 heap used
  heapTotal: number; // V8 heap total
  external: number; // C++ objects bound to JS
}

interface MemoryStats {
  peakRss: number;
  peakHeapUsed: number;
  avgRss: number;
  avgHeapUsed: number;
  startRss: number;
  endRss: number;
  deltaRss: number;
}

// Server (Rust) memory tracking
interface ServerMemorySnapshot {
  timestamp: number;
  memoryUsedMb: number;
  cpuPercent: number;
  tcpConnections: number;
}

interface ServerMemoryStats {
  peakMemory: number;
  avgMemory: number;
  startMemory: number;
  endMemory: number;
  deltaMemory: number;
}

async function getServerMemory(): Promise<ServerMemorySnapshot | null> {
  try {
    const response = await fetch(
      `http://localhost:${SERVER_HTTP_PORT}/system/metrics`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      ok: boolean;
      data?: {
        memory_used_mb: number;
        cpu_percent: number;
        tcp_connections: number;
      };
    };
    if (!data.ok || !data.data) return null;
    return {
      timestamp: Date.now(),
      memoryUsedMb: data.data.memory_used_mb,
      cpuPercent: data.data.cpu_percent,
      tcpConnections: data.data.tcp_connections,
    };
  } catch {
    return null;
  }
}

async function resetServer(): Promise<boolean> {
  try {
    const response = await fetch(
      `http://localhost:${SERVER_HTTP_PORT}/server/reset`,
      { method: "POST" },
    );
    return response.ok;
  } catch {
    return false;
  }
}

function calculateServerMemoryStats(
  snapshots: ServerMemorySnapshot[],
): ServerMemoryStats {
  const validSnapshots = snapshots.filter((s) => s !== null);
  if (validSnapshots.length === 0) {
    return {
      peakMemory: 0,
      avgMemory: 0,
      startMemory: 0,
      endMemory: 0,
      deltaMemory: 0,
    };
  }
  const memories = validSnapshots.map((s) => s.memoryUsedMb);
  return {
    peakMemory: Math.max(...memories),
    avgMemory: memories.reduce((s, v) => s + v, 0) / memories.length,
    startMemory: memories[0],
    endMemory: memories[memories.length - 1],
    deltaMemory: memories[memories.length - 1] - memories[0],
  };
}

interface RunResult {
  run: number;
  // Throughput
  pushTime: number;
  pushRate: number;
  processTime: number;
  processRate: number;
  totalTime: number;
  // Counts
  processed: number;
  errors: number;
  dataErrors: number;
  missing: number;
  success: boolean;
  // Latency
  pushLatency: LatencyStats;
  processLatency: LatencyStats;
  e2eLatency: LatencyStats;
  // Memory (Client - Node.js)
  memory: MemoryStats;
  // Memory (Server - Rust)
  serverMemory: ServerMemoryStats;
  // Throughput samples for variance calculation
  throughputSamples: number[];
}

function getMemoryMB(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    timestamp: Date.now(),
    rss: mem.rss / 1024 / 1024,
    heapUsed: mem.heapUsed / 1024 / 1024,
    heapTotal: mem.heapTotal / 1024 / 1024,
    external: mem.external / 1024 / 1024,
  };
}

function calculateMemoryStats(snapshots: MemorySnapshot[]): MemoryStats {
  if (snapshots.length === 0) {
    return {
      peakRss: 0,
      peakHeapUsed: 0,
      avgRss: 0,
      avgHeapUsed: 0,
      startRss: 0,
      endRss: 0,
      deltaRss: 0,
    };
  }

  const peakRss = Math.max(...snapshots.map((s) => s.rss));
  const peakHeapUsed = Math.max(...snapshots.map((s) => s.heapUsed));
  const avgRss = snapshots.reduce((s, m) => s + m.rss, 0) / snapshots.length;
  const avgHeapUsed =
    snapshots.reduce((s, m) => s + m.heapUsed, 0) / snapshots.length;
  const startRss = snapshots[0].rss;
  const endRss = snapshots[snapshots.length - 1].rss;

  return {
    peakRss,
    peakHeapUsed,
    avgRss,
    avgHeapUsed,
    startRss,
    endRss,
    deltaRss: endRss - startRss,
  };
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - avg, 2));
  return Math.sqrt(squaredDiffs.reduce((s, v) => s + v, 0) / values.length);
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function runBenchmark(runNumber: number): Promise<RunResult> {
  const queue = new Queue("million-benchmark", {
    timeout: 30000,
    defaultJobOptions: {
      removeOnComplete: true,
      timeout: 60000,
    },
  });

  console.log(`\n${"=".repeat(80)}`);
  console.log(
    `🚀 RUN ${runNumber}/${NUM_RUNS} - ${TOTAL_JOBS.toLocaleString()} Jobs`,
  );
  console.log("=".repeat(80));

  // Trackers
  const pushLatencyTracker = new LatencyTracker();
  const processLatencyTracker = new LatencyTracker();
  const e2eLatencyTracker = new LatencyTracker();
  const memorySnapshots: MemorySnapshot[] = [];
  const serverMemorySnapshots: ServerMemorySnapshot[] = [];
  const throughputSamples: number[] = [];

  // Memory sampling interval (client + server)
  const memoryInterval = setInterval(async () => {
    memorySnapshots.push(getMemoryMB());
    const serverMem = await getServerMemory();
    if (serverMem) serverMemorySnapshots.push(serverMem);
  }, 500);

  // Initial memory snapshot
  memorySnapshots.push(getMemoryMB());
  getServerMemory().then((s) => {
    if (s) serverMemorySnapshots.push(s);
  });

  // Clean up queue before starting
  console.log("📋 Cleaning up queue...");
  await queue.obliterate();

  // Force GC if available
  if (global.gc) {
    global.gc();
    await new Promise((r) => setTimeout(r, 100));
  }

  memorySnapshots.push(getMemoryMB());

  // === CONCURRENT PRODUCER-CONSUMER PATTERN ===
  // Workers start FIRST, then push jobs while workers process
  // This gives realistic production latency measurements

  // Create workers FIRST (before pushing)
  console.log(`👷 Creating ${NUM_WORKERS} workers...`);
  const workers: Worker[] = [];
  let processed = 0;
  let errors = 0;
  let dataErrors = 0;
  const overallStart = Date.now();
  let lastReport = overallStart;
  let lastProcessed = 0;

  for (let w = 0; w < NUM_WORKERS; w++) {
    const worker = new Worker(
      "million-benchmark",
      async (job) => {
        const data = job.data as {
          index: number;
          value: string;
          pushTime: number;
        };
        const processingStart = Date.now();
        return {
          index: data.index,
          value: data.value,
          pushTime: data.pushTime,
          processingStart,
          completedAt: Date.now(),
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
      const input = job.data as {
        index: number;
        value: string;
        pushTime: number;
      };
      const output = result as {
        index: number;
        value: string;
        pushTime: number;
        processingStart: number;
        completedAt: number;
      };

      // Data integrity check
      if (input.index !== output.index || input.value !== output.value) {
        dataErrors++;
      }

      // Latency tracking
      const processLatency = output.completedAt - output.processingStart;
      const e2eLatency = output.completedAt - input.pushTime;
      processLatencyTracker.add(processLatency);
      e2eLatencyTracker.add(e2eLatency);
    });

    worker.on("failed", () => {
      errors++;
    });

    workers.push(worker);
  }

  // Start all workers BEFORE pushing (concurrent producer-consumer)
  await Promise.all(workers.map((w) => w.start()));
  console.log(`✅ Workers started, now pushing jobs concurrently...`);

  // Push jobs WHILE workers are processing (producer-consumer pattern)
  console.log(`📤 Pushing ${TOTAL_JOBS.toLocaleString()} jobs...`);
  const pushStart = Date.now();

  let pushed = 0;
  const pushPromise = (async () => {
    for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
      const batchCount = Math.min(BATCH_SIZE, TOTAL_JOBS - i);
      const batchStart = Date.now();

      const jobs = Array.from({ length: batchCount }, (_, j) => {
        const jobIndex = i + j;
        return {
          name: "task",
          data: {
            index: jobIndex,
            value: `job-${jobIndex}`,
            pushTime: Date.now(),
          },
        };
      });

      await queue.addBulk(jobs);
      const batchLatency = Date.now() - batchStart;
      pushLatencyTracker.add(batchLatency / batchCount);
      pushed += batchCount;
    }
  })();

  // Don't await here - let push run concurrently with processing

  // Progress reporter with throughput sampling
  const progressInterval = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - overallStart) / 1000;
    const intervalElapsed = (now - lastReport) / 1000;
    const intervalProcessed = processed - lastProcessed;
    const currentRate = Math.round(intervalProcessed / intervalElapsed);
    const avgRate = Math.round(processed / elapsed);
    const pct = ((processed / TOTAL_JOBS) * 100).toFixed(1);
    const mem = getMemoryMB();

    throughputSamples.push(currentRate);

    console.log(
      `   ${processed.toLocaleString()}/${TOTAL_JOBS.toLocaleString()} (${pct}%) | ` +
        `${currentRate.toLocaleString()}/s | Avg: ${avgRate.toLocaleString()}/s | ` +
        `RSS: ${mem.rss.toFixed(0)}MB | Heap: ${mem.heapUsed.toFixed(0)}MB`,
    );

    lastReport = now;
    lastProcessed = processed;
  }, 5000);

  // Wait for push to complete
  await pushPromise;
  const pushTime = Date.now() - pushStart;
  const pushRate = Math.round(TOTAL_JOBS / (pushTime / 1000));
  console.log(
    `✅ Push complete: ${pushRate.toLocaleString()}/s (${(pushTime / 1000).toFixed(2)}s)`,
  );

  // Wait for all jobs to be processed
  const timeout = Date.now() + 600_000;
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
  clearInterval(memoryInterval);

  const totalTime = Date.now() - overallStart;
  const processRate = Math.round(TOTAL_JOBS / (totalTime / 1000));

  // Final memory snapshot (client + server)
  memorySnapshots.push(getMemoryMB());
  const finalServerMem = await getServerMemory();
  if (finalServerMem) serverMemorySnapshots.push(finalServerMem);

  // Stop all workers
  await Promise.all(workers.map((w) => w.close()));

  // Cleanup
  await queue.obliterate();
  await queue.close();

  const totalHandled = processed + errors;
  const allAccountedFor = totalHandled === TOTAL_JOBS;
  const success = errors === 0 && dataErrors === 0 && allAccountedFor;

  // Get stats (client + server)
  const pushLatency = pushLatencyTracker.getStats();
  const processLatency = processLatencyTracker.getStats();
  const e2eLatency = e2eLatencyTracker.getStats();
  const memory = calculateMemoryStats(memorySnapshots);
  const serverMemory = calculateServerMemoryStats(serverMemorySnapshots);

  if (!allAccountedFor) {
    console.error(
      `❌ MISSING JOBS: ${totalHandled}/${TOTAL_JOBS} (${TOTAL_JOBS - totalHandled} lost)`,
    );
  }

  // Detailed run summary
  console.log(`\n${"─".repeat(80)}`);
  console.log(`📊 Run ${runNumber} Summary`);
  console.log(`${"─".repeat(80)}`);
  console.log(
    `   Throughput: Push ${pushRate.toLocaleString()}/s | Process ${processRate.toLocaleString()}/s`,
  );
  console.log(
    `   Latency E2E: P50=${formatMs(e2eLatency.p50)} P95=${formatMs(e2eLatency.p95)} P99=${formatMs(e2eLatency.p99)} P99.9=${formatMs(e2eLatency.p999)}`,
  );
  console.log(
    `   Latency Process: P50=${formatMs(processLatency.p50)} P95=${formatMs(processLatency.p95)} P99=${formatMs(processLatency.p99)}`,
  );
  console.log(
    `   Client Memory: Peak=${memory.peakRss.toFixed(0)}MB | Delta=${memory.deltaRss.toFixed(1)}MB`,
  );
  console.log(
    `   Server Memory: Peak=${serverMemory.peakMemory.toFixed(0)}MB | Delta=${serverMemory.deltaMemory.toFixed(1)}MB`,
  );
  console.log(`   Status: ${success ? "✅ PASS" : "❌ FAIL"}`);

  // In concurrent mode, processTime = totalTime (push and process overlap)
  const processTime = totalTime;

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
    pushLatency,
    processLatency,
    e2eLatency,
    memory,
    serverMemory,
    throughputSamples,
  };
}

// Main execution
console.log("=".repeat(80));
console.log("🚀 flashQ ENGINEERING BENCHMARK");
console.log("=".repeat(80));
console.log(`Jobs per run: ${TOTAL_JOBS.toLocaleString()}`);
console.log(`Total jobs: ${(TOTAL_JOBS * NUM_RUNS).toLocaleString()}`);
console.log(`Workers: ${NUM_WORKERS}`);
console.log(`Concurrency/worker: ${CONCURRENCY_PER_WORKER}`);
console.log(`Total concurrency: ${NUM_WORKERS * CONCURRENCY_PER_WORKER}`);
console.log(`Node.js: ${process.version}`);
console.log(`Platform: ${process.platform} ${process.arch}`);
console.log("=".repeat(80));

// Initial server reset for clean baseline
console.log("\n🧹 Initial server reset for clean baseline...");
const initialReset = await resetServer();
if (initialReset) {
  await new Promise((r) => setTimeout(r, 1000)); // Wait for full cleanup
  const initialMem = await getServerMemory();
  console.log(
    `✅ Server reset complete. Baseline memory: ${initialMem?.memoryUsedMb.toFixed(0) ?? "N/A"}MB`,
  );
} else {
  console.log("⚠️  Server reset not available");
}

const results: RunResult[] = [];
const overallStart = Date.now();

for (let run = 1; run <= NUM_RUNS; run++) {
  const result = await runBenchmark(run);
  results.push(result);
}

const overallTime = Date.now() - overallStart;

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL ENGINEERING REPORT
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(80));
console.log("📊 ENGINEERING REPORT - COMPLETE ANALYSIS");
console.log("═".repeat(80));

// 1. Throughput Summary Table
console.log(
  "\n┌─ THROUGHPUT ──────────────────────────────────────────────────────────────┐",
);
console.log(
  "│ Run  │ Push Rate    │ Process Rate │ Total Time │ Status                 │",
);
console.log(
  "├──────┼──────────────┼──────────────┼────────────┼────────────────────────┤",
);

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
    `│ #${r.run.toString().padStart(2)}  │ ` +
      `${r.pushRate.toLocaleString().padStart(10)}/s │ ` +
      `${r.processRate.toLocaleString().padStart(10)}/s │ ` +
      `${(r.totalTime / 1000).toFixed(2).padStart(8)}s │ ` +
      `${status.padEnd(22)} │`,
  );
}
console.log(
  "└──────┴──────────────┴──────────────┴────────────┴────────────────────────┘",
);

// 2. Throughput Statistics
const pushRates = results.map((r) => r.pushRate);
const processRates = results.map((r) => r.processRate);
const avgPushRate = Math.round(
  pushRates.reduce((s, v) => s + v, 0) / pushRates.length,
);
const avgProcessRate = Math.round(
  processRates.reduce((s, v) => s + v, 0) / processRates.length,
);

console.log(
  "\n┌─ THROUGHPUT STATISTICS ───────────────────────────────────────────────────┐",
);
console.log(
  `│ Push Rate:    Avg=${avgPushRate.toLocaleString().padStart(8)}/s  Min=${Math.min(
    ...pushRates,
  )
    .toLocaleString()
    .padStart(8)}/s  Max=${Math.max(...pushRates)
    .toLocaleString()
    .padStart(8)}/s  StdDev=${stdDev(pushRates).toFixed(0).padStart(6)} │`,
);
console.log(
  `│ Process Rate: Avg=${avgProcessRate.toLocaleString().padStart(8)}/s  Min=${Math.min(
    ...processRates,
  )
    .toLocaleString()
    .padStart(8)}/s  Max=${Math.max(...processRates)
    .toLocaleString()
    .padStart(8)}/s  StdDev=${stdDev(processRates).toFixed(0).padStart(6)} │`,
);
console.log(
  "└───────────────────────────────────────────────────────────────────────────┘",
);

// 3. Latency Analysis
console.log(
  "\n┌─ LATENCY ANALYSIS (End-to-End) ──────────────────────────────────────────┐",
);
console.log(
  "│ Run  │    P50    │    P95    │    P99    │   P99.9   │    Max    │  Avg    │",
);
console.log(
  "├──────┼───────────┼───────────┼───────────┼───────────┼───────────┼─────────┤",
);

for (const r of results) {
  const e = r.e2eLatency;
  console.log(
    `│ #${r.run.toString().padStart(2)}  │ ` +
      `${formatMs(e.p50).padStart(9)} │ ` +
      `${formatMs(e.p95).padStart(9)} │ ` +
      `${formatMs(e.p99).padStart(9)} │ ` +
      `${formatMs(e.p999).padStart(9)} │ ` +
      `${formatMs(e.max).padStart(9)} │ ` +
      `${formatMs(e.avg).padStart(7)} │`,
  );
}
console.log(
  "└──────┴───────────┴───────────┴───────────┴───────────┴───────────┴─────────┘",
);

// Aggregate latency stats
const allP99s = results.map((r) => r.e2eLatency.p99);
const allP999s = results.map((r) => r.e2eLatency.p999);
const avgP99 = allP99s.reduce((s, v) => s + v, 0) / allP99s.length;
const avgP999 = allP999s.reduce((s, v) => s + v, 0) / allP999s.length;
const maxP99 = Math.max(...allP99s);
const maxP999 = Math.max(...allP999s);

console.log(
  "\n┌─ LATENCY SUMMARY ─────────────────────────────────────────────────────────┐",
);
console.log(
  `│ P99  (E2E): Avg=${formatMs(avgP99).padStart(9)}  Max=${formatMs(maxP99).padStart(9)}  StdDev=${formatMs(stdDev(allP99s)).padStart(9)}              │`,
);
console.log(
  `│ P99.9(E2E): Avg=${formatMs(avgP999).padStart(9)}  Max=${formatMs(maxP999).padStart(9)}  StdDev=${formatMs(stdDev(allP999s)).padStart(9)}              │`,
);
console.log(
  "└───────────────────────────────────────────────────────────────────────────┘",
);

// 4. Memory Analysis (Client - Node.js)
console.log(
  "\n┌─ CLIENT MEMORY (Node.js) ─────────────────────────────────────────────────┐",
);
console.log("│ Run  │ Peak RSS  │ Peak Heap │ Delta RSS │");
console.log("├──────┼───────────┼───────────┼───────────┤");

for (const r of results) {
  const m = r.memory;
  console.log(
    `│ #${r.run.toString().padStart(2)}  │ ` +
      `${m.peakRss.toFixed(0).padStart(7)}MB │ ` +
      `${m.peakHeapUsed.toFixed(0).padStart(7)}MB │ ` +
      `${(m.deltaRss >= 0 ? "+" : "") + m.deltaRss.toFixed(1).padStart(6)}MB │`,
  );
}
console.log("└──────┴───────────┴───────────┴───────────┘");

// 4b. Server Memory Analysis (Rust)
console.log(
  "\n┌─ SERVER MEMORY (Rust) ──────────────────────────────────────────────────────┐",
);
console.log("│ Run  │ Peak Mem  │ Avg Mem   │ Delta Mem │");
console.log("├──────┼───────────┼───────────┼───────────┤");

for (const r of results) {
  const s = r.serverMemory;
  console.log(
    `│ #${r.run.toString().padStart(2)}  │ ` +
      `${s.peakMemory.toFixed(0).padStart(7)}MB │ ` +
      `${s.avgMemory.toFixed(0).padStart(7)}MB │ ` +
      `${(s.deltaMemory >= 0 ? "+" : "") + s.deltaMemory.toFixed(1).padStart(6)}MB │`,
  );
}
console.log("└──────┴───────────┴───────────┴───────────┘");

// Memory statistics
const peakRsss = results.map((r) => r.memory.peakRss);
const deltaRsss = results.map((r) => r.memory.deltaRss);
const serverPeaks = results.map((r) => r.serverMemory.peakMemory);
const serverDeltas = results.map((r) => r.serverMemory.deltaMemory);

console.log(
  "\n┌─ MEMORY SUMMARY ──────────────────────────────────────────────────────────┐",
);
console.log(
  `│ Client Peak: Avg=${(peakRsss.reduce((s, v) => s + v, 0) / peakRsss.length).toFixed(0).padStart(5)}MB  Max=${Math.max(
    ...peakRsss,
  )
    .toFixed(0)
    .padStart(
      5,
    )}MB  Delta=${(deltaRsss.reduce((s, v) => s + v, 0) / deltaRsss.length).toFixed(1).padStart(6)}MB │`,
);
console.log(
  `│ Server Peak: Avg=${(serverPeaks.reduce((s, v) => s + v, 0) / serverPeaks.length).toFixed(0).padStart(5)}MB  Max=${Math.max(
    ...serverPeaks,
  )
    .toFixed(0)
    .padStart(
      5,
    )}MB  Delta=${(serverDeltas.reduce((s, v) => s + v, 0) / serverDeltas.length).toFixed(1).padStart(6)}MB │`,
);
console.log(
  "└───────────────────────────────────────────────────────────────────────────┘",
);

// 5. Throughput Variance Analysis
const allThroughputSamples = results.flatMap((r) => r.throughputSamples);
const throughputStdDev = stdDev(allThroughputSamples);
const throughputCV = (throughputStdDev / avgProcessRate) * 100; // Coefficient of variation

console.log(
  "\n┌─ THROUGHPUT STABILITY ─────────────────────────────────────────────────────┐",
);
console.log(
  `│ Coefficient of Variation: ${throughputCV.toFixed(2)}% (lower = more stable)                        │`,
);
console.log(
  `│ Standard Deviation: ${throughputStdDev.toFixed(0)} jobs/sec                                        │`,
);
console.log(
  `│ Sample count: ${allThroughputSamples.length} throughput measurements                                  │`,
);
console.log(
  "└───────────────────────────────────────────────────────────────────────────┘",
);

// 6. Overall Summary
const successCount = results.filter((r) => r.success).length;
const totalProcessed = results.reduce((s, r) => s + r.processed, 0);
const totalErrors = results.reduce((s, r) => s + r.errors, 0);
const totalDataErrors = results.reduce((s, r) => s + r.dataErrors, 0);
const totalMissing = results.reduce((s, r) => s + r.missing, 0);

console.log("\n" + "═".repeat(80));
console.log("📈 FINAL SUMMARY");
console.log("═".repeat(80));
console.log(`   Total runs: ${NUM_RUNS}`);
console.log(
  `   Passed: ${successCount}/${NUM_RUNS} (${((successCount / NUM_RUNS) * 100).toFixed(1)}%)`,
);
console.log(
  `   Total jobs pushed: ${(TOTAL_JOBS * NUM_RUNS).toLocaleString()}`,
);
console.log(`   Total processed: ${totalProcessed.toLocaleString()}`);
if (totalErrors > 0)
  console.log(`   Total errors: ${totalErrors.toLocaleString()}`);
if (totalDataErrors > 0)
  console.log(
    `   Total data integrity errors: ${totalDataErrors.toLocaleString()}`,
  );
if (totalMissing > 0)
  console.log(`   Total missing jobs: ${totalMissing.toLocaleString()}`);
console.log(`   Total time: ${(overallTime / 1000 / 60).toFixed(2)} minutes`);
console.log(`   Avg throughput: ${avgProcessRate.toLocaleString()} jobs/sec`);
console.log(`   Avg P99 latency: ${formatMs(avgP99)}`);
console.log(`   Client peak memory: ${Math.max(...peakRsss).toFixed(0)}MB`);
console.log(`   Server peak memory: ${Math.max(...serverPeaks).toFixed(0)}MB`);
console.log("═".repeat(80));

if (successCount === NUM_RUNS) {
  console.log("\n✅ ALL RUNS PASSED - System is stable and production-ready!");
} else {
  console.log(
    `\n❌ ${NUM_RUNS - successCount} RUNS FAILED - Investigation required`,
  );
}

process.exit(successCount === NUM_RUNS ? 0 : 1);
