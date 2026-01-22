/**
 * CHAOS TEST - Random Operations Storm
 *
 * Throws everything at once:
 * - Push, pull, ack, fail randomly
 * - Cancel jobs mid-flight
 * - Pause/resume queues
 * - Multiple queues simultaneously
 */
import { Queue, Worker, FlashQ } from '../src';

const DURATION_MS = 60_000;  // 1 minute of chaos
const NUM_QUEUES = 4;
const WORKERS_PER_QUEUE = 4;

interface ChaosStats {
  pushed: number;
  processed: number;
  cancelled: number;
  pauses: number;
  errors: number;
}

async function chaos() {
  console.log('🌪️'.repeat(35));
  console.log('🌪️  CHAOS TEST - RANDOM OPERATIONS STORM  🌪️');
  console.log('🌪️'.repeat(35));
  console.log(`Duration: ${DURATION_MS / 1000}s`);
  console.log(`Queues: ${NUM_QUEUES}`);
  console.log('');

  const stats: ChaosStats = {
    pushed: 0,
    processed: 0,
    cancelled: 0,
    pauses: 0,
    errors: 0,
  };

  const queues: Queue[] = [];
  const workers: Worker[] = [];
  const client = new FlashQ({ timeout: 30000 });
  await client.connect();

  // Setup queues and workers
  for (let q = 0; q < NUM_QUEUES; q++) {
    const queueName = `chaos-${q}`;
    const queue = new Queue(queueName, {
      timeout: 30000,
      defaultJobOptions: { removeOnComplete: true, timeout: 60000 }
    });
    await queue.obliterate();
    queues.push(queue);

    for (let w = 0; w < WORKERS_PER_QUEUE; w++) {
      const worker = new Worker(queueName, async (job) => {
        // Random delay 0-10ms
        await new Promise(r => setTimeout(r, Math.random() * 10));
        return { id: job.id };
      }, {
        concurrency: 100,
        batchSize: 50,
        autorun: false
      });
      worker.on('completed', () => stats.processed++);
      worker.on('failed', () => stats.errors++);
      workers.push(worker);
    }
  }

  await Promise.all(workers.map(w => w.start()));

  const endTime = Date.now() + DURATION_MS;
  const start = Date.now();

  // Chaos operations
  const operations = [
    // Push batch (60% chance)
    async () => {
      const q = queues[Math.floor(Math.random() * queues.length)];
      const count = Math.floor(Math.random() * 500) + 100;
      const jobs = Array.from({ length: count }, (_, i) => ({
        name: 'chaos',
        data: { i, t: Date.now() }
      }));
      await q.addBulk(jobs);
      stats.pushed += count;
    },
    // Pause/resume (5% chance)
    async () => {
      const q = queues[Math.floor(Math.random() * queues.length)];
      await q.pause();
      stats.pauses++;
      await new Promise(r => setTimeout(r, Math.random() * 100));
      await q.resume();
    },
    // Cancel random job (10% chance)
    async () => {
      // Try to cancel a random job ID
      const randomId = Math.floor(Math.random() * stats.pushed) + 1;
      try {
        const result = await client.cancel(randomId);
        if (result) stats.cancelled++;
      } catch {
        // Job might not exist or already processed
      }
    },
  ];

  const weights = [60, 5, 10];
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  console.log('🌪️ Starting chaos...\n');

  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    const remaining = Math.max(0, (endTime - Date.now()) / 1000);
    const heap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const backlog = stats.pushed - stats.processed;

    console.log(
      `[${elapsed.toFixed(0)}s] ` +
      `Push: ${stats.pushed.toLocaleString()} | ` +
      `Process: ${stats.processed.toLocaleString()} | ` +
      `Cancel: ${stats.cancelled} | ` +
      `Pause: ${stats.pauses} | ` +
      `Backlog: ${backlog.toLocaleString()} | ` +
      `Heap: ${heap}MB | ` +
      `Remaining: ${remaining.toFixed(0)}s`
    );
  }, 5000);

  // Run chaos
  while (Date.now() < endTime) {
    const promises: Promise<void>[] = [];

    // Run 10 random operations in parallel
    for (let i = 0; i < 10; i++) {
      const rand = Math.random() * totalWeight;
      let cumulative = 0;
      for (let j = 0; j < operations.length; j++) {
        cumulative += weights[j];
        if (rand < cumulative) {
          promises.push(operations[j]().catch(() => { stats.errors++; }));
          break;
        }
      }
    }

    await Promise.all(promises);
    await new Promise(r => setTimeout(r, 10));
  }

  clearInterval(progressInterval);

  console.log('\n⏳ Draining remaining jobs...');
  const drainTimeout = Date.now() + 30000;
  while (stats.processed < stats.pushed && Date.now() < drainTimeout) {
    await new Promise(r => setTimeout(r, 100));
  }

  // Cleanup
  await Promise.all(workers.map(w => w.close()));
  for (const q of queues) {
    await q.obliterate();
    await q.close();
  }
  await client.close();

  const elapsed = (Date.now() - start) / 1000;

  console.log('\n' + '='.repeat(70));
  console.log('📊 CHAOS REPORT');
  console.log('='.repeat(70));
  console.log(`Duration: ${elapsed.toFixed(1)}s`);
  console.log(`Total pushed: ${stats.pushed.toLocaleString()}`);
  console.log(`Total processed: ${stats.processed.toLocaleString()}`);
  console.log(`Cancelled: ${stats.cancelled}`);
  console.log(`Pauses: ${stats.pauses}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Throughput: ${Math.round(stats.processed / elapsed).toLocaleString()}/s`);

  const lost = stats.pushed - stats.processed - stats.cancelled;
  if (lost > 0) {
    console.log(`\n⚠️ LOST JOBS: ${lost}`);
  } else {
    console.log('\n✅ NO JOBS LOST - System handled chaos!');
  }
}

chaos().catch(console.error);
