/**
 * Producer - Invia 100.000 job alla coda in batch
 * Esegui con: bun run examples/producer.ts
 */

import { FlashQ } from '../src';

const QUEUE_NAME = 'test-queue';
const TOTAL_JOBS = 1_000_000;
const BATCH_SIZE = 1_000;

async function main() {
  const client = new FlashQ({
    host: 'localhost',
    port: 6789,
  });

  await client.connect();
  console.log(`Producer connesso - Invio ${TOTAL_JOBS.toLocaleString()} job in batch da ${BATCH_SIZE}\n`);

  const startTime = Date.now();
  let totalSent = 0;

  for (let batch = 0; batch < TOTAL_JOBS / BATCH_SIZE; batch++) {
    const jobs = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const jobNum = batch * BATCH_SIZE + i + 1;
      jobs.push({
        data: {
          message: `Job numero ${jobNum}`,
          timestamp: new Date().toISOString(),
          payload: { value: Math.random() * 100 },
        },
        priority: Math.floor(Math.random() * 10),
        max_attempts: 3,
      });
    }

    await client.pushBatch(QUEUE_NAME, jobs);
    totalSent += BATCH_SIZE;

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = Math.round(totalSent / elapsed);
    console.log(`[BATCH ${batch + 1}/${TOTAL_JOBS / BATCH_SIZE}] ${totalSent.toLocaleString()} job inviati (${rate.toLocaleString()} job/sec)`);
  }

  const totalTime = (Date.now() - startTime) / 1000;
  const avgRate = Math.round(TOTAL_JOBS / totalTime);

  console.log(`\n=== COMPLETATO ===`);
  console.log(`Totale job: ${TOTAL_JOBS.toLocaleString()}`);
  console.log(`Tempo: ${totalTime.toFixed(2)}s`);
  console.log(`Rate medio: ${avgRate.toLocaleString()} job/sec`);

  await client.close();
}

main().catch(console.error);
