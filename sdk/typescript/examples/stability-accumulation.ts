/**
 * Accumulation Stability Test
 *
 * Runs multiple batches WITHOUT obliterate() between runs to test:
 * - Memory accumulation over time
 * - Index growth handling
 * - Cleanup task effectiveness
 * - completed_jobs and job_results growth
 */
import { Queue, Worker } from '../src';

// Configuration
const JOBS_PER_RUN = 100_000;
const NUM_RUNS = 50;  // 5M total jobs without cleanup
const BATCH_SIZE = 1000;
const NUM_WORKERS = 8;
const CONCURRENCY_PER_WORKER = 100;

interface RunResult {
  run: number;
  pushTime: number;
  pushRate: number;
  processTime: number;
  processRate: number;
  processed: number;
  errors: number;
  heapMB: number;
}

async function runAccumulationTest() {
  console.log('='.repeat(70));
  console.log('📈 ACCUMULATION STABILITY TEST - No Cleanup Between Runs');
  console.log('='.repeat(70));
  console.log(`Jobs per run: ${JOBS_PER_RUN.toLocaleString()}`);
  console.log(`Number of runs: ${NUM_RUNS}`);
  console.log(`Total jobs: ${(JOBS_PER_RUN * NUM_RUNS).toLocaleString()}`);
  console.log(`removeOnComplete: false (jobs accumulate)`);
  console.log(`obliterate: false (no cleanup between runs)`);
  console.log('='.repeat(70));
  console.log('');

  const queue = new Queue('stability-accumulation', {
    timeout: 30000,
    defaultJobOptions: {
      removeOnComplete: false,  // Jobs stay in completed_jobs
      timeout: 60000,
    }
  });

  // Initial cleanup only
  console.log('📋 Initial cleanup...');
  await queue.obliterate();

  const results: RunResult[] = [];
  const overallStart = Date.now();

  for (let run = 1; run <= NUM_RUNS; run++) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`🚀 RUN ${run}/${NUM_RUNS}`);
    console.log('─'.repeat(70));

    let processed = 0;
    let errors = 0;

    // Push phase
    const pushStart = Date.now();
    for (let i = 0; i < JOBS_PER_RUN; i += BATCH_SIZE) {
      const batchCount = Math.min(BATCH_SIZE, JOBS_PER_RUN - i);
      const jobs = Array.from({ length: batchCount }, (_, j) => ({
        name: 'task',
        data: {
          run,
          index: i + j,
          timestamp: Date.now()
        }
      }));
      await queue.addBulk(jobs);
    }
    const pushTime = Date.now() - pushStart;
    const pushRate = Math.round(JOBS_PER_RUN / (pushTime / 1000));
    console.log(`📤 Push: ${pushRate.toLocaleString()}/s (${(pushTime/1000).toFixed(2)}s)`);

    // Process phase
    const processStart = Date.now();
    const workers: Worker[] = [];

    for (let w = 0; w < NUM_WORKERS; w++) {
      const worker = new Worker('stability-accumulation', async (job) => {
        return { id: job.id };
      }, {
        concurrency: CONCURRENCY_PER_WORKER,
        batchSize: 100,
        autorun: false
      });

      worker.on('completed', () => { processed++; });
      worker.on('failed', () => { errors++; });
      workers.push(worker);
    }

    await Promise.all(workers.map(w => w.start()));

    // Wait for completion
    const timeout = Date.now() + 120_000;
    while (processed + errors < JOBS_PER_RUN && Date.now() < timeout) {
      await new Promise(r => setTimeout(r, 100));
    }

    await Promise.all(workers.map(w => w.close()));

    const processTime = Date.now() - processStart;
    const processRate = Math.round(JOBS_PER_RUN / (processTime / 1000));

    // Memory snapshot
    const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    console.log(`⚡ Process: ${processRate.toLocaleString()}/s (${(processTime/1000).toFixed(2)}s)`);
    console.log(`📊 Processed: ${processed.toLocaleString()} | Errors: ${errors} | Heap: ${heapMB}MB`);

    results.push({
      run,
      pushTime,
      pushRate,
      processTime,
      processRate,
      processed,
      errors,
      heapMB,
    });

    // NO obliterate() here - jobs accumulate!
  }

  const overallTime = Date.now() - overallStart;

  // Final cleanup
  console.log('\n📋 Final cleanup...');
  await queue.obliterate();
  await queue.close();

  // Final report
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(70));
  console.log('');
  console.log('Run  │ Push Rate    │ Process Rate │ Heap    │ Status');
  console.log('─'.repeat(70));

  let totalProcessed = 0;
  let totalErrors = 0;

  for (const r of results) {
    totalProcessed += r.processed;
    totalErrors += r.errors;
    const status = r.errors === 0 && r.processed === JOBS_PER_RUN ? '✅' : '❌';
    console.log(
      `#${r.run.toString().padStart(2)} │ ` +
      `${r.pushRate.toLocaleString().padStart(12)}/s │ ` +
      `${r.processRate.toLocaleString().padStart(12)}/s │ ` +
      `${r.heapMB.toString().padStart(5)}MB │ ` +
      status
    );
  }

  console.log('─'.repeat(70));

  // Averages
  const avgPushRate = Math.round(results.reduce((s, r) => s + r.pushRate, 0) / results.length);
  const avgProcessRate = Math.round(results.reduce((s, r) => s + r.processRate, 0) / results.length);
  const minHeap = Math.min(...results.map(r => r.heapMB));
  const maxHeap = Math.max(...results.map(r => r.heapMB));
  const heapGrowth = maxHeap - minHeap;
  const successCount = results.filter(r => r.errors === 0 && r.processed === JOBS_PER_RUN).length;

  console.log(
    `AVG │ ` +
    `${avgPushRate.toLocaleString().padStart(12)}/s │ ` +
    `${avgProcessRate.toLocaleString().padStart(12)}/s │ ` +
    `${maxHeap.toString().padStart(5)}MB │ ` +
    `${successCount}/${NUM_RUNS} passed`
  );

  console.log('');
  console.log(`Total jobs: ${(JOBS_PER_RUN * NUM_RUNS).toLocaleString()}`);
  console.log(`Total processed: ${totalProcessed.toLocaleString()}`);
  console.log(`Total errors: ${totalErrors.toLocaleString()}`);
  console.log(`Memory growth: ${minHeap}MB -> ${maxHeap}MB (+${heapGrowth}MB)`);
  console.log(`Total time: ${(overallTime / 1000 / 60).toFixed(2)} minutes`);
  console.log('='.repeat(70));

  // Check for degradation (compare first 5 vs last 5 runs)
  const firstRuns = results.slice(0, 5);
  const lastRuns = results.slice(-5);
  const firstAvgProcess = firstRuns.reduce((s, r) => s + r.processRate, 0) / 5;
  const lastAvgProcess = lastRuns.reduce((s, r) => s + r.processRate, 0) / 5;
  const degradation = ((firstAvgProcess - lastAvgProcess) / firstAvgProcess) * 100;

  console.log('');
  console.log('📉 DEGRADATION ANALYSIS');
  console.log(`First 5 runs avg: ${Math.round(firstAvgProcess).toLocaleString()}/s`);
  console.log(`Last 5 runs avg: ${Math.round(lastAvgProcess).toLocaleString()}/s`);
  console.log(`Degradation: ${degradation.toFixed(1)}%`);

  const success = totalErrors === 0 &&
                  totalProcessed === JOBS_PER_RUN * NUM_RUNS &&
                  degradation < 20;  // Less than 20% degradation

  console.log('');
  if (success) {
    console.log('✅ TEST PASSED - System handles accumulation well!');
  } else {
    console.log('❌ TEST FAILED');
    if (totalErrors > 0) console.log(`   - ${totalErrors} total errors`);
    if (totalProcessed < JOBS_PER_RUN * NUM_RUNS) {
      console.log(`   - ${JOBS_PER_RUN * NUM_RUNS - totalProcessed} jobs not processed`);
    }
    if (degradation >= 20) console.log(`   - ${degradation.toFixed(1)}% performance degradation`);
  }

  process.exit(success ? 0 : 1);
}

runAccumulationTest().catch(console.error);
