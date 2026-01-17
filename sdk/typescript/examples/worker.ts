/**
 * Minimal Worker Example
 *
 * This is the simplest possible worker - just run this file!
 *
 * Run: bun run examples/worker.ts
 */

import { defineWorker } from '../src';

// That's it! One line to define a worker.
// Auto-starts, auto-handles SIGTERM/SIGINT, auto-heartbeat
export default defineWorker('emails', async (ctx) => {
  // ctx.payload = job data (direct access)
  const { to, subject } = ctx.payload as { to: string; subject: string };

  // Structured logging
  ctx.log('info', 'Sending email', { to, subject });

  // Progress updates
  ctx.progress(50, 'Connecting to SMTP...');

  // Simulated work
  await new Promise(r => setTimeout(r, 100));

  // Non-retryable errors (validation)
  if (!to.includes('@')) {
    throw new ctx.NonRetryableError('Invalid email address');
  }

  ctx.progress(100, 'Sent!');
  return { messageId: `msg-${Date.now()}` };
});
