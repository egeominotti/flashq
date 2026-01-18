/**
 * FlashQ KV Store Benchmark
 *
 * Compares sequential vs batch operations
 */
import { FlashQ } from '../src';

const KEYS = 5000;
const BATCH_SIZE = 1000; // Server limit

async function main() {
  const client = new FlashQ();
  await client.connect();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              FlashQ KV Store Benchmark                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // ============== Test 1: Sequential SET ==============
  console.log(`━━━ Test 1: Sequential SET (${KEYS} keys) ━━━`);
  let start = performance.now();

  for (let i = 0; i < KEYS; i++) {
    await client.kvSet(`seq:key:${i}`, { index: i, data: `value${i}` });
  }

  let elapsed = performance.now() - start;
  console.log(`  Duration:   ${elapsed.toFixed(0)} ms`);
  console.log(`  Throughput: ${(KEYS / elapsed * 1000).toFixed(0)} ops/sec`);
  console.log(`  Latency:    ${(elapsed / KEYS).toFixed(2)} ms/op\n`);

  // ============== Test 2: Batch MSET ==============
  console.log(`━━━ Test 2: Batch MSET (${KEYS} keys, ${BATCH_SIZE}/batch) ━━━`);

  start = performance.now();
  for (let i = 0; i < KEYS; i += BATCH_SIZE) {
    const entries = Array.from({ length: Math.min(BATCH_SIZE, KEYS - i) }, (_, j) => ({
      key: `batch:key:${i + j}`,
      value: { index: i + j, data: `value${i + j}` },
    }));
    await client.kvMset(entries);
  }
  elapsed = performance.now() - start;

  console.log(`  Duration:   ${elapsed.toFixed(0)} ms`);
  console.log(`  Throughput: ${(KEYS / elapsed * 1000).toFixed(0)} ops/sec`);
  console.log(`  Latency:    ${(elapsed / KEYS).toFixed(4)} ms/op\n`);

  // ============== Test 3: Sequential GET ==============
  console.log(`━━━ Test 3: Sequential GET (${KEYS} keys) ━━━`);
  start = performance.now();

  for (let i = 0; i < KEYS; i++) {
    await client.kvGet(`batch:key:${i}`);
  }

  elapsed = performance.now() - start;
  console.log(`  Duration:   ${elapsed.toFixed(0)} ms`);
  console.log(`  Throughput: ${(KEYS / elapsed * 1000).toFixed(0)} ops/sec`);
  console.log(`  Latency:    ${(elapsed / KEYS).toFixed(2)} ms/op\n`);

  // ============== Test 4: Batch MGET ==============
  console.log(`━━━ Test 4: Batch MGET (${KEYS} keys, ${BATCH_SIZE}/batch) ━━━`);

  start = performance.now();
  let totalRetrieved = 0;
  for (let i = 0; i < KEYS; i += BATCH_SIZE) {
    const batchKeys = Array.from({ length: Math.min(BATCH_SIZE, KEYS - i) }, (_, j) => `batch:key:${i + j}`);
    const values = await client.kvMget(batchKeys);
    totalRetrieved += values.filter(v => v !== null).length;
  }
  elapsed = performance.now() - start;

  console.log(`  Duration:   ${elapsed.toFixed(0)} ms`);
  console.log(`  Throughput: ${(KEYS / elapsed * 1000).toFixed(0)} ops/sec`);
  console.log(`  Latency:    ${(elapsed / KEYS).toFixed(4)} ms/op`);
  console.log(`  Retrieved:  ${totalRetrieved} values\n`);

  // ============== Test 5: INCR (Counter) ==============
  console.log(`━━━ Test 5: Sequential INCR (${KEYS} ops) ━━━`);
  start = performance.now();

  for (let i = 0; i < KEYS; i++) {
    await client.kvIncr('counter:bench');
  }

  elapsed = performance.now() - start;
  const finalValue = await client.kvGet<number>('counter:bench');

  console.log(`  Duration:   ${elapsed.toFixed(0)} ms`);
  console.log(`  Throughput: ${(KEYS / elapsed * 1000).toFixed(0)} ops/sec`);
  console.log(`  Final:      ${finalValue}\n`);

  // ============== Test 6: Keys pattern ==============
  console.log(`━━━ Test 6: KEYS pattern matching ━━━`);
  start = performance.now();
  const batchKeys = await client.kvKeys('batch:*');
  elapsed = performance.now() - start;

  console.log(`  Duration:   ${elapsed.toFixed(0)} ms`);
  console.log(`  Found:      ${batchKeys.length} keys\n`);

  // ============== Summary ==============
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                        Summary                               ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Batch operations (MSET/MGET) are 10-100x faster than        ║');
  console.log('║  sequential operations due to reduced network roundtrips.   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await client.close();
}

main().catch(console.error);
