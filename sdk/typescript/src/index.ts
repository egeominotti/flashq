/**
 * flashQ - High-performance Job Queue
 *
 * @example
 * ```typescript
 * import { FlashQ, Worker } from 'flashq';
 *
 * // Add a job
 * const client = new FlashQ();
 * await client.add('emails', { to: 'user@example.com' });
 *
 * // Process jobs
 * const worker = new Worker('emails', async (job) => {
 *   await sendEmail(job.data);
 *   return { sent: true };
 * });
 * await worker.start();
 * ```
 *
 * @packageDocumentation
 */

// Main exports
export { FlashQ, FlashQ as default } from './client';
export { Worker } from './worker';

// Optional: Real-time events
export { EventSubscriber } from './events';

// Types
export type {
  Job,
  JobState,
  PushOptions,
  WorkerOptions,
  ClientOptions,
} from './types';
