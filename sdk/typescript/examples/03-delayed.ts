/**
 * Delayed Jobs - Schedule for later
 */
import { FlashQ } from '../src';

const client = new FlashQ();

// Schedule job for 5 seconds later
const job = await client.push('reminders', { message: 'Wake up!' }, {
  delay: 5000,
});
console.log('Scheduled job:', job.id, '(runs in 5s)');

// Wait and pull
await new Promise(r => setTimeout(r, 6000));
const pulled = await client.pull('reminders', 1000);
if (pulled) {
  console.log('Got delayed job:', pulled.data);
  await client.ack(pulled.id);
}

await client.close();
