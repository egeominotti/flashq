/**
 * Bulk Operations - Add multiple jobs at once
 */
import { Queue, Worker } from '../src';

const queue = new Queue('notifications');

// Add multiple jobs
const jobs = await queue.addBulk([
  { name: 'email', data: { to: 'user1@test.com' } },
  { name: 'email', data: { to: 'user2@test.com' }, opts: { priority: 10 } },
  { name: 'sms', data: { phone: '+1234567890' } },
]);

console.log('Added', jobs.length, 'jobs');

// Process all
const worker = new Worker('notifications', async (job) => {
  console.log('Sending:', job.data.name, job.data);
  return { sent: true };
});

await new Promise(r => setTimeout(r, 2000));

await worker.close();
await queue.close();
