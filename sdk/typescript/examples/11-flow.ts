/**
 * Flows - Parent/Child Job Dependencies
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

await client.obliterate('sections');
await client.obliterate('report');

// Child worker - processes individual sections
const childWorker = new Worker('sections', async (job) => {
  console.log(`Processing section: ${job.data.section}`);
  await new Promise(r => setTimeout(r, 300));
  return { section: job.data.section, done: true };
}, { concurrency: 3 });

// Parent worker - runs after all children complete
const parentWorker = new Worker('report', async (job) => {
  console.log(`\nGenerating final report: ${job.data.type}`);
  return { report: 'complete' };
}, { concurrency: 1 });

await childWorker.start();
await parentWorker.start();

// Push a flow: parent waits for all children
console.log('Pushing flow with 3 children...');
const flow = await client.pushFlow(
  'report',
  { type: 'monthly' },
  [
    { queue: 'sections', data: { section: 'sales' } },
    { queue: 'sections', data: { section: 'marketing' } },
    { queue: 'sections', data: { section: 'operations' } },
  ]
);

console.log(`Parent ID: ${flow.parent_id}`);
console.log(`Children IDs: ${flow.children_ids.join(', ')}\n`);

// Wait for all processing
await new Promise(r => setTimeout(r, 2000));

await childWorker.stop();
await parentWorker.stop();
await client.obliterate('sections');
await client.obliterate('report');
await client.close();
