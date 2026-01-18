/**
 * Priority - Higher priority jobs run first
 */
import { FlashQ } from '../src';

const client = new FlashQ();

// Push jobs with different priorities
await client.push('tasks', { name: 'low' }, { priority: 1 });
await client.push('tasks', { name: 'high' }, { priority: 100 });
await client.push('tasks', { name: 'medium' }, { priority: 50 });

// Pull in priority order
for (let i = 0; i < 3; i++) {
  const job = await client.pull('tasks', 1000);
  if (job) {
    console.log('Got:', job.data.name, '(priority:', job.priority, ')');
    await client.ack(job.id);
  }
}

await client.close();
