/**
 * BENCHMARK: JSON vs MessagePack - LARGE PAYLOADS
 *
 * Tests with larger payloads where MessagePack should show advantage.
 *
 * Run: bun run examples/benchmark-json-vs-msgpack-large.ts
 */

import { FlashQ, Worker } from '../src';

const TOTAL_JOBS = 10_000;
const BATCH_SIZE = 100;
const CONCURRENCY = 50;
const NUM_WORKERS = 4;

// Generate large payload (~5KB per job)
function generateLargePayload(id: number) {
  return {
    id,
    type: 'analytics_event',
    timestamp: Date.now(),
    user: {
      id: `user_${id}`,
      email: `user${id}@example.com`,
      name: `User Number ${id}`,
      preferences: {
        theme: 'dark',
        language: 'en',
        notifications: true,
        timezone: 'Europe/Rome',
      },
    },
    event: {
      name: 'page_view',
      properties: {
        page: '/dashboard/analytics',
        referrer: 'https://google.com/search?q=analytics',
        duration: 12345,
        scrollDepth: 85,
      },
    },
    context: {
      ip: '192.168.1.100',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      screen: { width: 1920, height: 1080 },
      viewport: { width: 1440, height: 900 },
    },
    // Add some bulk data
    metrics: Array.from({ length: 50 }, (_, i) => ({
      name: `metric_${i}`,
      value: Math.random() * 1000,
      tags: ['production', 'web', `region_${i % 5}`],
    })),
  };
}

interface BenchmarkResult {
  name: string;
  pushTime: number;
  pushRate: number;
  processTime: number;
  totalTime: number;
  throughput: number;
}

async function runBenchmark(useBinary: boolean): Promise<BenchmarkResult> {
  const protocol = useBinary ? 'MessagePack' : 'JSON';
  console.log(`\n┌─────────────────────────────────────────┐`);
  console.log(`│     ${protocol.padEnd(12)} (Large Payload)        │`);
  console.log(`└─────────────────────────────────────────┘\n`);

  const client = new FlashQ({ timeout: 60000, useBinary });
  await client.connect();

  const queueName = `bench-large-${protocol.toLowerCase()}`;
  await client.obliterate(queueName);

  let completed = 0;
  const workers: Worker[] = [];

  for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new Worker(
      queueName,
      async () => ({ ok: true }),
      { host: 'localhost', port: 6789, concurrency: CONCURRENCY, timeout: 60000, useBinary }
    );
    worker.on('completed', () => completed++);
    workers.push(worker);
  }

  await Promise.all(workers.map(w => w.start()));

  const startTime = Date.now();
  const pushStart = Date.now();

  for (let i = 0; i < TOTAL_JOBS; i += BATCH_SIZE) {
    const batch = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_JOBS - i) }, (_, j) => ({
      data: generateLargePayload(i + j),
    }));
    await client.pushBatch(queueName, batch);
  }

  const pushTime = Date.now() - pushStart;
  const payloadSize = JSON.stringify(generateLargePayload(0)).length;
  console.log(`  Payload size: ~${(payloadSize / 1024).toFixed(1)}KB per job`);
  console.log(`  Push: ${TOTAL_JOBS.toLocaleString()} jobs in ${pushTime}ms (${Math.round(TOTAL_JOBS / pushTime * 1000).toLocaleString()}/s)`);

  const processStart = Date.now();
  while (completed < TOTAL_JOBS) {
    await new Promise(r => setTimeout(r, 10));
  }
  const processTime = Date.now() - processStart;
  const totalTime = Date.now() - startTime;

  console.log(`  Process: ${completed.toLocaleString()} jobs in ${processTime}ms`);

  await Promise.all(workers.map(w => w.stop()));
  await client.obliterate(queueName);
  await client.close();

  return {
    name: protocol,
    pushTime,
    pushRate: Math.round((TOTAL_JOBS / pushTime) * 1000),
    processTime,
    totalTime,
    throughput: Math.round((TOTAL_JOBS / totalTime) * 1000),
  };
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║    BENCHMARK: JSON vs MessagePack (Large Payloads)        ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Jobs: ${TOTAL_JOBS.toLocaleString().padEnd(8)}  Payload: ~5KB   Workers: ${NUM_WORKERS}            ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const jsonResult = await runBenchmark(false);
  await new Promise(r => setTimeout(r, 1000));
  const msgpackResult = await runBenchmark(true);

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                      RESULTS                              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('┌────────────────┬────────────────┬────────────────┬─────────┐');
  console.log('│ Metric         │ JSON           │ MessagePack    │ Winner  │');
  console.log('├────────────────┼────────────────┼────────────────┼─────────┤');

  const metrics = [
    { name: 'Push Rate', json: jsonResult.pushRate, msgpack: msgpackResult.pushRate, unit: '/s' },
    { name: 'Total Time', json: jsonResult.totalTime, msgpack: msgpackResult.totalTime, unit: 'ms', invert: true },
    { name: 'Throughput', json: jsonResult.throughput, msgpack: msgpackResult.throughput, unit: '/s' },
  ];

  for (const m of metrics) {
    const jsonVal = m.unit === 'ms' ? `${m.json}${m.unit}` : `${m.json.toLocaleString()}${m.unit}`;
    const msgpackVal = m.unit === 'ms' ? `${m.msgpack}${m.unit}` : `${m.msgpack.toLocaleString()}${m.unit}`;
    const winner = m.invert
      ? (m.msgpack < m.json ? 'MsgPack' : 'JSON')
      : (m.msgpack > m.json ? 'MsgPack' : 'JSON');
    console.log(`│ ${m.name.padEnd(14)} │ ${jsonVal.padEnd(14)} │ ${msgpackVal.padEnd(14)} │ ${winner.padEnd(7)} │`);
  }

  console.log('└────────────────┴────────────────┴────────────────┴─────────┘');

  const speedup = (msgpackResult.throughput / jsonResult.throughput).toFixed(2);
  console.log(`\n📊 MessagePack is ${speedup}x ${Number(speedup) > 1 ? 'faster' : 'slower'} than JSON with large payloads\n`);
}

main().catch(console.error);
