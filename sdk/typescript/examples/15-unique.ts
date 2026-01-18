/**
 * Unique Jobs - Deduplication
 */
import { FlashQ } from '../src';

const client = new FlashQ();

await client.obliterate('orders');

// Push with unique key
const job1 = await client.add('orders', { orderId: 123 }, {
  unique_key: 'order-123'
});
console.log('First push:', job1.id);

// Duplicate is rejected
try {
  await client.add('orders', { orderId: 123 }, {
    unique_key: 'order-123'
  });
} catch (e: any) {
  console.log('Duplicate rejected:', e.message);
}

// Different key = new job
const job2 = await client.add('orders', { orderId: 456 }, {
  unique_key: 'order-456'
});
console.log('Different key:', job2.id);

// Check count
const count = await client.count('orders');
console.log(`\nQueue has ${count} unique jobs`);

await client.obliterate('orders');
await client.close();
