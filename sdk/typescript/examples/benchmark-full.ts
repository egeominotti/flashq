/**
 * Full Benchmark - Memory, Latency, Throughput
 * Compares flashQ performance with detailed metrics
 */
import { Queue, Worker } from '../src';

const TOTAL_JOBS = 100_000;
const BATCH_SIZE = 1000;
const NUM_WORKERS = 8;
const CONCURRENCY_PER_WORKER = 50;

// Latency tracking
const pushLatencies: number[] = [];
const processLatencies: number[] = [];

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] || 0;
}

async function getDockerStats(containerName: string): Promise<{ memoryMB: number; cpuPercent: number } | null> {
  try {
    const proc = Bun.spawn(['docker', 'stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', containerName]);
    const output = await new Response(proc.stdout).text();
    const [mem, cpu] = output.trim().split('|');

    // Parse memory (e.g., "125.4MiB / 7.763GiB" or "1.2GiB / 7.763GiB")
    const memMatch = mem.match(/([\d.]+)([GMK]i?B)/i);
    let memoryMB = 0;
    if (memMatch) {
      const value = parseFloat(memMatch[1]);
      const unit = memMatch[2].toUpperCase();
      if (unit.startsWith('G')) memoryMB = value * 1024;
      else if (unit.startsWith('M')) memoryMB = value;
      else if (unit.startsWith('K')) memoryMB = value / 1024;
    }

    // Parse CPU (e.g., "15.25%")
    const cpuPercent = parseFloat(cpu?.replace('%', '') || '0');

    return { memoryMB, cpuPercent };
  } catch {
    return null;
  }
}

const queue = new Queue('benchmark-full', { defaultJobOptions: { removeOnComplete: true } });

console.log('='.repeat(70));
console.log('🚀 flashQ Full Benchmark (Memory + Latency + Throughput)');
console.log('='.repeat(70));
console.log(`Jobs: ${TOTAL_JOBS.toLocaleString()}`);
console.log(`Workers: ${NUM_WORKERS}`);
console.log(`Concurrency/worker: ${CONCURRENCY_PER_WORKER}`);
console.log(`Total concurrency: ${NUM_WORKERS * CONCURRENCY_PER_WORKER}`);
console.log('='.repeat(70));

// Get initial memory
const initialStats = await getDockerStats('flashq');
console.log(`\n📊 Initial flashQ memory: ${initialStats?.memoryMB.toFixed(1) || 'N/A'} MB`);

// Clean up
console.log('\n📋 Cleaning up queue...');
await queue.obliterate();

// Push jobs with latency tracking
console.log(`\n📤 Pushing ${TOTAL_JOBS.toLocaleString()} jobs...`);
const pushStart = Date.now();

let pushed = 0;
for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
  const batchCount = Math.min(BATCH_SIZE, TOTAL_JOBS - i);
  const jobs = Array.from({ length: batchCount }, (_, j) => ({
    name: 'task',
    data: {
      index: i + j,
      value: `job-${i + j}`,
      timestamp: Date.now(),
    },
  }));

  const batchStart = performance.now();
  await queue.addBulk(jobs);
  const batchLatency = performance.now() - batchStart;
  pushLatencies.push(batchLatency);

  pushed += batchCount;

  if (pushed % 20_000 === 0) {
    const elapsed = (Date.now() - pushStart) / 1000;
    const rate = Math.round(pushed / elapsed);
    console.log(`   Pushed: ${pushed.toLocaleString()} (${rate.toLocaleString()} jobs/sec)`);
  }
}

const pushTime = Date.now() - pushStart;
const pushRate = Math.round(TOTAL_JOBS / (pushTime / 1000));

// Memory after push
const afterPushStats = await getDockerStats('flashq');
console.log(`\n✅ Push complete: ${pushRate.toLocaleString()} jobs/sec (${(pushTime / 1000).toFixed(2)}s)`);
console.log(`📊 Memory after push: ${afterPushStats?.memoryMB.toFixed(1) || 'N/A'} MB`);

// Create workers with latency tracking
console.log(`\n👷 Starting ${NUM_WORKERS} workers...`);
const workers: Worker[] = [];
let processed = 0;
let errors = 0;
let dataErrors = 0;
const processStart = Date.now();
let lastReport = processStart;
let lastProcessed = 0;

// Track per-job latencies
const jobStartTimes = new Map<number, number>();

