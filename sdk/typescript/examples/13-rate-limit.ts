/**
 * Rate Limiting - Control throughput
 */
import { FlashQ } from '../src';

const client = new FlashQ();

await client.obliterate('api-calls');

// Set rate limit: 3 jobs per second
await client.setRateLimit('api-calls', 3);
console.log('Rate limit set: 3 jobs/sec\n');

// Push 9 jobs
for (let i = 0; i < 9; i++) {
  await client.push('api-calls', { endpoint: `/api/${i}` });
}
console.log('Pushed 9 jobs');

// Pull with rate limiting (should take ~3 seconds for 9 jobs at 3/sec)
const start = Date.now();
let pulled = 0;

while (pulled < 9) {
  const job = await client.pull('api-calls', 1000);
  if (!job) break;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[${elapsed}s] Pulled: ${job.data.endpoint}`);
  await client.ack(job.id);
  pulled++;
}

const total = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\nTotal time: ${total}s for ${pulled} jobs`);
console.log(`Effective rate: ${(pulled / parseFloat(total)).toFixed(1)} jobs/sec`);

await client.clearRateLimit('api-calls');
await client.obliterate('api-calls');
await client.close();
