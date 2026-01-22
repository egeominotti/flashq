/**
 * Concurrent Clients Stress Test
 *
 * Simulates multiple independent clients pushing/processing simultaneously:
 * - Multiple queues (different shards)
 * - Concurrent push and process operations
 * - Tests lock contention under realistic multi-tenant load
 */
import { Queue, Worker } from '../src';

// Configuration
const NUM_QUEUES = 8;  // Different queues to hit different shards
const JOBS_PER_QUEUE = 100_000;
const BATCH_SIZE = 500;
const WORKERS_PER_QUEUE = 4;
const CONCURRENCY_PER_WORKER = 50;
const PUSH_DELAY_MS = 0;  // Delay between push batches (0 = max speed)

interface QueueStats {
  queue: string;
  pushed: number;
  processed: number;
  errors: number;
  pushRate: number;
  processRate: number;
  totalTime: number;
}

async function runQueueTest(queueName: string, queueIndex: number): Promise<QueueStats> {
  const queue = new Queue(queueName, {
    timeout: 30000,
    defaultJobOptions: {
      removeOnComplete: true,
      timeout: 60000,
    }
  });

  await queue.obliterate();

  let pushed = 0;
  let processed = 0;
  let errors = 0;

  const start = Date.now();

  // Create workers first
  const workers: Worker[] = [];
  for (let w = 0; w < WORKERS_PER_QUEUE; w++) {
    const worker = new Worker(queueName, async (job) => {
      return { id: job.id };
    }, {
      concurrency: CONCURRENCY_PER_WORKER,
      batchSize: 50,
      autorun: false
    });

    worker.on('completed', () => { processed++; });
    worker.on('failed', () => { errors++; });
    workers.push(worker);
  }

  // Start workers
  await Promise.all(workers.map(w => w.start()));

  // Push jobs
  const pushStart = Date.now();
  for (let i = 0; i < JOBS_PER_QUEUE; i += BATCH_SIZE) {
    const batchCount = Math.min(BATCH_SIZE, JOBS_PER_QUEUE - i);
    const jobs = Array.from({ length: batchCount }, (_, j) => ({
      name: 'task',
      data: { queue: queueIndex, index: i + j }
    }));
    await queue.addBulk(jobs);
    pushed += batchCount;

    if (PUSH_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, PUSH_DELAY_MS));
    }
  }
  const pushTime = Date.now() - pushStart;
  const pushRate = Math.round(JOBS_PER_QUEUE / (pushTime / 1000));

  // Wait for processing
  const timeout = Date.now() + 120_000;
  while (processed + errors < JOBS_PER_QUEUE && Date.now() < timeout) {
    await new Promise(r => setTimeout(r, 50));
  }

  const totalTime = Date.now() - start;
  const processRate = Math.round(processed / (totalTime / 1000));

  // Cleanup
  await Promise.all(workers.map(w => w.close()));
  await queue.obliterate();
  await queue.close();

  return {
    queue: queueName,
    pushed,
    processed,
    errors,
    pushRate,
    processRate,
    totalTime,
  };
}

