/**
 * Duration-Based Stability Test
 *
 * Runs continuously for a fixed duration to test:
 * - Background cleanup task interference
 * - Memory stability over time
 * - Sustained throughput degradation
 * - Lock contention accumulation
 */
import { Queue, Worker } from '../src';

// Configuration
const DURATION_MINUTES = 5;  // Change to 30 for full test
const DURATION_MS = DURATION_MINUTES * 60 * 1000;
const BATCH_SIZE = 1000;
const NUM_WORKERS = 8;
const CONCURRENCY_PER_WORKER = 100;
const REPORT_INTERVAL_MS = 10_000;  // Report every 10 seconds

interface Stats {
  pushed: number;
  processed: number;
  errors: number;
  startTime: number;
  lastReportTime: number;
  lastPushed: number;
  lastProcessed: number;
  memorySnapshots: number[];
}

async function runDurationTest() {
  console.log('='.repeat(70));
  console.log(`🕐 DURATION-BASED STABILITY TEST - ${DURATION_MINUTES} minutes`);
  console.log('='.repeat(70));
  console.log(`Workers: ${NUM_WORKERS}`);
  console.log(`Concurrency/worker: ${CONCURRENCY_PER_WORKER}`);
  console.log(`Total concurrency: ${NUM_WORKERS * CONCURRENCY_PER_WORKER}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('='.repeat(70));
  console.log('');

  const queue = new Queue('stability-duration', {
    timeout: 30000,
    defaultJobOptions: {
      removeOnComplete: true,
      timeout: 60000,
    }
  });

  // Clean up before starting
  console.log('📋 Cleaning up queue...');
  await queue.obliterate();

  const stats: Stats = {
    pushed: 0,
    processed: 0,
    errors: 0,
    startTime: Date.now(),
    lastReportTime: Date.now(),
    lastPushed: 0,
    lastProcessed: 0,
    memorySnapshots: [],
  };

  const endTime = Date.now() + DURATION_MS;

  // Create workers
  console.log(`👷 Starting ${NUM_WORKERS} workers...`);
  const workers: Worker[] = [];

  for (let w = 0; w < NUM_WORKERS; w++) {
    const worker = new Worker('stability-duration', async (job) => {
      // Minimal work - just return
      return { id: job.id };
    }, {
      concurrency: CONCURRENCY_PER_WORKER,
      batchSize: 100,
      autorun: false
    });

    worker.on('completed', () => {
      stats.processed++;
    });

    worker.on('failed', () => {
      stats.errors++;
    });

    workers.push(worker);
  }

  // Start all workers
  await Promise.all(workers.map(w => w.start()));

  // Progress reporter
  const progressInterval = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - stats.startTime) / 1000;
    const remaining = Math.max(0, (endTime - now) / 1000);
    const intervalElapsed = (now - stats.lastReportTime) / 1000;

    const pushRate = Math.round((stats.pushed - stats.lastPushed) / intervalElapsed);
    const processRate = Math.round((stats.processed - stats.lastProcessed) / intervalElapsed);
    const avgPushRate = Math.round(stats.pushed / elapsed);
    const avgProcessRate = Math.round(stats.processed / elapsed);

    // Memory usage
    const memUsage = process.memoryUsage();
    const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    stats.memorySnapshots.push(heapMB);

    const backlog = stats.pushed - stats.processed;

    console.log(
      `[${Math.round(elapsed)}s] ` +
      `Push: ${pushRate.toLocaleString()}/s (avg ${avgPushRate.toLocaleString()}) | ` +
      `Process: ${processRate.toLocaleString()}/s (avg ${avgProcessRate.toLocaleString()}) | ` +
      `Backlog: ${backlog.toLocaleString()} | ` +
      `Heap: ${heapMB}MB | ` +
      `Remaining: ${Math.round(remaining)}s`
    );

    stats.lastReportTime = now;
    stats.lastPushed = stats.pushed;
    stats.lastProcessed = stats.processed;
  }, REPORT_INTERVAL_MS);

  // Push jobs continuously
  console.log('');
  console.log('🚀 Starting continuous push...');
  console.log('');

  let pushErrors = 0;
  while (Date.now() < endTime) {
    try {
      const jobs = Array.from({ length: BATCH_SIZE }, (_, j) => ({
        name: 'task',
        data: {
          index: stats.pushed + j,
          timestamp: Date.now()
        }
      }));

      await queue.addBulk(jobs);
      stats.pushed += BATCH_SIZE;
    } catch (err) {
      pushErrors++;
      // Brief pause on error
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log('');
  console.log('⏳ Waiting for remaining jobs to complete...');

  // Wait for processing to complete (max 60 seconds)
  const drainTimeout = Date.now() + 60_000;
  while (stats.processed < stats.pushed && Date.now() < drainTimeout) {
    await new Promise(r => setTimeout(r, 100));
  }

  clearInterval(progressInterval);

  // Stop all workers
  await Promise.all(workers.map(w => w.close()));

  // Cleanup
  await queue.obliterate();
  await queue.close();

  // Final report
  const totalTime = (Date.now() - stats.startTime) / 1000;
  const avgPushRate = Math.round(stats.pushed / totalTime);
  const avgProcessRate = Math.round(stats.processed / totalTime);
  const minMemory = Math.min(...stats.memorySnapshots);
  const maxMemory = Math.max(...stats.memorySnapshots);
  const memoryGrowth = maxMemory - minMemory;

  console.log('');
  console.log('='.repeat(70));
  console.log('📊 FINAL REPORT');
  console.log('='.repeat(70));
  console.log(`Duration: ${(totalTime / 60).toFixed(2)} minutes`);
  console.log(`Total pushed: ${stats.pushed.toLocaleString()}`);
  console.log(`Total processed: ${stats.processed.toLocaleString()}`);
  console.log(`Total errors: ${stats.errors.toLocaleString()}`);
  console.log(`Push errors: ${pushErrors.toLocaleString()}`);
  console.log(`Avg push rate: ${avgPushRate.toLocaleString()} jobs/sec`);
  console.log(`Avg process rate: ${avgProcessRate.toLocaleString()} jobs/sec`);
  console.log(`Memory: ${minMemory}MB -> ${maxMemory}MB (growth: ${memoryGrowth}MB)`);
  console.log('='.repeat(70));

  const success = stats.errors === 0 &&
                  pushErrors === 0 &&
                  stats.processed === stats.pushed &&
                  memoryGrowth < 500;  // Less than 500MB growth

  if (success) {
    console.log('✅ TEST PASSED - System is stable!');
  } else {
    console.log('❌ TEST FAILED');
    if (stats.errors > 0) console.log(`   - ${stats.errors} processing errors`);
    if (pushErrors > 0) console.log(`   - ${pushErrors} push errors`);
    if (stats.processed < stats.pushed) console.log(`   - ${stats.pushed - stats.processed} jobs not processed`);
    if (memoryGrowth >= 500) console.log(`   - Memory grew ${memoryGrowth}MB`);
  }

  process.exit(success ? 0 : 1);
}

runDurationTest().catch(console.error);
