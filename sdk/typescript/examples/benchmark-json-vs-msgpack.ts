/**
 * BENCHMARK: JSON vs MessagePack Protocol
 *
 * Compares flashQ performance with JSON vs Binary (MessagePack) protocol.
 *
 * Run: bun run examples/benchmark-json-vs-msgpack.ts
 */

import { FlashQ, Worker } from '../src';

const TOTAL_JOBS = 50_000;
const BATCH_SIZE = 500;
const CONCURRENCY = 100;
const NUM_WORKERS = 8;

interface BenchmarkResult {
  name: string;
  pushTime: number;
  pushRate: number;
  processTime: number;
  processRate: number;
  totalTime: number;
  throughput: number;
}

async function runBenchmark(useBinary: boolean): Promise<BenchmarkResult> {
  const protocol = useBinary ? 'MessagePack' : 'JSON';
  console.log(`\n┌─────────────────────────────────────────┐`);
  console.log(`│     flashQ ${protocol.padEnd(12)} Benchmark       │`);
  console.log(`└─────────────────────────────────────────┘\n`);

  const client = new FlashQ({ timeout: 30000, useBinary });
  await client.connect();

  const queueName = `bench-${protocol.toLowerCase()}`;
  await client.obliterate(queueName);

  let completed = 0;
  const workers: Worker[] = [];

  // Create workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new Worker(
      queueName,
      async () => ({ ok: true }),
      { host: 'localhost', port: 6789, concurrency: CONCURRENCY, timeout: 30000, useBinary }
    );
    worker.on('completed', () => completed++);
    workers.push(worker);
  }

  await Promise.all(workers.map(w => w.start()));

  // Push jobs with realistic payload
  const startTime = Date.now();
  const pushStart = Date.now();

  for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_JOBS - i) }, (_, j) => ({
      data: {
        id: i + j,
        type: 'email',
        payload: {
          to: `user${i + j}@example.com`,
          subject: 'Hello World',
          body: 'This is a test email with some content to simulate realistic payload size.',
          metadata: { timestamp: Date.now(), priority: 'high', tags: ['test', 'benchmark'] }
        }
      },
    }));
    await client.pushBatch(queueName, batch);
  }

  const pushTime = Date.now() - pushStart;
  console.log(`  Push: ${TOTAL_JOBS.toLocaleString()} jobs in ${pushTime}ms (${Math.round(TOTAL_JOBS / pushTime * 1000).toLocaleString()}/s)`);

  // Wait for completion
  const processStart = Date.now();
  while (completed < TOTAL_JOBS) {
    await new Promise(r => setTimeout(r, 10));
  }
  const processTime = Date.now() - processStart;
  const totalTime = Date.now() - startTime;

  console.log(`  Process: ${completed.toLocaleString()} jobs in ${processTime}ms (${Math.round(TOTAL_JOBS / processTime * 1000).toLocaleString()}/s)`);

  // Cleanup
  await Promise.all(workers.map(w => w.stop()));
  await client.obliterate(queueName);
  await client.close();

  return {
    name: protocol,
    pushTime,
    pushRate: Math.round((TOTAL_JOBS / pushTime) * 1000),
    processTime,
    processRate: Math.round((TOTAL_JOBS / processTime) * 1000),
    totalTime,
    throughput: Math.round((TOTAL_JOBS / totalTime) * 1000),
  };
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║       BENCHMARK: JSON vs MessagePack Protocol             ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Jobs: ${TOTAL_JOBS.toLocaleString().padEnd(10)} Workers: ${NUM_WORKERS}    Concurrency: ${CONCURRENCY}     ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');

  // Run JSON benchmark first
  const jsonResult = await runBenchmark(false);

  // Small pause between tests
  await new Promise(r => setTimeout(r, 1000));

  // Run MessagePack benchmark
  const msgpackResult = await runBenchmark(true);

  // Results
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                      RESULTS                              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('┌────────────────┬────────────────┬────────────────┬─────────┐');
  console.log('│ Metric         │ JSON           │ MessagePack    │ Winner  │');
  console.log('├────────────────┼────────────────┼────────────────┼─────────┤');

  const metrics = [
    {
      name: 'Push Rate',
      json: `${jsonResult.pushRate.toLocaleString()}/s`,
      msgpack: `${msgpackResult.pushRate.toLocaleString()}/s`,
      winner: msgpackResult.pushRate > jsonResult.pushRate ? 'MsgPack' : 'JSON',
    },
    {
      name: 'Process Rate',
      json: `${jsonResult.processRate.toLocaleString()}/s`,
      msgpack: `${msgpackResult.processRate.toLocaleString()}/s`,
      winner: msgpackResult.processRate > jsonResult.processRate ? 'MsgPack' : 'JSON',
    },
    {
      name: 'Total Time',
      json: `${jsonResult.totalTime}ms`,
      msgpack: `${msgpackResult.totalTime}ms`,
      winner: msgpackResult.totalTime < jsonResult.totalTime ? 'MsgPack' : 'JSON',
    },
    {
      name: 'Throughput',
      json: `${jsonResult.throughput.toLocaleString()}/s`,
      msgpack: `${msgpackResult.throughput.toLocaleString()}/s`,
      winner: msgpackResult.throughput > jsonResult.throughput ? 'MsgPack' : 'JSON',
    },
  ];

  for (const m of metrics) {
    console.log(`│ ${m.name.padEnd(14)} │ ${m.json.padEnd(14)} │ ${m.msgpack.padEnd(14)} │ ${m.winner.padEnd(7)} │`);
  }

  console.log('└────────────────┴────────────────┴────────────────┴─────────┘');

  // Summary
  const speedup = (msgpackResult.throughput / jsonResult.throughput).toFixed(2);
  const pushSpeedup = (msgpackResult.pushRate / jsonResult.pushRate).toFixed(2);

  console.log(`\n📊 MessagePack vs JSON:`);
  console.log(`   Push:       ${pushSpeedup}x ${Number(pushSpeedup) > 1 ? 'faster' : 'slower'}`);
  console.log(`   Throughput: ${speedup}x ${Number(speedup) > 1 ? 'faster' : 'slower'}`);

  if (Number(speedup) > 1) {
    console.log(`\n🏆 MessagePack is ${speedup}x faster than JSON!\n`);
  } else {
    console.log(`\n📝 JSON and MessagePack have similar performance.\n`);
  }
}

main().catch(console.error);