async function runConcurrentTest() {
  console.log('='.repeat(70));
  console.log('🔀 CONCURRENT CLIENTS STRESS TEST');
  console.log('='.repeat(70));
  console.log(`Number of queues: ${NUM_QUEUES}`);
  console.log(`Jobs per queue: ${JOBS_PER_QUEUE.toLocaleString()}`);
  console.log(`Total jobs: ${(NUM_QUEUES * JOBS_PER_QUEUE).toLocaleString()}`);
  console.log(`Workers per queue: ${WORKERS_PER_QUEUE}`);
  console.log(`Total workers: ${NUM_QUEUES * WORKERS_PER_QUEUE}`);
  console.log(`Total concurrency: ${NUM_QUEUES * WORKERS_PER_QUEUE * CONCURRENCY_PER_WORKER}`);
  console.log('='.repeat(70));
  console.log('');

  const overallStart = Date.now();

  console.log(`🚀 Starting ${NUM_QUEUES} concurrent queue tests...`);
  console.log('');

  // Run all queues concurrently
  const promises = Array.from({ length: NUM_QUEUES }, (_, i) =>
    runQueueTest(`concurrent-test-${i}`, i)
  );

  // Progress reporter
  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - overallStart) / 1000;
    const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`   [${elapsed.toFixed(0)}s] Running... Heap: ${heapMB}MB`);
  }, 5000);

  const results = await Promise.all(promises);

  clearInterval(progressInterval);

  const overallTime = Date.now() - overallStart;

  // Results
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 RESULTS BY QUEUE');
  console.log('='.repeat(70));
  console.log('');
  console.log('Queue              │ Push Rate    │ Process Rate │ Time    │ Status');
  console.log('─'.repeat(70));

  let totalPushed = 0;
  let totalProcessed = 0;
  let totalErrors = 0;

  for (const r of results) {
    totalPushed += r.pushed;
    totalProcessed += r.processed;
    totalErrors += r.errors;

    const status = r.errors === 0 && r.processed === JOBS_PER_QUEUE ? '✅' : '❌';
    console.log(
      `${r.queue.padEnd(18)} │ ` +
      `${r.pushRate.toLocaleString().padStart(12)}/s │ ` +
      `${r.processRate.toLocaleString().padStart(12)}/s │ ` +
      `${(r.totalTime/1000).toFixed(1).padStart(5)}s │ ` +
      status
    );
  }

  console.log('─'.repeat(70));

  // Aggregate stats
  const avgPushRate = Math.round(results.reduce((s, r) => s + r.pushRate, 0) / results.length);
  const avgProcessRate = Math.round(results.reduce((s, r) => s + r.processRate, 0) / results.length);
  const totalPushRate = Math.round(totalPushed / (overallTime / 1000));
  const totalProcessRate = Math.round(totalProcessed / (overallTime / 1000));

  console.log('');
  console.log('='.repeat(70));
  console.log('📊 AGGREGATE STATS');
  console.log('='.repeat(70));
  console.log(`Total jobs pushed: ${totalPushed.toLocaleString()}`);
  console.log(`Total jobs processed: ${totalProcessed.toLocaleString()}`);
  console.log(`Total errors: ${totalErrors.toLocaleString()}`);
  console.log(`Total time: ${(overallTime/1000).toFixed(2)}s`);
  console.log('');
  console.log('Per-queue averages:');
  console.log(`  Avg push rate: ${avgPushRate.toLocaleString()}/s`);
  console.log(`  Avg process rate: ${avgProcessRate.toLocaleString()}/s`);
  console.log('');
  console.log('Combined throughput (all queues):');
  console.log(`  Total push rate: ${totalPushRate.toLocaleString()}/s`);
  console.log(`  Total process rate: ${totalProcessRate.toLocaleString()}/s`);
  console.log('='.repeat(70));

  // Check for variance (all queues should have similar performance)
  const processRates = results.map(r => r.processRate);
  const minRate = Math.min(...processRates);
  const maxRate = Math.max(...processRates);
  const variance = ((maxRate - minRate) / avgProcessRate) * 100;

  console.log('');
  console.log('📉 FAIRNESS ANALYSIS');
  console.log(`Min process rate: ${minRate.toLocaleString()}/s`);
  console.log(`Max process rate: ${maxRate.toLocaleString()}/s`);
  console.log(`Variance: ${variance.toFixed(1)}% (should be <30%)`);

  const success = totalErrors === 0 &&
                  totalProcessed === totalPushed &&
                  variance < 30;  // Less than 30% variance between queues

  console.log('');
  if (success) {
    console.log('✅ TEST PASSED - Concurrent access is fair and stable!');
  } else {
    console.log('❌ TEST FAILED');
    if (totalErrors > 0) console.log(`   - ${totalErrors} total errors`);
    if (totalProcessed < totalPushed) console.log(`   - ${totalPushed - totalProcessed} jobs not processed`);
    if (variance >= 30) console.log(`   - ${variance.toFixed(1)}% variance (unfair scheduling)`);
  }

  process.exit(success ? 0 : 1);
}

runConcurrentTest().catch(console.error);
