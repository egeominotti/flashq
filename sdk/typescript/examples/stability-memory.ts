/**
 * Memory Stress Test
 *
 * Tests memory management under sustained load with:
 * - removeOnComplete: false (completed_jobs grows)
 * - Large job results (job_results grows)
 * - Tests cleanup_completed_jobs and cleanup_job_results
 */
import { Queue, Worker } from '../src';

// Configuration
const TOTAL_JOBS = 200_000;  // Should trigger cleanup (threshold is 50K)
const BATCH_SIZE = 1000;
const NUM_WORKERS = 8;
const CONCURRENCY_PER_WORKER = 100;
const RESULT_SIZE_BYTES = 1000;  // 1KB result per job

async function runMemoryTest() {
  console.log('='.repeat(70));
  console.log('🧠 MEMORY STRESS TEST - Tests Cleanup Thresholds');
  console.log('='.repeat(70));
  console.log(`Total jobs: ${TOTAL_JOBS.toLocaleString()}`);
  console.log(`removeOnComplete: false`);
  console.log(`Result size: ${RESULT_SIZE_BYTES} bytes per job`);
  console.log(`Expected data: ~${Math.round(TOTAL_JOBS * RESULT_SIZE_BYTES / 1024 / 1024)}MB in results`);
  console.log('');
  console.log('Cleanup thresholds:');
  console.log('  - completed_jobs: 50,000 (cleanup removes half)');
  console.log('  - job_results: 10,000 (cleanup removes half)');
  console.log('='.repeat(70));
  console.log('');

  const queue = new Queue('stability-memory', {
    timeout: 60000,
    defaultJobOptions: {
      removeOnComplete: false,  // Keep completed jobs
      timeout: 120000,
    }
  });

  // Clean up before starting
  console.log('📋 Cleaning up queue...');
  await queue.obliterate();

  const memorySnapshots: { time: number; heapMB: number; pushed: number; processed: number }[] = [];
  let processed = 0;
  let errors = 0;

  // Generate large result data
  const largeResult = 'x'.repeat(RESULT_SIZE_BYTES);

  // Push phase
  console.log(`📤 Pushing ${TOTAL_JOBS.toLocaleString()} jobs...`);
  const pushStart = Date.now();

  for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
    const batchCount = Math.min(BATCH_SIZE, TOTAL_JOBS - i);
    const jobs = Array.from({ length: batchCount }, (_, j) => ({
      name: 'task',
      data: {
        index: i + j,
        timestamp: Date.now()
      }
    }));
    await queue.addBulk(jobs);

    if ((i + BATCH_SIZE) % 50_000 === 0) {
      const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      console.log(`   Pushed: ${(i + BATCH_SIZE).toLocaleString()} | Heap: ${heapMB}MB`);
    }
  }

  const pushTime = Date.now() - pushStart;
  const pushRate = Math.round(TOTAL_JOBS / (pushTime / 1000));
  console.log(`✅ Push complete: ${pushRate.toLocaleString()} jobs/sec`);
  console.log('');

  // Process phase
  console.log(`👷 Starting ${NUM_WORKERS} workers...`);
  const processStart = Date.now();
  const workers: Worker[] = [];

  for (let w = 0; w < NUM_WORKERS; w++) {
    const worker = new Worker('stability-memory', async (job) => {
      // Return large result to stress job_results
      return {
        id: job.id,
        data: largeResult,
        processedAt: Date.now()
      };
    }, {
      concurrency: CONCURRENCY_PER_WORKER,
      batchSize: 100,
      autorun: false
    });

    worker.on('completed', () => {
      processed++;
    });

    worker.on('failed', () => {
      errors++;
    });

    workers.push(worker);
  }

  await Promise.all(workers.map(w => w.start()));

  // Progress reporter with memory tracking
  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - processStart) / 1000;
    const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const rate = Math.round(processed / elapsed);
    const pct = ((processed / TOTAL_JOBS) * 100).toFixed(1);

    memorySnapshots.push({
      time: elapsed,
      heapMB,
      pushed: TOTAL_JOBS,
      processed
    });

    console.log(
      `   ${processed.toLocaleString()}/${TOTAL_JOBS.toLocaleString()} (${pct}%) | ` +
      `${rate.toLocaleString()}/s | ` +
      `Heap: ${heapMB}MB`
    );
  }, 5000);

  // Wait for completion
  const timeout = Date.now() + 300_000;  // 5 minute timeout
  while (processed + errors < TOTAL_JOBS && Date.now() < timeout) {
    await new Promise(r => setTimeout(r, 100));
  }

  clearInterval(progressInterval);

  const processTime = Date.now() - processStart;
  const processRate = Math.round(TOTAL_JOBS / (processTime / 1000));

  // Stop all workers
  await Promise.all(workers.map(w => w.close()));

  // Final memory snapshot before cleanup
  const finalHeapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  memorySnapshots.push({
    time: processTime / 1000,
    heapMB: finalHeapMB,
    pushed: TOTAL_JOBS,
    processed
  });

  console.log('');
  console.log(`✅ Process complete: ${processRate.toLocaleString()} jobs/sec`);

  // Wait a bit to let cleanup run
  console.log('');
  console.log('⏳ Waiting 15s for cleanup tasks to run...');
  await new Promise(r => setTimeout(r, 15000));

  const afterCleanupHeapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  console.log(`   Heap after cleanup: ${afterCleanupHeapMB}MB`);

  // Cleanup
  console.log('');
  console.log('📋 Final obliterate...');
  await queue.obliterate();
  await queue.close();

  // Force GC if available
  if (global.gc) {
    global.gc();
  }

  const afterObliterateHeapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  console.log(`   Heap after obliterate: ${afterObliterateHeapMB}MB`);

  // Final report
  const minHeap = Math.min(...memorySnapshots.map(s => s.heapMB));
  const maxHeap = Math.max(...memorySnapshots.map(s => s.heapMB));

  console.log('');
  console.log('='.repeat(70));
  console.log('📊 FINAL REPORT');
  console.log('='.repeat(70));
  console.log(`Total pushed: ${TOTAL_JOBS.toLocaleString()}`);
  console.log(`Total processed: ${processed.toLocaleString()}`);
  console.log(`Total errors: ${errors.toLocaleString()}`);
  console.log(`Push rate: ${pushRate.toLocaleString()} jobs/sec`);
  console.log(`Process rate: ${processRate.toLocaleString()} jobs/sec`);
  console.log('');
  console.log('Memory Analysis:');
  console.log(`  Min heap: ${minHeap}MB`);
  console.log(`  Max heap: ${maxHeap}MB (during processing)`);
  console.log(`  After cleanup tasks: ${afterCleanupHeapMB}MB`);
  console.log(`  After obliterate: ${afterObliterateHeapMB}MB`);
  console.log(`  Peak growth: ${maxHeap - minHeap}MB`);
  console.log('');

  // Memory timeline
  console.log('Memory Timeline:');
  for (const snap of memorySnapshots.filter((_, i) => i % 3 === 0 || i === memorySnapshots.length - 1)) {
    const bar = '█'.repeat(Math.round(snap.heapMB / 20));
    console.log(`  ${snap.time.toFixed(0).padStart(4)}s │ ${snap.heapMB.toString().padStart(4)}MB │ ${bar}`);
  }

  console.log('='.repeat(70));

  // Success criteria:
  // - No errors
  // - All jobs processed
  // - Memory after cleanup should be less than peak (cleanup worked)
  // - Memory after obliterate should be reasonable
  const success = errors === 0 &&
                  processed === TOTAL_JOBS &&
                  afterCleanupHeapMB <= maxHeap &&
                  afterObliterateHeapMB < maxHeap;

  console.log('');
  if (success) {
    console.log('✅ TEST PASSED - Memory management is working!');
  } else {
    console.log('❌ TEST FAILED');
    if (errors > 0) console.log(`   - ${errors} errors occurred`);
    if (processed < TOTAL_JOBS) console.log(`   - ${TOTAL_JOBS - processed} jobs not processed`);
    if (afterCleanupHeapMB > maxHeap) console.log(`   - Memory grew after cleanup tasks`);
    if (afterObliterateHeapMB >= maxHeap) console.log(`   - Memory not freed after obliterate`);
  }

  process.exit(success ? 0 : 1);
}

runMemoryTest().catch(console.error);
