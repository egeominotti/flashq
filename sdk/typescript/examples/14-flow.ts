/**
 * Job Flow - Parent/Child Dependencies
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

await client.obliterate('sections');
await client.obliterate('report');

// Child worker
const childWorker = new Worker('sections', async (job) => {
  console.log(`Processing section: ${job.data.section}`);
  await new Promise(r => setTimeout(r, 300));
  return { section: job.data.section, done: true };
}, { autorun: false, concurrency: 3 });

// Parent worker (runs after all children)
const parentWorker = new Worker('report', async (job) => {
  console.log(`\nGenerating report: ${job.data.type}`);
  return { report: 'complete' };
}, { autorun: false });

await childWorker.start();
await parentWorker.start();

// Push flow: parent waits for children
const flow = await client.pushFlow(
  'report',
  { type: 'monthly' },
  [
    { queue: 'sections', data: { section: 'sales' } },
    { queue: 'sections', data: { section: 'marketing' } },
    { queue: 'sections', data: { section: 'operations' } },
  ]
);

console.log(`Parent: ${flow.parent_id}`);
console.log(`Children: ${flow.children_ids.join(', ')}\n`);

await new Promise(r => setTimeout(r, 3000));

await childWorker.close();
await parentWorker.close();
await client.close();
