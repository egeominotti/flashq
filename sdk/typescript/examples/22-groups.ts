/**
 * Group Support - FIFO processing within groups
 *
 * Jobs with the same group_id are processed sequentially (one at a time),
 * while different groups can be processed in parallel.
 *
 * Use case: Process all orders for a customer in sequence while allowing
 * orders from different customers to be processed in parallel.
 */
import { FlashQ } from '../src';

async function main() {
  const client = new FlashQ();
  await client.connect();

  console.log('=== Group Support Example ===\n');

  // Push multiple orders for customer A (same group)
  console.log('Pushing orders for Customer A (same group - processed sequentially)...');
  const customerA1 = await client.push('orders', { customer: 'A', order: 1 }, {
    group_id: 'customer-A'
  });
  const customerA2 = await client.push('orders', { customer: 'A', order: 2 }, {
    group_id: 'customer-A'
  });
  const customerA3 = await client.push('orders', { customer: 'A', order: 3 }, {
    group_id: 'customer-A'
  });

  // Push orders for customer B (different group)
  console.log('Pushing orders for Customer B (different group - can run in parallel)...');
  const customerB1 = await client.push('orders', { customer: 'B', order: 1 }, {
    group_id: 'customer-B'
  });
  const customerB2 = await client.push('orders', { customer: 'B', order: 2 }, {
    group_id: 'customer-B'
  });

  console.log(`\nPushed jobs: A1=${customerA1.id}, A2=${customerA2.id}, A3=${customerA3.id}, B1=${customerB1.id}, B2=${customerB2.id}`);

  // Simulate a worker pulling and processing jobs
  console.log('\n--- Simulating Worker Processing ---\n');

  // First pull - should get one job from each group (A and B can run in parallel)
  const job1 = await client.pull('orders');
  const job2 = await client.pull('orders');
  console.log(`First batch pulled: Job ${job1?.id} (${(job1?.data as any)?.customer}-${(job1?.data as any)?.order}), Job ${job2?.id} (${(job2?.data as any)?.customer}-${(job2?.data as any)?.order})`);

  // Third pull - should be blocked for both groups since each has one active job
  // Let's ack the first job and see that we can pull the next one from that group
  if (job1) {
    console.log(`\nAcking Job ${job1.id} (${(job1.data as any).customer}-${(job1.data as any).order})...`);
    await client.ack(job1.id);

    // Now we should be able to pull the next job from that customer's group
    const job3 = await client.pull('orders');
    console.log(`After ack, pulled: Job ${job3?.id} (${(job3?.data as any)?.customer}-${(job3?.data as any)?.order})`);

    if (job3) await client.ack(job3.id);
  }

  // Ack remaining jobs
  if (job2) await client.ack(job2.id);

  // Pull and ack remaining jobs
  let remaining = await client.pull('orders');
  while (remaining && remaining.id > 0) {
    console.log(`Processing remaining: Job ${remaining.id} (${(remaining.data as any).customer}-${(remaining.data as any).order})`);
    await client.ack(remaining.id);
    remaining = await client.pull('orders');
  }

  console.log('\n=== Group Support Benefits ===');
  console.log('1. Jobs within a group are processed in FIFO order');
  console.log('2. Different groups can be processed in parallel');
  console.log('3. Perfect for per-user, per-tenant, or per-resource processing');
  console.log('4. Ensures data consistency for related operations');

  await client.close();
  console.log('\nDone!');
}

main().catch(console.error);
