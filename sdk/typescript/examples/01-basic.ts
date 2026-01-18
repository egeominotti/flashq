/**
 * Basic Usage - Push, Pull, Ack
 */
import { FlashQ } from '../src';

const client = new FlashQ();

// Push a job
const job = await client.push('emails', {
  to: 'user@example.com',
  subject: 'Hello',
});
console.log('Pushed:', job.id);

// Pull and process
const pulled = await client.pull('emails');
if (pulled) {
  console.log('Processing:', pulled.data);
  await client.ack(pulled.id);
  console.log('Done!');
}

await client.close();
