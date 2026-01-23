/**
 * Bottleneck Analysis Benchmark
 *
 * Isolates and measures:
 * 1. Network I/O (TCP roundtrip)
 * 2. Serialization (JSON vs MessagePack)
 * 3. Client overhead (Promise, GC)
 * 4. Server processing time
 */
import { FlashQ } from "../src";
import { connect, Socket } from "net";

const ITERATIONS = 10_000;
const WARMUP = 1_000;

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1: Raw TCP Latency (ping-pong)
// ═══════════════════════════════════════════════════════════════════════════════
async function measureRawTcpLatency(): Promise<{ avg: number; p99: number }> {
  return new Promise((resolve) => {
    const socket = connect(6789, "localhost", () => {
      const latencies: number[] = [];
      let count = 0;

      const sendPing = () => {
        const start = performance.now();
        // Send minimal command: STATS (small response)
        socket.write('{"cmd":"STATS"}\n');

        socket.once("data", () => {
          const latency = (performance.now() - start) * 1000; // µs
          if (count >= WARMUP) {
            latencies.push(latency);
          }
          count++;

          if (count < ITERATIONS + WARMUP) {
            setImmediate(sendPing);
          } else {
            socket.end();
            latencies.sort((a, b) => a - b);
            resolve({
              avg: latencies.reduce((s, v) => s + v, 0) / latencies.length,
              p99: latencies[Math.floor(latencies.length * 0.99)],
            });
          }
        });
      };

      sendPing();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2: JSON Serialization overhead
// ═══════════════════════════════════════════════════════════════════════════════
function measureJsonSerialization(): { serializeUs: number; deserializeUs: number; totalUs: number } {
  const testData = {
    cmd: "PUSH",
    queue: "test-queue",
    data: {
      userId: 12345,
      action: "process",
      payload: { nested: { deep: { value: "test-string-data" } } },
      tags: ["tag1", "tag2", "tag3"],
      timestamp: Date.now(),
    },
    priority: 10,
    delay: 0,
    ttl: 60000,
    timeout: 30000,
    maxAttempts: 3,
  };

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    const json = JSON.stringify(testData);
    JSON.parse(json);
  }

  // Measure serialize
  const serializeStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    JSON.stringify(testData);
  }
  const serializeTime = ((performance.now() - serializeStart) * 1000) / ITERATIONS;

  // Measure deserialize
  const jsonStr = JSON.stringify(testData);
  const deserializeStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    JSON.parse(jsonStr);
  }
  const deserializeTime = ((performance.now() - deserializeStart) * 1000) / ITERATIONS;

  return {
    serializeUs: serializeTime,
    deserializeUs: deserializeTime,
    totalUs: serializeTime + deserializeTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3: Promise/Async overhead
// ═══════════════════════════════════════════════════════════════════════════════
async function measurePromiseOverhead(): Promise<{ syncUs: number; asyncUs: number; overheadUs: number }> {
  // Sync function
  const syncFn = () => {
    let x = 0;
    for (let i = 0; i < 10; i++) x += i;
    return x;
  };

  // Async equivalent
  const asyncFn = async () => {
    let x = 0;
    for (let i = 0; i < 10; i++) x += i;
    return x;
  };

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    syncFn();
    await asyncFn();
  }

  // Measure sync
  const syncStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    syncFn();
  }
  const syncTime = ((performance.now() - syncStart) * 1000) / ITERATIONS;

  // Measure async
  const asyncStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await asyncFn();
  }
  const asyncTime = ((performance.now() - asyncStart) * 1000) / ITERATIONS;

  return {
    syncUs: syncTime,
    asyncUs: asyncTime,
    overheadUs: asyncTime - syncTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 4: Full Client Roundtrip (PUSH + ACK)
// ═══════════════════════════════════════════════════════════════════════════════
async function measureFullRoundtrip(): Promise<{
  pushUs: number;
  pullUs: number;
  ackUs: number;
  totalUs: number;
}> {
  const client = new FlashQ({ port: 6789, timeout: 30000 });
  await client.connect();
  await client.obliterate("bench-roundtrip");

  const pushLatencies: number[] = [];
  const pullLatencies: number[] = [];
  const ackLatencies: number[] = [];

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    const job = await client.push("bench-roundtrip", { i });
    const pulled = await client.pull("bench-roundtrip");
    await client.ack(pulled.id);
  }

  // Measure
  for (let i = 0; i < ITERATIONS; i++) {
    const pushStart = performance.now();
    const job = await client.push("bench-roundtrip", { i });
    pushLatencies.push((performance.now() - pushStart) * 1000);

    const pullStart = performance.now();
    const pulled = await client.pull("bench-roundtrip");
    pullLatencies.push((performance.now() - pullStart) * 1000);

    const ackStart = performance.now();
    await client.ack(pulled.id);
    ackLatencies.push((performance.now() - ackStart) * 1000);
  }

  await client.obliterate("bench-roundtrip");
  await client.close();

  const avgPush = pushLatencies.reduce((s, v) => s + v, 0) / pushLatencies.length;
  const avgPull = pullLatencies.reduce((s, v) => s + v, 0) / pullLatencies.length;
  const avgAck = ackLatencies.reduce((s, v) => s + v, 0) / ackLatencies.length;

  return {
    pushUs: avgPush,
    pullUs: avgPull,
    ackUs: avgAck,
    totalUs: avgPush + avgPull + avgAck,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 5: Batch vs Single (amortized overhead)
// ═══════════════════════════════════════════════════════════════════════════════
async function measureBatchEfficiency(): Promise<{
  singlePushUs: number;
  batchPushUs: number;
  efficiency: number;
}> {
  const client = new FlashQ({ port: 6789, timeout: 30000 });
  await client.connect();

  const BATCH_SIZE = 100;
  const BATCH_ITERATIONS = ITERATIONS / BATCH_SIZE;

  await client.obliterate("bench-batch");

  // Single push
  const singleStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await client.push("bench-batch", { i });
  }
  const singleTime = ((performance.now() - singleStart) * 1000) / ITERATIONS;

  await client.obliterate("bench-batch");

  // Batch push
  const batchStart = performance.now();
  for (let i = 0; i < BATCH_ITERATIONS; i++) {
    const jobs = Array.from({ length: BATCH_SIZE }, (_, j) => ({
      data: { i: i * BATCH_SIZE + j },
    }));
    await client.pushBatch("bench-batch", jobs);
  }
  const batchTime = ((performance.now() - batchStart) * 1000) / ITERATIONS;

  await client.obliterate("bench-batch");
  await client.close();

  return {
    singlePushUs: singleTime,
    batchPushUs: batchTime,
    efficiency: singleTime / batchTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 6: MessagePack vs JSON
// ═══════════════════════════════════════════════════════════════════════════════
async function measureProtocolComparison(): Promise<{
  jsonUs: number;
  binaryUs: number;
  improvement: number;
}> {
  // JSON client
  const jsonClient = new FlashQ({ port: 6789, timeout: 30000, useBinary: false });
  await jsonClient.connect();
  await jsonClient.obliterate("bench-proto");

  const jsonStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await jsonClient.push("bench-proto", { i, data: "test-payload-string" });
  }
  const jsonTime = ((performance.now() - jsonStart) * 1000) / ITERATIONS;

  await jsonClient.obliterate("bench-proto");
  await jsonClient.close();

  // Binary client (MessagePack)
  const binaryClient = new FlashQ({ port: 6789, timeout: 30000, useBinary: true });
  await binaryClient.connect();
  await binaryClient.obliterate("bench-proto");

  const binaryStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await binaryClient.push("bench-proto", { i, data: "test-payload-string" });
  }
  const binaryTime = ((performance.now() - binaryStart) * 1000) / ITERATIONS;

  await binaryClient.obliterate("bench-proto");
  await binaryClient.close();

  return {
    jsonUs: jsonTime,
    binaryUs: binaryTime,
    improvement: ((jsonTime - binaryTime) / jsonTime) * 100,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
console.log("═".repeat(70));
console.log("🔬 BOTTLENECK ANALYSIS BENCHMARK");
console.log("═".repeat(70));
console.log(`Iterations: ${ITERATIONS.toLocaleString()} (+ ${WARMUP} warmup)`);
console.log("═".repeat(70));

// Run all tests
console.log("\n⏳ Running tests...\n");

console.log("1️⃣  Measuring raw TCP latency...");
const tcpResult = await measureRawTcpLatency();

console.log("2️⃣  Measuring JSON serialization...");
const jsonResult = measureJsonSerialization();

console.log("3️⃣  Measuring Promise/async overhead...");
const promiseResult = await measurePromiseOverhead();

console.log("4️⃣  Measuring full client roundtrip...");
const roundtripResult = await measureFullRoundtrip();

console.log("5️⃣  Measuring batch efficiency...");
const batchResult = await measureBatchEfficiency();

console.log("6️⃣  Measuring JSON vs MessagePack...");
const protoResult = await measureProtocolComparison();

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(70));
console.log("📊 BOTTLENECK ANALYSIS REPORT");
console.log("═".repeat(70));

console.log("\n┌─ RAW MEASUREMENTS ────────────────────────────────────────────────┐");
console.log(`│ TCP Roundtrip (STATS):     avg=${tcpResult.avg.toFixed(0).padStart(6)}µs  p99=${tcpResult.p99.toFixed(0).padStart(6)}µs     │`);
console.log(`│ JSON Serialize:            ${jsonResult.serializeUs.toFixed(2).padStart(6)}µs                             │`);
console.log(`│ JSON Deserialize:          ${jsonResult.deserializeUs.toFixed(2).padStart(6)}µs                             │`);
console.log(`│ JSON Total:                ${jsonResult.totalUs.toFixed(2).padStart(6)}µs                             │`);
console.log(`│ Promise/Async overhead:    ${promiseResult.overheadUs.toFixed(2).padStart(6)}µs                             │`);
console.log("└───────────────────────────────────────────────────────────────────┘");

console.log("\n┌─ CLIENT OPERATIONS ───────────────────────────────────────────────┐");
console.log(`│ PUSH (single):             ${roundtripResult.pushUs.toFixed(0).padStart(6)}µs                             │`);
console.log(`│ PULL (single):             ${roundtripResult.pullUs.toFixed(0).padStart(6)}µs                             │`);
console.log(`│ ACK  (single):             ${roundtripResult.ackUs.toFixed(0).padStart(6)}µs                             │`);
console.log(`│ Full cycle (push+pull+ack):${roundtripResult.totalUs.toFixed(0).padStart(6)}µs                             │`);
console.log("└───────────────────────────────────────────────────────────────────┘");

console.log("\n┌─ OPTIMIZATIONS ─────────────────────────────────────────────────────┐");
console.log(`│ Single PUSH:               ${batchResult.singlePushUs.toFixed(0).padStart(6)}µs                             │`);
console.log(`│ Batch PUSH (per job):      ${batchResult.batchPushUs.toFixed(0).padStart(6)}µs  (${batchResult.efficiency.toFixed(1)}x faster)           │`);
console.log(`│ JSON protocol:             ${protoResult.jsonUs.toFixed(0).padStart(6)}µs                             │`);
console.log(`│ Binary protocol:           ${protoResult.binaryUs.toFixed(0).padStart(6)}µs  (${protoResult.improvement.toFixed(1)}% faster)          │`);
console.log("└───────────────────────────────────────────────────────────────────┘");

// Breakdown analysis
const totalClientOp = roundtripResult.pushUs;
const tcpPortion = tcpResult.avg;
const jsonPortion = jsonResult.totalUs;
const promisePortion = promiseResult.overheadUs;
const serverPortion = totalClientOp - tcpPortion - jsonPortion - promisePortion;

console.log("\n┌─ PUSH LATENCY BREAKDOWN ──────────────────────────────────────────┐");
console.log(`│                                                                   │`);
console.log(`│  Total PUSH latency: ${totalClientOp.toFixed(0)}µs                                      │`);
console.log(`│                                                                   │`);
const tcpPct = (tcpPortion / totalClientOp * 100).toFixed(1);
const jsonPct = (jsonPortion / totalClientOp * 100).toFixed(1);
const promisePct = (promisePortion / totalClientOp * 100).toFixed(1);
const serverPct = (serverPortion / totalClientOp * 100).toFixed(1);

const bar = (pct: number, char: string) => char.repeat(Math.max(1, Math.round(pct / 2)));

console.log(`│  TCP Network:    ${bar(parseFloat(tcpPct), "█").padEnd(30)} ${tcpPct.padStart(5)}% (${tcpPortion.toFixed(0)}µs)  │`);
console.log(`│  Serialization:  ${bar(parseFloat(jsonPct), "▓").padEnd(30)} ${jsonPct.padStart(5)}% (${jsonPortion.toFixed(1)}µs)  │`);
console.log(`│  Async/Promise:  ${bar(parseFloat(promisePct), "░").padEnd(30)} ${promisePct.padStart(5)}% (${promisePortion.toFixed(1)}µs)  │`);
console.log(`│  Server process: ${bar(Math.max(0, parseFloat(serverPct)), "▒").padEnd(30)} ${serverPct.padStart(5)}% (${Math.max(0, serverPortion).toFixed(0)}µs)  │`);
console.log(`│                                                                   │`);
console.log("└───────────────────────────────────────────────────────────────────┘");

// Conclusions
console.log("\n┌─ CONCLUSIONS ─────────────────────────────────────────────────────┐");

const bottlenecks = [
  { name: "TCP Network", pct: parseFloat(tcpPct), us: tcpPortion },
  { name: "Serialization", pct: parseFloat(jsonPct), us: jsonPortion },
  { name: "Server processing", pct: Math.max(0, parseFloat(serverPct)), us: Math.max(0, serverPortion) },
].sort((a, b) => b.pct - a.pct);

console.log(`│                                                                   │`);
console.log(`│  🎯 PRIMARY BOTTLENECK: ${bottlenecks[0].name.padEnd(20)} (${bottlenecks[0].pct.toFixed(1)}%)            │`);
console.log(`│                                                                   │`);

if (bottlenecks[0].name === "TCP Network") {
  console.log(`│  Recommendations:                                                 │`);
  console.log(`│  • Use batch operations (${batchResult.efficiency.toFixed(1)}x improvement)                        │`);
  console.log(`│  • Use connection pooling                                         │`);
  console.log(`│  • Consider Unix sockets for local deployment                     │`);
} else if (bottlenecks[0].name === "Serialization") {
  console.log(`│  Recommendations:                                                 │`);
  console.log(`│  • Use MessagePack binary protocol (${protoResult.improvement.toFixed(0)}% faster)                  │`);
  console.log(`│  • Minimize payload size                                          │`);
  console.log(`│  • Use batch operations to amortize overhead                      │`);
} else {
  console.log(`│  Recommendations:                                                 │`);
  console.log(`│  • Server is already optimized                                    │`);
  console.log(`│  • Focus on client-side optimizations                             │`);
}

console.log(`│                                                                   │`);
console.log("└───────────────────────────────────────────────────────────────────┘");

// Theoretical max throughput
const theoreticalMaxSingle = 1_000_000 / roundtripResult.pushUs;
const theoreticalMaxBatch = 1_000_000 / batchResult.batchPushUs;

console.log("\n┌─ THEORETICAL MAX THROUGHPUT ─────────────────────────────────────┐");
console.log(`│ Single ops:  ${theoreticalMaxSingle.toLocaleString().padStart(10)} jobs/sec (1 connection)            │`);
console.log(`│ Batch ops:   ${theoreticalMaxBatch.toLocaleString().padStart(10)} jobs/sec (1 connection)            │`);
console.log(`│ 16 connections batch: ~${(theoreticalMaxBatch * 16).toLocaleString().padStart(7)} jobs/sec                   │`);
console.log("└───────────────────────────────────────────────────────────────────┘");

console.log("\n" + "═".repeat(70));
process.exit(0);
