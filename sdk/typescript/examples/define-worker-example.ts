/**
 * defineWorker Example - Zero Config Worker
 *
 * Run: bun run examples/define-worker-example.ts
 *
 * This example shows the simplest way to create a flashQ worker.
 * Just define your handler and run the file - that's it!
 */

import { defineWorker, defineWorkers, FlashQ } from '../src';

// ============================================================
// Example 1: Single Worker (Simplest)
// ============================================================

// This is all you need! Auto-starts, auto-shutdown on SIGTERM
const emailWorker = defineWorker('demo-emails', async (job, ctx) => {
  // Rich context with logging
  ctx.log(`Processing email to ${(job.data as { to: string }).to}`);

  // Progress updates
  ctx.progress(25, 'Validating email...');
  await sleep(100);

  ctx.progress(50, 'Connecting to SMTP...');
  await sleep(100);

  ctx.progress(75, 'Sending...');
  await sleep(100);

  // Check if job was cancelled/timed out
  if (ctx.signal.aborted) {
    throw new Error('Job was cancelled');
  }

  ctx.progress(100, 'Sent!');
  ctx.log('Email sent successfully');

  // Return result (will be stored)
  return {
    messageId: `msg-${Date.now()}`,
    sentAt: Date.now(),
  };
}, {
  autoStart: false, // Don't auto-start for this example
  concurrency: 2,
});

// ============================================================
// Example 2: Multiple Workers in One File
// ============================================================

const workers = defineWorkers({
  // Simple handler
  'demo-notifications': async (job, ctx) => {
    ctx.log('Sending notification...');
    await sleep(50);
    return { sent: true };
  },

  // Handler with options
  'demo-reports': {
    handler: async (job, ctx) => {
      const data = job.data as { type: string };
      ctx.log(`Generating ${data.type} report...`);

      for (let i = 0; i <= 100; i += 20) {
        ctx.progress(i, `Processing... ${i}%`);
        await sleep(50);
      }

      return { reportUrl: 'https://example.com/report.pdf' };
    },
    concurrency: 3,
  },
}, {
  autoStart: false, // Don't auto-start for this example
  connection: { host: 'localhost', port: 6789 },
});

// ============================================================
// Example 3: With Hooks
// ============================================================

const workerWithHooks = defineWorker('demo-tasks', async (job, ctx) => {
  ctx.log('Processing task...');
  await sleep(100);
  return { done: true };
}, {
  autoStart: false,

  beforeJob: async (job, ctx) => {
    console.log(`[Hook] Starting job ${job.id}`);
  },

  afterJob: async (job, ctx, result, error) => {
    if (error) {
      console.log(`[Hook] Job ${job.id} failed:`, error.message);
    } else {
      console.log(`[Hook] Job ${job.id} completed:`, result);
    }
  },
});

// ============================================================
// Demo Runner
// ============================================================

async function runDemo() {
  console.log('='.repeat(60));
  console.log('defineWorker Demo');
  console.log('='.repeat(60));

  // Start workers
  console.log('\n[Demo] Starting workers...');
  await emailWorker.start();
  await Promise.all(workers.map(w => w.start()));
  await workerWithHooks.start();

  // Create a client to push jobs
  const client = new FlashQ({ host: 'localhost', port: 6789 });
  await client.connect();

  // Push some jobs
  console.log('\n[Demo] Pushing jobs...');

  await client.push('demo-emails', { to: 'user1@example.com' });
  await client.push('demo-emails', { to: 'user2@example.com' });
  await client.push('demo-notifications', { message: 'Hello!' });
  await client.push('demo-reports', { type: 'monthly' });
  await client.push('demo-tasks', { action: 'cleanup' });

  console.log('[Demo] Pushed 5 jobs');

  // Wait for processing
  console.log('\n[Demo] Waiting for jobs to complete...');
  await sleep(3000);

  // Show stats
  console.log('\n[Demo] Stats:');
  console.log(`  - Email worker: ${emailWorker.processed} processed`);
  console.log(`  - Task worker: ${workerWithHooks.processed} processed`);

  // Cleanup
  console.log('\n[Demo] Stopping workers...');
  await emailWorker.stop();
  await Promise.all(workers.map(w => w.stop()));
  await workerWithHooks.stop();
  await client.close();

  console.log('\n[Demo] Done!');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run demo
runDemo().catch(console.error);
