/**
 * Unique Jobs - Deduplication
 */
import { FlashQ } from '../src';

const client = new FlashQ();

await client.obliterate('orders');

// Push job with unique key
const job1 = await client.push('orders', { orderId: 123 }, {
  unique_key: 'order-123'
});
console.log('First push:', job1.id);

// Try to push duplicate - server rejects it
try {
  await client.push('orders', { orderId: 123 }, {
    unique_key: 'order-123'
  });
} catch (e: any) {
  console.log('Duplicate rejected:', e.message);
}

// Different key = new job
const job3 = await client.push('orders', { orderId: 456 }, {
  unique_key: 'order-456'
});
console.log('Different key:', job3.id);

// Check queue count
const count = await client.count('orders');
console.log(`\nQueue has ${count} unique jobs (duplicates rejected)`);

await client.obliterate('orders');
await client.close();
