/**
 * Consumer - 10 Worker separati visibili sulla dashboard
 * Esegui con: bun run examples/consumer.ts
 */

import { Worker } from '../src';

interface JobData {
  message: string;
  timestamp: string;
  payload: { value: number };
}

const QUEUE_NAME = 'test-queue';
const NUM_WORKERS = 10;

async function main() {
  let totalProcessed = 0;
  const workers: Worker<JobData>[] = [];

  // Crea 10 Worker separati
  for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new Worker<JobData>(
      QUEUE_NAME,
      async (_job) => {
        // No delay - max throughput
        return { processed: true };
      },
      {
        id: `worker-${i}`,
        host: 'localhost',
        port: 6789,
        concurrency: 10, // 10 connessioni per worker = 100 totali
        heartbeatInterval: 1000,
      }
    );

    worker.on('completed', () => {
      totalProcessed++;
      if (totalProcessed % 100 === 0) {
        console.log(`[PROGRESS] ${totalProcessed.toLocaleString()} job completati`);
      }
    });

    worker.on('error', (err) => {
      console.error(`[ERROR] Worker ${i}:`, err.message);
    });

    workers.push(worker);
  }

  // Avvia tutti i worker
  console.log(`Avvio ${NUM_WORKERS} worker separati...\n`);
  await Promise.all(workers.map((w) => w.start()));
  console.log(`[READY] ${NUM_WORKERS} worker attivi e visibili sulla dashboard\n`);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nChiusura...');
    await Promise.all(workers.map((w) => w.stop()));
    console.log(`Totale job processati: ${totalProcessed.toLocaleString()}`);
    process.exit(0);
  });
}

main().catch(console.error);
