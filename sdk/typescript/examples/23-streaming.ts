/**
 * Example 23: Live Job Streaming
 *
 * Demonstrates streaming partial results from jobs in real-time.
 * Use case: LLM token streaming, chunked file processing, progress data.
 *
 * Run: bun run examples/23-streaming.ts
 */

import { FlashQ, Worker } from '../src';

async function main() {
  const client = new FlashQ();
  await client.connect();

  console.log('=== Live Job Streaming Example ===\n');

  // Worker uses its own connection internally
  // We need a separate client for partial() calls
  const workerClient = new FlashQ();
  await workerClient.connect();

  // Simulate LLM token streaming worker
  const worker = new Worker<{ prompt: string }>(
    'llm',
    async (job) => {
      const prompt = job.data.prompt;
      console.log(`[Worker] Processing prompt: "${prompt}"`);

      // Simulate token-by-token generation
      const tokens = ['Hello', ',', ' I', ' am', ' an', ' AI', ' assistant', '.'];

      for (let i = 0; i < tokens.length; i++) {
        // Send partial result (token) using worker's client
        await workerClient.partial(job.id, { token: tokens[i] }, i);
        console.log(`[Worker] Sent token ${i}: "${tokens[i]}"`);

        // Simulate generation delay
        await new Promise((r) => setTimeout(r, 100));
      }

      return { complete: true, totalTokens: tokens.length };
    },
    { concurrency: 1 }
  );

  // Subscribe to job events (in real app, use SSE: GET /events/job/{id})
  worker.on('completed', (job, result) => {
    console.log(`\n[Event] Job ${job.id} completed:`, result);
  });

  // Push a job
  const job = await client.push('llm', { prompt: 'Say hello' });
  console.log(`[Client] Pushed job ${job.id}`);
  console.log('[Client] Streaming tokens...\n');

  // Wait for completion
  await new Promise((r) => setTimeout(r, 2000));

  // Get final result
  const result = await client.getResult(job.id);
  console.log('\n[Client] Final result:', result);

  // Cleanup
  await worker.close();
  await workerClient.close();
  await client.close();

  console.log('\n=== Streaming Complete ===');
  console.log('\nTo consume streaming events, use SSE:');
  console.log('  curl -N http://localhost:6790/events/job/{id}?events=partial');
}

main().catch(console.error);
