/**
 * Batch Inference Example
 *
 * Demonstrates high-throughput AI inference:
 * - Bulk job submission for batch processing
 * - Concurrency control for GPU utilization
 * - Progress tracking for long batches
 * - Large payload support (embeddings)
 *
 * Run: bun run examples/17-batch-inference.ts
 */

import { Worker, FlashQ } from '../src';

const QUEUE_NAME = 'batch-inference';
const BATCH_SIZE = 100;
const CONCURRENCY = 10; // Simulate GPU parallelism

// Simulated embedding function (would be OpenAI, HuggingFace, etc.)
async function generateEmbedding(_text: string): Promise<number[]> {
  await new Promise(r => setTimeout(r, 10)); // Simulate inference time
  // Return fake 1536-dim embedding (OpenAI ada-002 size)
  return Array(1536).fill(0).map(() => Math.random() * 2 - 1);
}

async function main() {
  const client = new FlashQ();
  await client.connect();

  // Clean up
  await client.obliterate(QUEUE_NAME);

  // Set concurrency limit (simulates GPU batch size)
  await client.setConcurrency(QUEUE_NAME, CONCURRENCY);

  console.log('=== Batch Inference Example ===\n');
  console.log(`Batch size: ${BATCH_SIZE} documents`);
  console.log(`Concurrency: ${CONCURRENCY} parallel jobs\n`);

  // Track results
  const results: Map<number, number[]> = new Map();
  let completed = 0;

  // Create worker
  const worker = new Worker(QUEUE_NAME, async (job) => {
    const { text, index } = job.data as { text: string; index: number };

    // Generate embedding
    const embedding = await generateEmbedding(text);

    // Update progress
    await client.progress(job.id, Math.floor((index / BATCH_SIZE) * 100), `Processing ${index}/${BATCH_SIZE}`);

    return { index, embedding };
  }, { concurrency: CONCURRENCY });

  worker.on('completed', (job, result) => {
    const { index, embedding } = result as { index: number; embedding: number[] };
    results.set(index, embedding);
    completed++;

    if (completed % 10 === 0) {
      console.log(`Progress: ${completed}/${BATCH_SIZE} (${Math.floor(completed/BATCH_SIZE*100)}%)`);
    }
  });

  worker.on('failed', (_job, error) => {
    console.error(`Job failed: ${error}`);
  });

  // Generate sample documents
  const documents = Array(BATCH_SIZE).fill(null).map((_, i) => ({
    text: `Document ${i}: This is sample text for embedding generation. It contains information about topic ${i % 10}.`,
    index: i
  }));

  console.log('Submitting batch...');
  const startTime = Date.now();

  // Submit all jobs in batch
  const jobIds = await client.pushBatch(QUEUE_NAME, documents.map(doc => ({
    data: doc,
    priority: doc.index % 10 // Vary priority
  })));

  console.log(`Submitted ${jobIds.length} jobs in ${Date.now() - startTime}ms\n`);

  // Wait for all jobs to complete
  console.log('Processing...');
  await Promise.all(jobIds.map(id => client.finished(id, 60000)));

  const totalTime = Date.now() - startTime;
  const throughput = (BATCH_SIZE / (totalTime / 1000)).toFixed(1);

  console.log(`\n=== Results ===`);
  console.log(`Total time: ${totalTime}ms`);
  console.log(`Throughput: ${throughput} embeddings/sec`);
  console.log(`Results collected: ${results.size}`);
  console.log(`Sample embedding dims: ${results.get(0)?.length}`);

  // Verify all results
  let valid = true;
  for (let i = 0; i < BATCH_SIZE; i++) {
    if (!results.has(i)) {
      console.error(`Missing result for index ${i}`);
      valid = false;
    }
  }
  console.log(`All results valid: ${valid ? 'YES' : 'NO'}`);

  // Cleanup
  await worker.close();
  await client.obliterate(QUEUE_NAME);
  await client.close();

  console.log('\n=== Batch Complete ===');
}

main().catch(console.error);
