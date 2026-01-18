/**
 * Batch Operations - High throughput
 */
import { FlashQ } from '../src';

const client = new FlashQ();

// Push 1000 jobs in one call
const jobs = Array.from({ length: 1000 }, (_, i) => ({
  data: { index: i },
}));

console.time('push');
const ids = await client.pushBatch('batch-queue', jobs);
console.timeEnd('push');
console.log('Pushed:', ids.length, 'jobs');

// Pull batch
console.time('pull');
const pulled = await client.pullBatch('batch-queue', 1000, 5000);
console.timeEnd('pull');
console.log('Pulled:', pulled.length, 'jobs');

// Ack batch
console.time('ack');
await client.ackBatch(pulled.map(j => j.id));
console.timeEnd('ack');
console.log('Acked all jobs');

await client.close();
