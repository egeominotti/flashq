/**
 * AI Agent Workflow Example
 *
 * Demonstrates how to use flashQ for AI/ML workloads:
 * - Job dependencies for multi-step agent workflows
 * - Rate limiting for API cost control
 * - Progress tracking for long-running jobs
 * - Large payloads (embeddings, context)
 *
 * Run: bun run examples/16-ai-workflow.ts
 */

import { Worker, FlashQ } from '../src';

const QUEUE_NAME = 'ai-workflow';

// Simulated AI functions
async function parseIntent(_prompt: string): Promise<{ intent: string; entities: string[] }> {
  await new Promise(r => setTimeout(r, 100)); // Simulate API latency
  return {
    intent: 'search_and_answer',
    entities: ['flashQ', 'job queue', 'AI']
  };
}

async function retrieveContext(_query: string): Promise<string[]> {
  await new Promise(r => setTimeout(r, 150)); // Simulate vector DB lookup
  return [
    'flashQ is a high-performance job queue built with Rust.',
    'It supports job dependencies for workflow orchestration.',
    'Rate limiting helps control API costs for LLM calls.'
  ];
}

async function generateResponse(context: string[], intent: string): Promise<string> {
  await new Promise(r => setTimeout(r, 200)); // Simulate LLM call
  return `Based on the context about ${intent}: ${context.join(' ')}`;
}

async function main() {
  const client = new FlashQ();
  await client.connect();

  // Clean up from previous runs
  await client.obliterate(QUEUE_NAME);

  // Set rate limit to control API costs (e.g., OpenAI rate limits)
  await client.setRateLimit(QUEUE_NAME, 10); // 10 jobs/sec

  console.log('=== AI Agent Workflow Example ===\n');

  // Create worker that handles all steps
  const worker = new Worker(QUEUE_NAME, async (job) => {
    const { step, ...data } = job.data as { step: string; [key: string]: unknown };

    switch (step) {
      case 'parse':
        console.log(`[Job ${job.id}] Parsing intent...`);
        return await parseIntent(data.prompt as string);

      case 'retrieve':
        console.log(`[Job ${job.id}] Retrieving context...`);
        return await retrieveContext(data.query as string);

      case 'generate':
        console.log(`[Job ${job.id}] Generating response...`);
        return await generateResponse(
          data.context as string[],
          data.intent as string
        );

      default:
        throw new Error(`Unknown step: ${step}`);
    }
  }, { concurrency: 5 });

  worker.on('completed', (job, result) => {
    console.log(`[Job ${job.id}] Completed: ${JSON.stringify(result).slice(0, 100)}...`);
  });

  worker.on('failed', (job, error) => {
    console.error(`[Job ${job.id}] Failed: ${error}`);
  });

  // Start the workflow
  const userPrompt = 'Tell me about flashQ and how it helps with AI workloads';
  console.log(`User: "${userPrompt}"\n`);

  // Step 1: Parse user intent
  const parseJob = await client.push(QUEUE_NAME, {
    step: 'parse',
    prompt: userPrompt
  });
  console.log(`Created parse job: ${parseJob.id}`);

  // Wait for parse to complete
  const parseResult = await client.finished<{ intent: string; entities: string[] }>(parseJob.id, 10000);
  console.log(`Parse result: ${JSON.stringify(parseResult)}\n`);

  // Step 2: Retrieve context (depends on parse)
  const retrieveJob = await client.push(QUEUE_NAME, {
    step: 'retrieve',
    query: parseResult?.entities.join(' ') || userPrompt
  }, {
    depends_on: [parseJob.id]
  });
  console.log(`Created retrieve job: ${retrieveJob.id} (depends on ${parseJob.id})`);

  // Wait for retrieve to complete
  const retrieveResult = await client.finished<string[]>(retrieveJob.id, 10000);
  console.log(`Retrieve result: ${retrieveResult?.length} chunks\n`);

  // Step 3: Generate response (depends on retrieve)
  const generateJob = await client.push(QUEUE_NAME, {
    step: 'generate',
    context: retrieveResult,
    intent: parseResult?.intent
  }, {
    depends_on: [retrieveJob.id],
    priority: 10 // High priority for final generation
  });
  console.log(`Created generate job: ${generateJob.id} (depends on ${retrieveJob.id})`);

  // Wait for final result
  const finalResult = await client.finished<string>(generateJob.id, 10000);
  console.log(`\n=== Final Response ===`);
  console.log(finalResult);

  // Cleanup
  await worker.close();
  await client.obliterate(QUEUE_NAME);
  await client.close();

  console.log('\n=== Workflow Complete ===');
}

main().catch(console.error);
