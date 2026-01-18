/**
 * Custom Job ID - Lookup & Tracking
 *
 * Note: Use `unique_key` for deduplication (see 12-unique.ts)
 * Use `jobId` for custom ID lookup and tracking
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

await client.obliterate('payments');

// Push with custom job ID for tracking
const orderId = 'order-12345';
const job = await client.push('payments',
  { orderId, amount: 99.99 },
  { jobId: orderId }
);
console.log('Created job with custom ID');
console.log('Internal ID:', job.id);
console.log('Custom ID:', orderId);

// Lookup by custom ID (useful for external systems)
const found = await client.getJobByCustomId(orderId);
console.log('\nLookup by custom ID:', found ? `found (id: ${found.job.id})` : 'not found');
console.log('State:', found?.state);

// Process the job
const worker = new Worker('payments', async (job) => {
  console.log(`\nProcessing: ${job.data.orderId}`);
  await new Promise(r => setTimeout(r, 300));
  return { status: 'paid', txn: 'txn_' + Date.now() };
}, { concurrency: 1 });

await worker.start();
await new Promise(r => setTimeout(r, 1000));

// Check state after processing
const after = await client.getJobByCustomId(orderId);
console.log('\nAfter processing:');
console.log('State:', after?.state);

// Get result
const result = await client.getResult(job.id);
console.log('Result:', result);

await worker.stop();
await client.obliterate('payments');
await client.close();
