import { FlashQ } from "./src";

const client = new FlashQ({ host: "localhost", port: 6789, httpPort: 6790, useHttp: false });

async function main() {
  await client.connect();
  console.log("Connected to flashQ (TCP mode)");

  const queue = "test-100-jobs";

  // Push 100 jobs
  console.log("\n📤 Pushing 100 jobs...");
  const pushStart = Date.now();

  for (let i = 0; i < 100; i++) {
    await client.push(queue, { task: `job-${i}`, value: Math.random() });
  }
  const pushTime = Date.now() - pushStart;
  console.log(`✅ Pushed 100 jobs in ${pushTime}ms (${Math.round(100000/pushTime)} jobs/sec)`);

  // Check stats after push
  let stats = await client.stats();
  console.log(`   Queue depth: ${stats.queued}`);

  // Process all jobs
  console.log("\n⚙️  Processing jobs...");
  const processStart = Date.now();
  let processed = 0;
  let errors = 0;

  while (processed < 100 && errors < 5) {
    try {
      const job = await client.pull(queue);
      if (job) {
        await client.ack(job.id);
        processed++;
        if (processed % 25 === 0) {
          console.log(`   Processed ${processed}/100`);
        }
      }
    } catch (e) {
      errors++;
      console.log(`   Error: ${e}`);
    }
  }

  const processTime = Date.now() - processStart;
  console.log(`✅ Processed ${processed} jobs in ${processTime}ms (${Math.round(processed * 1000 / processTime)} jobs/sec)`);

  // Final stats
  stats = await client.stats();
  console.log("\n📈 Final Stats:", JSON.stringify(stats, null, 2));

  await client.close();
}

main().catch(console.error);
