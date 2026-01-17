/**
 * Advanced Features Example
 *
 * Demonstrates:
 * - FlashQClient (Namespace API)
 * - Circuit Breaker
 * - Retry with Jitter
 * - Workflows (DAG-based orchestration)
 *
 * Run: bun run examples/advanced-features.ts
 */

import {
  FlashQClient,
  CircuitBreaker,
  retry,
  Workflows,
  FlashQ,
} from '../src';

async function main() {
  console.log('='.repeat(60));
  console.log('flashQ Advanced Features Demo');
  console.log('='.repeat(60));

  // ============================================================
  // 1. FlashQClient - Namespace API
  // ============================================================
  console.log('\n1. FlashQClient (Namespace API)\n');

  const client = new FlashQClient({
    host: 'localhost',
    port: 6789,
    // Optional: enable circuit breaker
    circuitBreaker: {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 30000,
      onOpen: () => console.log('[CircuitBreaker] Circuit opened!'),
      onClose: () => console.log('[CircuitBreaker] Circuit closed'),
    },
  });

  await client.connect();

  // Jobs API
  const job = await client.jobs.create('demo-queue', { type: 'test' });
  console.log(`Created job: ${job.id}`);

  const jobState = await client.jobs.get(job.id);
  console.log(`Job state: ${jobState?.state}`);

  // Queues API
  const queues = await client.queues.list();
  console.log(`Queues: ${queues.map(q => q.name).join(', ')}`);

  // DLQ operations
  const dlqJobs = await client.queues.dlq.list('demo-queue');
  console.log(`DLQ jobs: ${dlqJobs.length}`);

  // ============================================================
  // 2. Circuit Breaker
  // ============================================================
  console.log('\n2. Circuit Breaker\n');

  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 5000,
    onOpen: () => console.log('[CB] Circuit OPEN - stopping requests'),
    onClose: () => console.log('[CB] Circuit CLOSED - requests allowed'),
    onHalfOpen: () => console.log('[CB] Circuit HALF-OPEN - testing...'),
  });

  // Simulate successful requests
  for (let i = 0; i < 3; i++) {
    try {
      await breaker.execute(async () => {
        console.log(`Request ${i + 1}: Success`);
        return 'ok';
      });
    } catch (e) {
      console.log(`Request ${i + 1}: Failed`);
    }
  }

  console.log(`Circuit state: ${breaker.getState()}`);

  // ============================================================
  // 3. Retry with Jitter
  // ============================================================
  console.log('\n3. Retry with Jitter\n');

  let attempts = 0;
  try {
    await retry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Simulated failure');
        }
        return 'success';
      },
      {
        maxRetries: 5,
        baseDelay: 100,
        factor: 2,
        jitter: true,
        onRetry: (error, attempt, delay) => {
          console.log(`Retry ${attempt}: ${error.message} (waiting ${delay.toFixed(0)}ms)`);
        },
      }
    );
    console.log(`Success after ${attempts} attempts`);
  } catch (e) {
    console.log(`Failed after ${attempts} attempts`);
  }

  // ============================================================
  // 4. Workflows (DAG-based orchestration)
  // ============================================================
  console.log('\n4. Workflows (DAG)\n');

  const workflows = new Workflows(client.raw);

  // Create an ETL-like workflow
  const workflow = await workflows.create({
    name: 'ETL Pipeline',
    jobs: [
      { key: 'extract', queue: 'etl', data: { source: 'database' } },
      { key: 'transform', queue: 'etl', data: { format: 'json' }, dependsOn: ['extract'] },
      { key: 'load', queue: 'etl', data: { destination: 's3' }, dependsOn: ['transform'] },
    ],
  });

  console.log('Workflow created:');
  console.log(`  Name: ${workflow.name}`);
  console.log(`  Jobs: ${Object.entries(workflow.jobIds).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  // Get workflow status
  const status = await workflows.getStatus(workflow);
  console.log('\nWorkflow status:');
  for (const [key, job] of Object.entries(status)) {
    console.log(`  ${key}: ${job?.state ?? 'not found'}`);
  }

  // ============================================================
  // 5. Batch Status
  // ============================================================
  console.log('\n5. Batch Status\n');

  // Create multiple jobs
  const jobs = await client.raw.pushBatch('batch-demo', [
    { data: { item: 1 } },
    { data: { item: 2 } },
    { data: { item: 3 } },
  ]);

  console.log(`Created ${jobs.length} jobs: ${jobs.join(', ')}`);

  // Get all statuses in one call
  const batchStatus = await client.jobs.getBatch(jobs);
  console.log('Batch status:');
  for (const { job, state } of batchStatus) {
    console.log(`  Job ${job.id}: ${state}`);
  }

  // ============================================================
  // Cleanup
  // ============================================================
  console.log('\nCleaning up...');
  await client.queues.obliterate('demo-queue');
  await client.queues.obliterate('etl');
  await client.queues.obliterate('batch-demo');
  await client.close();

  console.log('\nDone!');
}

main().catch(console.error);
