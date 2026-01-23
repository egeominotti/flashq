/**
 * flashQ - High-performance Job Queue (BullMQ-compatible)
 *
 * @example
 * ```typescript
 * import { Queue, Worker } from 'flashq';
 *
 * // Add jobs
 * const queue = new Queue('emails');
 * await queue.add('send', { to: 'user@example.com' });
 *
 * // Process jobs (auto-starts)
 * const worker = new Worker('emails', async (job) => {
 *   await sendEmail(job.data);
 *   return { sent: true };
 * });
 * ```
 *
 * @packageDocumentation
 */

// BullMQ-compatible API
export { Queue } from './queue';
export type { QueueOptions, JobOptions } from './queue';

export { Worker } from './worker';
export type { BullMQWorkerOptions } from './worker';

// Low-level API
export { FlashQ, FlashQ as default } from './client';

// Constants and validation utilities
export { MAX_BATCH_SIZE, MAX_JOB_DATA_SIZE } from './client/methods/core';
export { validateQueueName, validateJobDataSize } from './client/connection';

// Optional: Real-time events
export { EventSubscriber } from './events';

// Errors
export {
  FlashQError,
  ConnectionError,
  AuthenticationError,
  TimeoutError,
  ValidationError,
  ServerError,
  JobNotFoundError,
  QueueNotFoundError,
  DuplicateJobError,
  QueuePausedError,
  RateLimitError,
  ConcurrencyLimitError,
  BatchError,
  Errors,
} from './errors';

// Retry utilities
export { withRetry, retryable, isRetryable, RetryPresets } from './utils/retry';
export type { RetryOptions } from './utils/retry';

// Logger utilities
export { Logger, createLogger, getLogger, setGlobalLogger } from './utils/logger';
export type { LogLevel, LoggerOptions, LogEntry, LogHandler } from './utils/logger';

// Hooks for observability (OpenTelemetry, etc.)
export { callHook, callErrorHook, createHookContext, getDuration } from './hooks';
export type {
  ClientHooks,
  WorkerHooks,
  HookContext,
  PushHookContext,
  PullHookContext,
  AckHookContext,
  FailHookContext,
  ProcessHookContext,
  BatchPushHookContext,
  BatchPullHookContext,
  ConnectionHookContext,
} from './hooks';

// Types
export type {
  Job,
  JobState,
  PushOptions,
  WorkerOptions,
  ClientOptions,
  RetryConfig,
  BatchPushResult,
} from './types';
