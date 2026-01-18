/**
 * Cron Jobs - Scheduled recurring tasks
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

// Add a cron job (runs every 2 seconds)
await client.addCron('cleanup', {
  queue: 'maintenance',
  data: { task: 'cleanup-temp' },
  repeat_every: 2000, // every 2 seconds
  limit: 3, // only run 3 times
});

console.log('Cron job added');

// List crons
const crons = await client.listCrons();
console.log('Active crons:', crons.map(c => c.name));

// Process cron jobs
const worker = new Worker('maintenance', async (job) => {
  console.log(`[${new Date().toLocaleTimeString()}] Running:`, job.data.task);
  return { done: true };
}, { autorun: false });
await worker.start();

// Wait for executions
await new Promise(r => setTimeout(r, 8000));

// Delete cron
await client.deleteCron('cleanup');
console.log('\nCron deleted');

await worker.close();
await client.close();
