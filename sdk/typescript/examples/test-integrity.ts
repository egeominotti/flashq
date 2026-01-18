/**
 * Data Integrity Test
 * Verifies that input data matches what the worker receives and what's stored
 */

import { FlashQ, Worker } from "../src";

async function main() {
  const client = new FlashQ({ host: "localhost", port: 6789, httpPort: 6790 });
  await client.connect();

  const queue = `integrity-test-${Date.now()}`;
  const testData = {
    orderId: "ORD-12345",
    customer: { name: "John Doe", email: "john@example.com" },
    items: [
      { sku: "SKU-001", qty: 2, price: 29.99 },
      { sku: "SKU-002", qty: 1, price: 49.99 }
    ],
    metadata: { source: "web", timestamp: Date.now() }
  };

  console.log("=== DATA INTEGRITY TEST ===\n");
  console.log("INPUT DATA:", JSON.stringify(testData, null, 2));

  // Push job
  const job = await client.push(queue, testData);
  console.log("\nJob pushed with ID:", job.id);

  // Create worker and verify data
  let receivedData: any = null;
  let workerResult: any = null;
  let workerCompleted = false;

  const worker = new Worker(queue, async (job) => {
    receivedData = job.data;
    console.log("\n✓ WORKER RECEIVED DATA:", JSON.stringify(job.data, null, 2));
    return { processed: true, jobId: job.id };
  }, {
    host: "localhost",
    port: 6789,
    httpPort: 6790,
    concurrency: 1,
    batchSize: 1
  });

  worker.on("completed", (job, result) => {
    workerResult = result;
    console.log("\n✓ JOB COMPLETED EVENT FIRED");
    console.log("  Result:", JSON.stringify(result));
    workerCompleted = true;
  });

  await worker.start();

  // Wait for completion
  const timeout = Date.now() + 5000;
  while (!workerCompleted && Date.now() < timeout) {
    await new Promise(r => setTimeout(r, 50));
  }

  await worker.stop();

  // Verify data integrity (deep comparison, not string comparison)
  console.log("\n=== VERIFICATION ===");

  function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }

  if (deepEqual(testData, receivedData)) {
    console.log("✅ DATA INTEGRITY: PASSED");
    console.log("   All values match exactly:");
    console.log("   - orderId:", receivedData.orderId === testData.orderId ? "✓" : "✗");
    console.log("   - customer.name:", receivedData.customer?.name === testData.customer.name ? "✓" : "✗");
    console.log("   - customer.email:", receivedData.customer?.email === testData.customer.email ? "✓" : "✗");
    console.log("   - items[0].sku:", receivedData.items?.[0]?.sku === testData.items[0].sku ? "✓" : "✗");
    console.log("   - items[0].qty:", receivedData.items?.[0]?.qty === testData.items[0].qty ? "✓" : "✗");
    console.log("   - items[0].price:", receivedData.items?.[0]?.price === testData.items[0].price ? "✓" : "✗");
    console.log("   - metadata.source:", receivedData.metadata?.source === testData.metadata.source ? "✓" : "✗");
    console.log("   - metadata.timestamp:", receivedData.metadata?.timestamp === testData.metadata.timestamp ? "✓" : "✗");
  } else {
    console.log("❌ DATA INTEGRITY: FAILED");
    console.log("   Some values don't match");
  }

  // Verify job state in server
  const jobState = await client.getJob(job.id);
  console.log("\n=== SERVER STATE ===");
  console.log("Job state:", jobState?.state);
  console.log("Job result:", JSON.stringify(jobState?.result));

  // Verify result matches what worker returned
  if (workerResult && jobState?.result) {
    const resultMatch = JSON.stringify(workerResult) === JSON.stringify(jobState.result);
    console.log("\n=== RESULT VERIFICATION ===");
    if (resultMatch) {
      console.log("✅ RESULT INTEGRITY: PASSED");
      console.log("   Worker result matches server stored result");
    } else {
      console.log("❌ RESULT INTEGRITY: FAILED");
      console.log("   Worker result:", JSON.stringify(workerResult));
      console.log("   Server result:", JSON.stringify(jobState.result));
    }
  }

  await client.obliterate(queue);
  await client.close();

  console.log("\n✅ Test completed");
}

main().catch(console.error);
