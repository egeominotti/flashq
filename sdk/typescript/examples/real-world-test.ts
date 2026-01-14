/**
 * Real-World Multiplexing Test
 * Tests that parallel requests on a single TCP connection work correctly
 */
import { FlashQ } from '../src';

async function main() {
  const client = new FlashQ({ host: 'localhost', port: 6789 });
  await client.connect();

  console.log('=== Multiplexing Test ===\n');

  // Test 1: Parallel push operations
  console.log('Test 1: Parallel Push (10 jobs simultaneously)');
  const pushPromises = Array.from({ length: 10 }, (_, i) =>
    client.push('multiplex-test', { index: i, timestamp: Date.now() })
  );

  const startPush = Date.now();
  const jobs = await Promise.all(pushPromises);
  const pushTime = Date.now() - startPush;

  console.log(`  - Pushed ${jobs.length} jobs in ${pushTime}ms`);
  console.log(`  - Job IDs: ${jobs.map((j) => j.id).join(', ')}`);

  // Verify all jobs have unique IDs
  const uniqueIds = new Set(jobs.map((j) => j.id));
  if (uniqueIds.size !== jobs.length) {
    throw new Error('FAIL: Duplicate job IDs detected!');
  }
  console.log('  - All job IDs are unique');

  // Test 2: Parallel pull + ack (simulate workers)
  console.log('\nTest 2: Parallel Pull + Ack (5 concurrent workers)');
  const workerPromises = Array.from({ length: 5 }, async (_, workerId) => {
    const job = await client.pull<{ index: number }>('multiplex-test');
    await client.ack(job.id, { workerId, processed: true });
    return { workerId, jobId: job.id, index: job.data.index };
  });

  const startWork = Date.now();
  const results = await Promise.all(workerPromises);
  const workTime = Date.now() - startWork;

  console.log(`  - Processed ${results.length} jobs in ${workTime}ms`);
  for (const r of results) {
    console.log(`    Worker ${r.workerId}: job ${r.jobId} (index: ${r.index})`);
  }

  // Test 3: Mixed operations in parallel
  console.log('\nTest 3: Mixed Operations in Parallel');
  const mixedStart = Date.now();
  const [stats, queues, remaining] = await Promise.all([
    client.stats(),
    client.listQueues(),
    client.pull<{ index: number }>('multiplex-test'),
  ]);
  const mixedTime = Date.now() - mixedStart;

  console.log(`  - Stats + ListQueues + Pull in ${mixedTime}ms`);
  console.log(`  - Stats: ${JSON.stringify(stats)}`);
  console.log(`  - Queues: ${queues.length} found`);
  console.log(`  - Remaining job pulled: ${remaining.id}`);

  // Ack the remaining job
  await client.ack(remaining.id);

  // Test 4: Burst parallel requests
  console.log('\nTest 4: Burst (100 parallel stats calls)');
  const burstPromises = Array.from({ length: 100 }, () => client.stats());

  const burstStart = Date.now();
  const burstResults = await Promise.all(burstPromises);
  const burstTime = Date.now() - burstStart;

  console.log(`  - 100 stats calls in ${burstTime}ms (${(100 / burstTime * 1000).toFixed(0)} ops/sec)`);
  console.log(`  - All responses received: ${burstResults.length === 100 ? 'YES' : 'NO'}`);

  // Test 5: Push with worker using finished() - separate connections
  // Note: finished() is a blocking call, so we need separate connections
  // for producer (push + finished) and worker (pull + ack)
  console.log('\nTest 5: Push + finished() with separate worker connection');

  const workerClient = new FlashQ({ host: 'localhost', port: 6789 });
  await workerClient.connect();

  const testJob = await client.push('finish-test', { value: 42 });
  console.log(`  - Pushed job ${testJob.id}`);

  // Simulate worker processing in parallel on separate connection
  const workerTask = (async () => {
    await new Promise((r) => setTimeout(r, 50)); // Small delay
    const job = await workerClient.pull<{ value: number }>('finish-test');
    await workerClient.ack(job.id, { result: job.data.value * 2 });
    return job.id;
  })();

  // Wait for job to finish (with custom timeout)
  const finishedStart = Date.now();
  const result = await client.finished(testJob.id, 5000);
  const finishedTime = Date.now() - finishedStart;

  const processedJobId = await workerTask;
  console.log(`  - Job ${processedJobId} processed by worker`);
  console.log(`  - finished() returned in ${finishedTime}ms`);
  console.log(`  - Result: ${JSON.stringify(result)}`);

  await workerClient.close();

  // Cleanup remaining jobs
  console.log('\nCleaning up...');
  const drained = await client.drain('multiplex-test');
  const drained2 = await client.drain('finish-test');
  console.log(`  - Drained ${drained + drained2} remaining jobs`);

  await client.close();
  console.log('\n=== All Multiplexing Tests Passed ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
