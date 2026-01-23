import { FlashQ } from './src/index';

async function main() {
  const client = new FlashQ({ port: 6789 });
  await client.connect();
  
  console.log('Connected to flashQ with NATS backend');
  
  // Push a job
  const job = await client.push('nats-queue', { hello: 'NATS', value: 42 });
  console.log('Pushed job:', job.id);
  
  // Pull the job
  const pulled = await client.pull('nats-queue');
  console.log('Pulled job:', pulled?.id, 'data:', pulled?.data);
  
  // Ack the job
  if (pulled) {
    await client.ack(pulled.id, { status: 'done' });
    console.log('Job acked');
  }
  
  // Check stats
  const stats = await client.stats();
  console.log('Stats:', stats);
  
  await client.close();
}

main().catch(console.error);
