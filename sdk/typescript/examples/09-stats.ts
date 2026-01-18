/**
 * Stats & Metrics
 */
import { FlashQ } from '../src';

const client = new FlashQ();

// Push some jobs
for (let i = 0; i < 10; i++) {
  await client.push('test', { i });
}

// Get stats
const stats = await client.stats();
console.log('Stats:', stats);

// Get detailed metrics
const metrics = await client.metrics();
console.log('Metrics:', metrics);

// List queues
const queues = await client.listQueues();
console.log('Queues:', queues);

await client.close();