for (let w = 0; w < NUM_WORKERS; w++) {
  const worker = new Worker(
    'benchmark-full',
    async (job) => {
      jobStartTimes.set(job.id, performance.now());
      return { ok: true, index: (job.data as any).index, value: (job.data as any).value };
    },
    {
      concurrency: CONCURRENCY_PER_WORKER,
      batchSize: 100,
      autorun: false,
    }
  );

  worker.on('completed', (job, result) => {
    const startTime = jobStartTimes.get(job.id);
    if (startTime) {
      processLatencies.push(performance.now() - startTime);
      jobStartTimes.delete(job.id);
    }
    processed++;

    const input = job.data as { index: number; value: string };
    const output = result as { index: number; value: string };
    if (input.index !== output.index || input.value !== output.value) {
      dataErrors++;
    }
  });

  worker.on('failed', () => {
    errors++;
  });

  workers.push(worker);
}

// Start all workers
await Promise.all(workers.map((w) => w.start()));
console.log('   All workers started\n');

// Progress reporter with memory tracking
const progressInterval = setInterval(async () => {
  const now = Date.now();
  const elapsed = (now - processStart) / 1000;
  const intervalElapsed = (now - lastReport) / 1000;
  const intervalProcessed = processed - lastProcessed;
  const currentRate = Math.round(intervalProcessed / intervalElapsed);
  const avgRate = Math.round(processed / elapsed);
  const pct = ((processed / TOTAL_JOBS) * 100).toFixed(1);
  const eta = avgRate > 0 ? Math.round((TOTAL_JOBS - processed) / avgRate) : 0;

  const stats = await getDockerStats('flashq');
  const memStr = stats ? `${stats.memoryMB.toFixed(0)}MB` : 'N/A';

  console.log(
    `   ${processed.toLocaleString()}/${TOTAL_JOBS.toLocaleString()} (${pct}%) | Rate: ${currentRate.toLocaleString()}/s | Mem: ${memStr} | ETA: ${eta}s`
  );

  lastReport = now;
  lastProcessed = processed;
}, 2000);

// Wait for completion
while (processed < TOTAL_JOBS) {
  await new Promise((r) => setTimeout(r, 100));
}

clearInterval(progressInterval);

const processTime = Date.now() - processStart;
const processRate = Math.round(TOTAL_JOBS / (processTime / 1000));

// Final memory
const finalStats = await getDockerStats('flashq');

// Stop workers
console.log('\n🛑 Stopping workers...');
await Promise.all(workers.map((w) => w.close()));

// Calculate latency percentiles
const pushP50 = percentile(pushLatencies, 50);
const pushP95 = percentile(pushLatencies, 95);
const pushP99 = percentile(pushLatencies, 99);

const procP50 = percentile(processLatencies, 50);
const procP95 = percentile(processLatencies, 95);
const procP99 = percentile(processLatencies, 99);

// Results
console.log('\n' + '='.repeat(70));
console.log('📊 RESULTS');
console.log('='.repeat(70));
console.log(`Total jobs:       ${TOTAL_JOBS.toLocaleString()}`);
console.log(`Processed:        ${processed.toLocaleString()}`);
console.log(`Errors:           ${errors}`);
console.log(`Data integrity:   ${dataErrors === 0 ? '✅ 100% VERIFIED' : '❌ FAILED'}`);
console.log('-'.repeat(70));
console.log('THROUGHPUT');
console.log(`  Push rate:      ${pushRate.toLocaleString()} jobs/sec`);
console.log(`  Process rate:   ${processRate.toLocaleString()} jobs/sec`);
console.log(`  Push time:      ${(pushTime / 1000).toFixed(2)}s`);
console.log(`  Process time:   ${(processTime / 1000).toFixed(2)}s`);
console.log('-'.repeat(70));
console.log('LATENCY (batch push, per 1000 jobs)');
console.log(`  P50:            ${pushP50.toFixed(2)}ms`);
console.log(`  P95:            ${pushP95.toFixed(2)}ms`);
console.log(`  P99:            ${pushP99.toFixed(2)}ms`);
console.log('-'.repeat(70));
console.log('LATENCY (job processing, per job)');
console.log(`  P50:            ${procP50.toFixed(2)}ms`);
console.log(`  P95:            ${procP95.toFixed(2)}ms`);
console.log(`  P99:            ${procP99.toFixed(2)}ms`);
console.log('-'.repeat(70));
console.log('MEMORY (flashQ server)');
console.log(`  Initial:        ${initialStats?.memoryMB.toFixed(1) || 'N/A'} MB`);
console.log(`  After push:     ${afterPushStats?.memoryMB.toFixed(1) || 'N/A'} MB`);
console.log(`  Final:          ${finalStats?.memoryMB.toFixed(1) || 'N/A'} MB`);
console.log(`  Delta:          +${((finalStats?.memoryMB || 0) - (initialStats?.memoryMB || 0)).toFixed(1)} MB`);
console.log('='.repeat(70));

// Cleanup
await queue.obliterate();
await queue.close();

console.log('\n✅ Benchmark complete!');
process.exit(0);
