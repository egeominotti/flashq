import { FlashQ } from './src/index';

async function main() {
  const client = new FlashQ({ port: 6789 });
  await client.connect();

  const JOBS = 1000;
  console.log(`Benchmarking ${JOBS} jobs with NATS backend...`);

  // Benchmark push
  const pushStart = performance.now();
  const jobs = [];
  for (let i = 0; i < JOBS; i++) {
    jobs.push(client.push('bench-nats', { i }));
  }
  await Promise.all(jobs);
  const pushTime = performance.now() - pushStart;
  console.log(`Push: ${JOBS} jobs in ${pushTime.toFixed(0)}ms (${(JOBS / (pushTime / 1000)).toFixed(0)} jobs/sec)`);

  // Benchmark pull + ack
  const pullStart = performance.now();
  for (let i = 0; i < JOBS; i++) {
    const job = await client.pull('bench-nats');
    if (job) await client.ack(job.id);
  }
  const pullTime = performance.now() - pullStart;
  console.log(`Pull+Ack: ${JOBS} jobs in ${pullTime.toFixed(0)}ms (${(JOBS / (pullTime / 1000)).toFixed(0)} jobs/sec)`);

  await client.close();
}

main().catch(console.error);
