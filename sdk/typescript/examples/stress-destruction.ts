/**
 * DESTRUCTION TEST - Find the Breaking Point
 *
 * Pushes the system to absolute limits until it fails:
 * - Exponentially increasing load
 * - Maximum concurrency
 * - No mercy mode
 */
import { Queue, Worker } from '../src';

const NUM_WORKERS = 16;
const CONCURRENCY_PER_WORKER = 200;
const INITIAL_BATCH = 10_000;
const BATCH_MULTIPLIER = 1.5;
const MAX_BATCH = 1_000_000;

async function destruction() {
  console.log('💀'.repeat(35));
  console.log('☠️  DESTRUCTION TEST - FINDING THE BREAKING POINT  ☠️');
  console.log('💀'.repeat(35));
  console.log(`Workers: ${NUM_WORKERS} x ${CONCURRENCY_PER_WORKER} = ${NUM_WORKERS * CONCURRENCY_PER_WORKER} concurrency`);
  console.log('');

  const queue = new Queue('destruction', {
    timeout: 120000,
    defaultJobOptions: { removeOnComplete: true, timeout: 300000 }
  });

  await queue.obliterate();

  let processed = 0;
  let errors = 0;
  let totalPushed = 0;
  let round = 0;
  let batchSize = INITIAL_BATCH;

  // Start workers
  const workers: Worker[] = [];
  for (let w = 0; w < NUM_WORKERS; w++) {
    const worker = new Worker('destruction', async () => ({ ok: true }), {
      concurrency: CONCURRENCY_PER_WORKER,
      batchSize: 200,
      autorun: false
    });
    worker.on('completed', () => processed++);
    worker.on('failed', () => errors++);
    workers.push(worker);
  }
  await Promise.all(workers.map(w => w.start()));

  const start = Date.now();

  while (batchSize <= MAX_BATCH) {
    round++;
    const roundStart = Date.now();

    console.log(`\n🔥 ROUND ${round}: ${batchSize.toLocaleString()} jobs`);

    try {
      // Push in chunks of 1000
      for (let i = 0; i < batchSize; i += 1000) {
        const chunk = Math.min(1000, batchSize - i);
        const jobs = Array.from({ length: chunk }, (_, j) => ({
          name: 'burn',
          data: { round, index: i + j }
        }));
        await queue.addBulk(jobs);
        totalPushed += chunk;
      }

      const pushTime = Date.now() - roundStart;
      const pushRate = Math.round(batchSize / (pushTime / 1000));
      console.log(`   📤 Push: ${pushRate.toLocaleString()}/s`);

      // Wait for processing
      const processStart = Date.now();
      const timeout = Date.now() + 120000;
      const target = totalPushed;

      while (processed + errors < target && Date.now() < timeout) {
        await new Promise(r => setTimeout(r, 50));
      }

      const processTime = Date.now() - processStart;
      const processRate = Math.round(batchSize / (processTime / 1000));
      const heap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      if (processed + errors < target) {
        console.log(`   ⚠️  TIMEOUT! Only ${processed + errors - (target - batchSize)}/${batchSize} completed`);
      }

      console.log(`   ⚡ Process: ${processRate.toLocaleString()}/s | Heap: ${heap}MB | Errors: ${errors}`);

      if (errors > 0) {
        console.log(`\n💥 SYSTEM BROKE AT ROUND ${round} (${batchSize.toLocaleString()} jobs)`);
        break;
      }

    } catch (err: any) {
      console.log(`\n💥 CRASH AT ROUND ${round}: ${err.message}`);
      break;
    }

    batchSize = Math.min(Math.round(batchSize * BATCH_MULTIPLIER), MAX_BATCH);
  }

  const elapsed = (Date.now() - start) / 1000;

  await Promise.all(workers.map(w => w.close()));
  await queue.obliterate();
  await queue.close();

  console.log('\n' + '='.repeat(70));
  console.log('📊 DESTRUCTION REPORT');
  console.log('='.repeat(70));
  console.log(`Rounds completed: ${round}`);
  console.log(`Total pushed: ${totalPushed.toLocaleString()}`);
  console.log(`Total processed: ${processed.toLocaleString()}`);
  console.log(`Total errors: ${errors}`);
  console.log(`Time: ${elapsed.toFixed(1)}s`);
  console.log(`Avg throughput: ${Math.round(processed / elapsed).toLocaleString()}/s`);

  if (errors === 0 && round > 10) {
    console.log('\n🏆 SYSTEM SURVIVED! Could not break it.');
  }
}

destruction().catch(console.error);
