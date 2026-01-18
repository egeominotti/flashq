/**
 * Queue Control - Pause, Resume, Drain
 */
import { Queue, Worker } from '../src';

const queue = new Queue('controlled');

// Add jobs
for (let i = 0; i < 5; i++) {
  await queue.add('task', { i });
}
console.log('Added 5 jobs');

// Pause queue
await queue.pause();
console.log('Queue paused:', await queue.isPaused());

// Worker won't process while paused
const worker = new Worker('controlled', async (job) => {
  console.log('Processing:', job.data.i);
  return { done: true };
}, { autorun: false });
await worker.start();

await new Promise(r => setTimeout(r, 1000));
console.log('(no jobs processed while paused)');

// Resume
await queue.resume();
console.log('Queue resumed');

await new Promise(r => setTimeout(r, 2000));

// Get counts
const counts = await queue.getJobCounts();
console.log('Job counts:', counts);

await worker.close();
await queue.obliterate(); // Clean up everything
await queue.close();
