/**
 * 100 MILLION JOBS TEST
 *
 * The ultimate stress test:
 * - 100 million jobs
 * - Maximum throughput
 * - Memory stability over extended run
 */
import { Queue, Worker } from '../src';

const TOTAL_JOBS = 100_000_000;  // 100 million
const BATCH_SIZE = 1000;
const NUM_WORKERS = 16;
const CONCURRENCY_PER_WORKER = 200;
const REPORT_INTERVAL = 30_000;  // Every 30 seconds

async function hundredMillion() {
  console.log('💯'.repeat(35));
  console.log('💯  100 MILLION JOBS TEST  💯');
  console.log('💯'.repeat(35));
  console.log(`Total jobs: ${TOTAL_JOBS.toLocaleString()}`);
  console.log(`Workers: ${NUM_WORKERS} x ${CONCURRENCY_PER_WORKER} = ${NUM_WORKERS * CONCURRENCY_PER_WORKER} concurrency`);
  console.log('');

  const queue = new Queue('hundred-million', {
    timeout: 60000,
    defaultJobOptions: {
      removeOnComplete: true,
      timeout: 120000,
    }
  });

  await queue.obliterate();

  let pushed = 0;
  let processed = 0;
  let errors = 0;
  const start = Date.now();
  const memoryHistory: number[] = [];

  // Start workers
  console.log(`👷 Starting ${NUM_WORKERS} workers...`);
  const workers: Worker[] = [];

  for (let w = 0; w < NUM_WORKERS; w++) {
    const worker = new Worker('hundred-million', async () => ({ ok: true }), {
      concurrency: CONCURRENCY_PER_WORKER,
      batchSize: 200,
      autorun: false
    });
    worker.on('completed', () => processed++);
    worker.on('failed', () => errors++);
    workers.push(worker);
  }

  await Promise.all(workers.map(w => w.start()));

  // Progress reporter
  let lastPushed = 0;
  let lastProcessed = 0;
  let lastTime = Date.now();

  const progressInterval = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - start) / 1000;
    const intervalTime = (now - lastTime) / 1000;

    const pushRate = Math.round((pushed - lastPushed) / intervalTime);
    const processRate = Math.round((processed - lastProcessed) / intervalTime);
    const avgPushRate = Math.round(pushed / elapsed);
    const avgProcessRate = Math.round(processed / elapsed);

    const heap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    memoryHistory.push(heap);

    const pctPushed = ((pushed / TOTAL_JOBS) * 100).toFixed(2);
    const pctProcessed = ((processed / TOTAL_JOBS) * 100).toFixed(2);
    const backlog = pushed - processed;

    const eta = avgProcessRate > 0
      ? Math.round((TOTAL_JOBS - processed) / avgProcessRate)
      : Infinity;
    const etaMin = Math.floor(eta / 60);
    const etaSec = eta % 60;

    console.log('─'.repeat(70));
    console.log(
      `📤 Pushed: ${pushed.toLocaleString()} (${pctPushed}%) | ` +
      `Rate: ${pushRate.toLocaleString()}/s (avg ${avgPushRate.toLocaleString()})`
    );
    console.log(
      `⚡ Processed: ${processed.toLocaleString()} (${pctProcessed}%) | ` +
      `Rate: ${processRate.toLocaleString()}/s (avg ${avgProcessRate.toLocaleString()})`
    );
    console.log(
      `📊 Backlog: ${backlog.toLocaleString()} | ` +
      `Errors: ${errors} | ` +
      `Heap: ${heap}MB | ` +
      `ETA: ${etaMin}m ${etaSec}s`
    );

    lastPushed = pushed;
    lastProcessed = processed;
    lastTime = now;
  }, REPORT_INTERVAL);

  // Push jobs continuously
  console.log('\n🚀 Starting push...\n');

  try {
    while (pushed < TOTAL_JOBS) {
      const remaining = TOTAL_JOBS - pushed;
      const batchCount = Math.min(BATCH_SIZE, remaining);

      const jobs = Array.from({ length: batchCount }, (_, j) => ({
        name: 'task',
        data: { i: pushed + j }
      }));

      await queue.addBulk(jobs);
      pushed += batchCount;
    }
  } catch (err: any) {
    console.log(`\n💥 PUSH ERROR: ${err.message}`);
  }

  console.log('\n✅ Push complete, waiting for processing...\n');

  // Wait for all processing
  const drainTimeout = Date.now() + 600_000;  // 10 min drain timeout
  while (processed + errors < TOTAL_JOBS && Date.now() < drainTimeout) {
    await new Promise(r => setTimeout(r, 100));
  }

  clearInterval(progressInterval);

  const elapsed = (Date.now() - start) / 1000;

  // Cleanup
  await Promise.all(workers.map(w => w.close()));
  await queue.obliterate();
  await queue.close();

  // Final report
  const minMem = Math.min(...memoryHistory);
  const maxMem = Math.max(...memoryHistory);
  const avgMem = Math.round(memoryHistory.reduce((a, b) => a + b, 0) / memoryHistory.length);

  console.log('\n' + '='.repeat(70));
  console.log('📊 100 MILLION JOBS REPORT');
  console.log('='.repeat(70));
  console.log(`Total pushed: ${pushed.toLocaleString()}`);
  console.log(`Total processed: ${processed.toLocaleString()}`);
  console.log(`Total errors: ${errors}`);
  console.log(`Time: ${(elapsed / 60).toFixed(2)} minutes`);
  console.log(`Avg push rate: ${Math.round(pushed / elapsed).toLocaleString()}/s`);
  console.log(`Avg process rate: ${Math.round(processed / elapsed).toLocaleString()}/s`);
  console.log(`Memory: min ${minMem}MB, max ${maxMem}MB, avg ${avgMem}MB`);
  console.log('='.repeat(70));

  if (errors === 0 && processed === TOTAL_JOBS) {
    console.log('\n🏆 100 MILLION JOBS COMPLETED SUCCESSFULLY!');
  } else {
    console.log('\n❌ TEST FAILED');
    if (errors > 0) console.log(`   - ${errors} errors`);
    if (processed < TOTAL_JOBS) console.log(`   - ${TOTAL_JOBS - processed} jobs not processed`);
  }
}

hundredMillion().catch(console.error);
