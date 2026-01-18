/**
 * Pause & Resume - Queue control
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

await client.obliterate('tasks');

// Worker
const worker = new Worker('tasks', async (job) => {
  console.log(`Processing: ${job.data.task}`);
  return { done: true };
}, { concurrency: 1 });

await worker.start();

// Push some jobs
await client.push('tasks', { task: 'task-1' });
await client.push('tasks', { task: 'task-2' });
await new Promise(r => setTimeout(r, 500));

// Pause queue
await client.pause('tasks');
console.log('\nQueue PAUSED');
console.log('Is paused:', await client.isPaused('tasks'));

// Jobs pushed while paused won't be processed
await client.push('tasks', { task: 'task-3-while-paused' });
await client.push('tasks', { task: 'task-4-while-paused' });
console.log('Pushed 2 jobs while paused...');

await new Promise(r => setTimeout(r, 1000));
console.log('(nothing processed)\n');

// Resume queue
await client.resume('tasks');
console.log('Queue RESUMED');
console.log('Is paused:', await client.isPaused('tasks'));

await new Promise(r => setTimeout(r, 1000));

await worker.stop();
await client.obliterate('tasks');
await client.close();
