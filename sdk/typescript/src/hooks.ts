/**
 * Hooks system for observability (OpenTelemetry, DataDog, custom metrics)
 *
 * @example
 * ```typescript
 * import { trace } from '@opentelemetry/api';
 *
 * const client = new FlashQ({
 *   hooks: {
 *     onPush: (ctx) => {
 *       ctx.span = trace.getTracer('flashq').startSpan('flashq.push', {
 *         attributes: { queue: ctx.queue, priority: ctx.options?.priority }
 *       });
 *     },
 *     onPushComplete: (ctx) => ctx.span?.end(),
 *     onPushError: (ctx, error) => {
 *       ctx.span?.recordException(error);
 *       ctx.span?.end();
 *     },
 *   }
 * });
 * ```
 */

import type { Job, PushOptions } from './types';

/** Context passed to hooks - can store custom data like spans */
export interface HookContext {
  /** Operation start time */
  startTime: number;
  /** Request ID for correlation */
  requestId?: string;
  /** Custom data storage (e.g., OpenTelemetry span) */
  [key: string]: unknown;
}

/** Push operation context */
export interface PushHookContext extends HookContext {
  queue: string;
  data: unknown;
  options?: PushOptions;
  /** Set after push completes */
  job?: Job;
}

/** Pull operation context */
export interface PullHookContext extends HookContext {
  queue: string;
  timeout?: number;
  /** Set after pull completes */
  job?: Job | null;
}

/** Ack operation context */
export interface AckHookContext extends HookContext {
  jobId: number;
  result?: unknown;
}

/** Fail operation context */
export interface FailHookContext extends HookContext {
  jobId: number;
  error?: string;
}

/** Process operation context (Worker) */
export interface ProcessHookContext extends HookContext {
  job: Job;
  workerId: number;
  /** Set after processing completes */
  result?: unknown;
  /** Set if processing fails */
  error?: Error;
}

/** Batch push context */
export interface BatchPushHookContext extends HookContext {
  queue: string;
  count: number;
  /** Set after batch completes */
  ids?: number[];
  failedCount?: number;
}

/** Batch pull context */
export interface BatchPullHookContext extends HookContext {
  queue: string;
  count: number;
  timeout?: number;
  /** Set after batch completes */
  jobs?: Job[];
}

/** Connection event context */
export interface ConnectionHookContext extends HookContext {
  host: string;
  port: number;
  event: 'connect' | 'disconnect' | 'reconnecting' | 'reconnected' | 'error';
  error?: Error;
  attempt?: number;
}

/**
 * Hook definitions for FlashQ client
 */
export interface ClientHooks {
  // === Push Hooks ===
  /** Called before pushing a job */
  onPush?: Hook<PushHookContext>;
  /** Called after push completes successfully */
  onPushComplete?: Hook<PushHookContext>;
  /** Called if push fails */
  onPushError?: ErrorHook<PushHookContext>;

  // === Pull Hooks ===
  /** Called before pulling a job */
  onPull?: Hook<PullHookContext>;
  /** Called after pull completes (job may be null on timeout) */
  onPullComplete?: Hook<PullHookContext>;
  /** Called if pull fails */
  onPullError?: ErrorHook<PullHookContext>;

  // === Ack Hooks ===
  /** Called before acknowledging a job */
  onAck?: Hook<AckHookContext>;
  /** Called after ack completes */
  onAckComplete?: Hook<AckHookContext>;
  /** Called if ack fails */
  onAckError?: ErrorHook<AckHookContext>;

  // === Fail Hooks ===
  /** Called before failing a job */
  onFail?: Hook<FailHookContext>;
  /** Called after fail completes */
  onFailComplete?: Hook<FailHookContext>;
  /** Called if fail operation errors */
  onFailError?: ErrorHook<FailHookContext>;

  // === Batch Hooks ===
  /** Called before batch push */
  onBatchPush?: Hook<BatchPushHookContext>;
  /** Called after batch push completes */
  onBatchPushComplete?: Hook<BatchPushHookContext>;
  /** Called if batch push fails */
  onBatchPushError?: ErrorHook<BatchPushHookContext>;

  /** Called before batch pull */
  onBatchPull?: Hook<BatchPullHookContext>;
  /** Called after batch pull completes */
  onBatchPullComplete?: Hook<BatchPullHookContext>;
  /** Called if batch pull fails */
  onBatchPullError?: ErrorHook<BatchPullHookContext>;

  // === Connection Hooks ===
  /** Called on connection events */
  onConnection?: Hook<ConnectionHookContext>;
}

/**
 * Hook definitions for FlashQ worker
 */
export interface WorkerHooks {
  /** Called before processing a job */
  onProcess?: Hook<ProcessHookContext>;
  /** Called after job processed successfully */
  onProcessComplete?: Hook<ProcessHookContext>;
  /** Called if job processing fails */
  onProcessError?: ErrorHook<ProcessHookContext>;
}

/** Error hook type */
export type ErrorHook<T extends HookContext> = (ctx: T, error: Error) => void | Promise<void>;

/** Standard hook type */
export type Hook<T extends HookContext> = (ctx: T) => void | Promise<void>;

/**
 * Helper to safely call a hook
 */
export async function callHook<T extends HookContext>(
  hook: Hook<T> | undefined,
  ctx: T
): Promise<void> {
  if (!hook) return;
  try {
    await hook(ctx);
  } catch (e) {
    // Hooks should not break the main flow
    console.error('[flashQ] Hook error:', e);
  }
}

/**
 * Helper to safely call an error hook
 */
export async function callErrorHook<T extends HookContext>(
  hook: ErrorHook<T> | undefined,
  ctx: T,
  error: Error
): Promise<void> {
  if (!hook) return;
  try {
    await hook(ctx, error);
  } catch (e) {
    // Hooks should not break the main flow
    console.error('[flashQ] Hook error:', e);
  }
}

/**
 * Create a new hook context with start time
 */
export function createHookContext<T extends HookContext>(data: Omit<T, 'startTime'>): T {
  return {
    startTime: Date.now(),
    ...data,
  } as T;
}

/**
 * Calculate duration from context start time
 */
export function getDuration(ctx: HookContext): number {
  return Date.now() - ctx.startTime;
}
