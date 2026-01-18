/**
 * Cancel Jobs - Remove pending jobs
 */
import { FlashQ } from '../src';

const client = new FlashQ();

await client.obliterate('emails');

// Push some jobs
const job1 = await client.push('emails', { to: 'user1@test.com' });
const job2 = await client.push('emails', { to: 'user2@test.com' });
const job3 = await client.push('emails', { to: 'user3@test.com' });

console.log('Pushed 3 jobs:', [job1.id, job2.id, job3.id]);
console.log('Queue count:', await client.count('emails'));

// Cancel the second job
await client.cancel(job2.id);
console.log(`\nCancelled job ${job2.id}`);

// Check state
const state = await client.getState(job2.id);
console.log(`Job ${job2.id} state:`, state);

// Queue count should be 2 now
console.log('Queue count after cancel:', await client.count('emails'));

// Pull remaining jobs
const pulled1 = await client.pull('emails', 1000);
const pulled2 = await client.pull('emails', 1000);
console.log('\nPulled jobs:', [pulled1?.id, pulled2?.id]);

await client.obliterate('emails');
await client.close();
