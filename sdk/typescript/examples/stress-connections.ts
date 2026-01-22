/**
 * CONNECTION STORM TEST
 *
 * Hammers the server with:
 * - Many simultaneous connections
 * - Rapid connect/disconnect cycles
 * - Concurrent operations from all connections
 */
import { FlashQ } from '../src';

const NUM_CONNECTIONS = 50;
const JOBS_PER_CONNECTION = 10_000;
const BATCH_SIZE = 500;

async function connectionStorm() {
  console.log('⚡'.repeat(35));
  console.log('⚡  CONNECTION STORM TEST  ⚡');
  console.log('⚡'.repeat(35));
  console.log(`Connections: ${NUM_CONNECTIONS}`);
  console.log(`Jobs per connection: ${JOBS_PER_CONNECTION.toLocaleString()}`);
  console.log(`Total jobs: ${(NUM_CONNECTIONS * JOBS_PER_CONNECTION).toLocaleString()}`);
  console.log('');

  const start = Date.now();
  let totalPushed = 0;
  let totalAcked = 0;
  let errors = 0;

  console.log(`🔌 Creating ${NUM_CONNECTIONS} connections...`);

  const runConnection = async (id: number): Promise<{ pushed: number; acked: number; errors: number }> => {
    const client = new FlashQ({ timeout: 60000 });
    let pushed = 0;
    let acked = 0;
    let errs = 0;

    try {
      await client.connect();

      const queueName = `storm-${id}`;

      // Push jobs
      for (let i = 0; i < JOBS_PER_CONNECTION; i += BATCH_SIZE) {
        const count = Math.min(BATCH_SIZE, JOBS_PER_CONNECTION - i);
        const jobs = Array.from({ length: count }, (_, j) => ({
          data: { conn: id, idx: i + j }
        }));

        try {
          await client.pushBatch(queueName, jobs);
          pushed += count;
        } catch {
          errs++;
        }
      }

      // Pull and ack jobs
      while (acked < pushed) {
        try {
          const jobs = await client.pullBatch(queueName, 100);
          if (jobs.length === 0) {
            await new Promise(r => setTimeout(r, 10));
            continue;
          }
          await client.ackBatch(jobs.map(j => j.id));
          acked += jobs.length;
        } catch {
          errs++;
          await new Promise(r => setTimeout(r, 10));
        }
      }

      // Cleanup
      await client.obliterate(queueName);
      await client.close();

    } catch (err: any) {
      errs++;
      try { await client.close(); } catch {}
    }

    return { pushed, acked, errors: errs };
  };

  // Progress tracker
  let completed = 0;
  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    const heap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(
      `[${elapsed.toFixed(0)}s] ` +
      `Completed: ${completed}/${NUM_CONNECTIONS} | ` +
      `Pushed: ${totalPushed.toLocaleString()} | ` +
      `Acked: ${totalAcked.toLocaleString()} | ` +
      `Heap: ${heap}MB`
    );
  }, 5000);

  // Run all connections concurrently
  const promises = Array.from({ length: NUM_CONNECTIONS }, (_, i) =>
    runConnection(i).then(result => {
      completed++;
      totalPushed += result.pushed;
      totalAcked += result.acked;
      errors += result.errors;
      return result;
    })
  );

  const results = await Promise.all(promises);
  clearInterval(progressInterval);

  const elapsed = (Date.now() - start) / 1000;

  console.log('\n' + '='.repeat(70));
  console.log('📊 CONNECTION STORM REPORT');
  console.log('='.repeat(70));
  console.log(`Total connections: ${NUM_CONNECTIONS}`);
  console.log(`Total pushed: ${totalPushed.toLocaleString()}`);
  console.log(`Total acked: ${totalAcked.toLocaleString()}`);
  console.log(`Total errors: ${errors}`);
  console.log(`Time: ${elapsed.toFixed(1)}s`);
  console.log(`Throughput: ${Math.round(totalAcked / elapsed).toLocaleString()}/s`);

  // Check results
  const successfulConns = results.filter(r => r.pushed === r.acked && r.errors === 0).length;
  console.log(`\nSuccessful connections: ${successfulConns}/${NUM_CONNECTIONS}`);

  if (successfulConns === NUM_CONNECTIONS && errors === 0) {
    console.log('\n✅ ALL CONNECTIONS SUCCESSFUL!');
  } else {
    console.log('\n⚠️ SOME CONNECTIONS HAD ISSUES');
  }
}

connectionStorm().catch(console.error);
