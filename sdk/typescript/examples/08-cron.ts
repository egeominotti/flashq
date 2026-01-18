/**
 * Cron Jobs - Scheduled recurring tasks
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

// Worker to process cron jobs
const worker = new Worker('maintenance', async (job) => {
  console.log('Running cron job:', job.data);
  return { ran: new Date().toISOString() };
});

await worker.start();

// Add cron job - runs every 2 seconds
await client.addCron('cleanup', {
  queue: 'maintenance',
  data: { task: 'cleanup' },
  repeat_every: 2000,
});

console.log('Cron job added, waiting 10 seconds...');

// List cron jobs
const crons = await client.listCrons();
console.log('Active crons:', crons.map(c => c.name));

// Wait for a few runs
await new Promise(r => setTimeout(r, 10000));

// Delete cron job
await client.deleteCron('cleanup');
console.log('Cron job deleted');

await worker.stop();
await client.close();
