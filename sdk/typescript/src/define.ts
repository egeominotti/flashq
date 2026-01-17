/**
 * defineWorker - Zero-config worker definition
 *
 * The simplest way to create a flashQ worker.
 * Inspired by Spooled SDK's elegant API.
 *
 * @example
 * ```typescript
 * // worker.ts - That's it!
 * import { defineWorker } from 'flashq';
 *
 * export default defineWorker('emails', async (ctx) => {
 *   ctx.log('info', 'Sending email', { to: ctx.payload.to });
 *   ctx.progress(50, 'Connecting...');
 *   await sendEmail(ctx.payload);
 *   return { sent: true };
 * });
 * ```
 */

import { EventEmitter } from 'events';
import { FlashQ } from './client';
import type { Job, ClientOptions } from './types';

// ============== Error Classes ==============

/**
 * Error that should not be retried
 *
 * @example
 * ```typescript
 * if (!isValidEmail(ctx.payload.to)) {
 *   throw new NonRetryableError('Invalid email format');
 * }
 * ```
 */
export class NonRetryableError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * Error that should be retried with optional delay
 *
 * @example
 * ```typescript
 * if (rateLimited) {
 *   throw new RetryableError('Rate limited', 5000);
 * }
 * ```
 */
export class RetryableError extends Error {
  readonly retryable = true;

  constructor(
    message: string,
    readonly retryDelay?: number
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

// ============== Types ==============

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Job context with helpers for logging, progress, and control
 */
export interface JobContext<TPayload = unknown> {
  /** Job ID */
  readonly jobId: number;

  /** Job payload (data) - direct access */
  readonly payload: TPayload;

  /** Queue name */
  readonly queueName: string;

  /** Current retry count (0-indexed) */
  readonly retryCount: number;

  /** Maximum retry attempts */
  readonly maxRetries: number;

  /** Abort signal - triggered on timeout or cancellation */
  readonly signal: AbortSignal;

  /** Job priority */
  readonly priority: number;

  /** Job tags */
  readonly tags: string[];

  /**
   * Structured logging
   *
   * @example
   * ```typescript
   * ctx.log('info', 'Processing order', { orderId: '123' });
   * ctx.log('error', 'Payment failed', { error: err.message });
   * ```
   */
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;

  /**
   * Update job progress (0-100) with optional message
   *
   * @example
   * ```typescript
   * ctx.progress(25, 'Downloading...');
   * ctx.progress(50, 'Processing...');
   * ctx.progress(100, 'Done!');
   * ```
   */
  progress(percent: number, message?: string): Promise<void>;

  /**
   * Send heartbeat to prevent stall detection
   * Note: Auto-heartbeat is enabled by default
   */
  heartbeat(): Promise<void>;

  /**
   * Non-retryable error class (convenience)
   *
   * @example
   * ```typescript
   * throw new ctx.NonRetryableError('Invalid input');
   * ```
   */
  NonRetryableError: typeof NonRetryableError;

  /**
   * Retryable error class (convenience)
   *
   * @example
   * ```typescript
   * throw new ctx.RetryableError('Temporary failure', 5000);
   * ```
   */
  RetryableError: typeof RetryableError;
}

/**
 * Handler function type - receives context with payload
 */
export type JobHandler<TPayload = unknown, TResult = unknown> = (
  ctx: JobContext<TPayload>
) => TResult | Promise<TResult>;

/**
 * Worker options
 */
export interface DefineWorkerOptions {
  /** Number of concurrent jobs (default: 1) */
  concurrency?: number;

  /** Connection options */
  connection?: ClientOptions;

  /** Polling interval in ms when no jobs available (default: 1000) */
  pollInterval?: number;

  /** Auto-heartbeat interval in ms (default: 5000, 0 = disabled) */
  heartbeatInterval?: number;

  /** Graceful shutdown timeout in ms (default: 30000) */
  shutdownTimeout?: number;

  /** Auto-start on import (default: true) */
  autoStart?: boolean;

  /** Worker hostname for identification */
  hostname?: string;

  /** Worker version for identification */
  version?: string;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Worker events
 */
export interface WorkerEvents {
  // Worker lifecycle
  ready: () => void;
  stopping: () => void;
  stopped: () => void;
  error: (error: Error) => void;

  // Job lifecycle
  'job:claimed': (jobId: number, queueName: string) => void;
  'job:started': (jobId: number, queueName: string) => void;
  'job:progress': (jobId: number, percent: number, message?: string) => void;
  'job:completed': (jobId: number, result: unknown) => void;
  'job:failed': (jobId: number, error: Error, willRetry: boolean) => void;
}

/**
 * Worker instance returned by defineWorker
 */
export interface WorkerInstance extends EventEmitter {
  /** Start processing jobs */
  start(): Promise<void>;

  /** Stop processing (graceful shutdown) */
  stop(): Promise<void>;

  /** Check if worker is running */
  readonly isRunning: boolean;

  /** Number of jobs currently being processed */
  readonly processing: number;

  /** Total jobs processed */
  readonly processed: number;

  /** Queue name */
  readonly queueName: string;

  /** Worker ID */
  readonly workerId: string;

  // Typed event emitter
  on<K extends keyof WorkerEvents>(event: K, listener: WorkerEvents[K]): this;
  off<K extends keyof WorkerEvents>(event: K, listener: WorkerEvents[K]): this;
  emit<K extends keyof WorkerEvents>(
    event: K,
    ...args: Parameters<WorkerEvents[K]>
  ): boolean;
}

// ============== Implementation ==============

class DefinedWorker extends EventEmitter implements WorkerInstance {
  private clients: FlashQ[] = [];
  private running = false;
  private processingCount = 0;
  private processedCount = 0;
  private workers: Promise<void>[] = [];
  private abortControllers = new Map<number, AbortController>();
  private heartbeatTimers = new Map<number, ReturnType<typeof setInterval>>();

  readonly workerId: string;

  constructor(
    readonly queueName: string,
    private handler: JobHandler,
    private options: Required<
      Omit<DefineWorkerOptions, 'connection' | 'hostname' | 'version' | 'metadata'>
    > &
      Pick<DefineWorkerOptions, 'connection' | 'hostname' | 'version' | 'metadata'>
  ) {
    super();
    this.workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get processing(): number {
    return this.processingCount;
  }

  get processed(): number {
    return this.processedCount;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const connOpts = this.options.connection ?? {};

    // Create one client per concurrency slot
    for (let i = 0; i < this.options.concurrency; i++) {
      const client = new FlashQ(connOpts);
      await client.connect();
      this.clients.push(client);
    }

    this.running = true;
    this.log('info', `Worker started`, {
      workerId: this.workerId,
      queue: this.queueName,
      concurrency: this.options.concurrency,
    });
    this.emit('ready');

    // Start worker loops
    for (let i = 0; i < this.options.concurrency; i++) {
      this.workers.push(this.workerLoop(i));
    }

    // Setup graceful shutdown
    this.setupShutdown();
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.emit('stopping');
    this.log('info', 'Worker stopping...', { workerId: this.workerId });

    // Stop all heartbeat timers
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();

    // Abort all in-progress jobs
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }

    // Wait for workers with timeout
    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, this.options.shutdownTimeout)
    );

    await Promise.race([Promise.all(this.workers), timeout]);
    this.workers = [];

    // Close all clients
    await Promise.all(this.clients.map((c) => c.close()));
    this.clients = [];

    this.log('info', 'Worker stopped', {
      workerId: this.workerId,
      processed: this.processedCount,
    });
    this.emit('stopped');
  }

  private async workerLoop(workerId: number): Promise<void> {
    const client = this.clients[workerId];

    while (this.running) {
      try {
        // Pull with server-side timeout
        const job = await client.pull(this.queueName, 2000);

        if (!job) {
          // No job available, wait before next poll
          if (this.options.pollInterval > 0) {
            await this.sleep(this.options.pollInterval);
          }
          continue;
        }

        this.emit('job:claimed', job.id, this.queueName);
        await this.processJob(job, client);
      } catch (error) {
        if (this.running) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.emit('error', err);
          this.log('error', 'Worker loop error', { error: err.message });
          await this.sleep(1000);
        }
      }
    }
  }

  private async processJob(job: Job, client: FlashQ): Promise<void> {
    this.processingCount++;

    // Create abort controller for this job
    const abortController = new AbortController();
    this.abortControllers.set(job.id, abortController);

    // Setup timeout
    const timeoutId =
      job.timeout > 0
        ? setTimeout(() => abortController.abort(), job.timeout)
        : undefined;

    // Setup auto-heartbeat
    if (this.options.heartbeatInterval > 0) {
      const heartbeatTimer = setInterval(async () => {
        try {
          await client.heartbeat(job.id);
        } catch {
          // Ignore heartbeat errors
        }
      }, this.options.heartbeatInterval);
      this.heartbeatTimers.set(job.id, heartbeatTimer);
    }

    // Create context
    const ctx = this.createContext(job, client, abortController.signal);

    this.emit('job:started', job.id, this.queueName);
    this.log('debug', `Job started`, { jobId: job.id, attempt: job.attempts });

    let result: unknown;
    let error: Error | undefined;
    let willRetry = false;

    try {
      // Process
      result = await this.handler(ctx);

      // Ack
      await client.ack(job.id, result);
      this.processedCount++;
      this.emit('job:completed', job.id, result);
      this.log('info', 'Job completed', { jobId: job.id, result });
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));

      // Check if retryable
      const isNonRetryable =
        err instanceof NonRetryableError ||
        (err as { retryable?: boolean })?.retryable === false;

      willRetry = !isNonRetryable && job.attempts < job.max_attempts;

      this.emit('job:failed', job.id, error, willRetry);
      this.log('warn', 'Job failed', {
        jobId: job.id,
        error: error.message,
        willRetry,
        attempt: job.attempts,
        maxAttempts: job.max_attempts,
      });

      try {
        await client.fail(job.id, error.message);
      } catch {
        // Ignore fail errors
      }
    } finally {
      // Cleanup
      if (timeoutId) clearTimeout(timeoutId);

      const heartbeatTimer = this.heartbeatTimers.get(job.id);
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        this.heartbeatTimers.delete(job.id);
      }

      this.abortControllers.delete(job.id);
      this.processingCount--;
    }
  }

  private createContext<T>(
    job: Job & { data: T },
    client: FlashQ,
    signal: AbortSignal
  ): JobContext<T> {
    const self = this;

    return {
      jobId: job.id,
      payload: job.data,
      queueName: job.queue,
      retryCount: job.attempts, // 0-indexed: first attempt = 0 retries
      maxRetries: job.max_attempts,
      priority: job.priority,
      tags: job.tags,
      signal,

      // Error classes
      NonRetryableError,
      RetryableError,

      log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
        self.log(level, message, { jobId: job.id, ...meta });
      },

      async progress(percent: number, message?: string) {
        self.emit('job:progress', job.id, percent, message);
        await client.progress(job.id, percent, message);
      },

      async heartbeat() {
        await client.heartbeat(job.id);
      },
    };
  }

  private log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.queueName}]`;

    const logFn =
      level === 'error'
        ? console.error
        : level === 'warn'
          ? console.warn
          : level === 'debug'
            ? console.debug
            : console.log;

    if (meta && Object.keys(meta).length > 0) {
      logFn(prefix, message, meta);
    } else {
      logFn(prefix, message);
    }
  }

  private setupShutdown(): void {
    const shutdown = async (signal: string) => {
      this.log('info', `Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============== Main Export ==============

/**
 * Define a worker with zero configuration
 *
 * @param queueName - Queue name to process
 * @param handler - Job handler function receiving context
 * @param options - Optional configuration
 * @returns Worker instance (auto-starts by default)
 *
 * @example
 * ```typescript
 * // worker.ts
 * import { defineWorker } from 'flashq';
 *
 * export default defineWorker('emails', async (ctx) => {
 *   // Structured logging
 *   ctx.log('info', 'Processing email', { to: ctx.payload.to });
 *
 *   // Progress updates
 *   ctx.progress(50, 'Sending...');
 *
 *   // Check for cancellation
 *   if (ctx.signal.aborted) {
 *     throw new Error('Cancelled');
 *   }
 *
 *   // Non-retryable errors
 *   if (!isValid(ctx.payload)) {
 *     throw new ctx.NonRetryableError('Invalid payload');
 *   }
 *
 *   await sendEmail(ctx.payload);
 *   return { sent: true };
 * });
 * ```
 *
 * @example
 * ```typescript
 * // With options
 * export default defineWorker('videos', handler, {
 *   concurrency: 5,
 *   heartbeatInterval: 10000,
 *   connection: { host: 'queue.example.com' },
 * });
 * ```
 */
export function defineWorker<TPayload = unknown, TResult = unknown>(
  queueName: string,
  handler: JobHandler<TPayload, TResult>,
  options: DefineWorkerOptions = {}
): WorkerInstance {
  const worker = new DefinedWorker(queueName, handler as JobHandler, {
    concurrency: options.concurrency ?? 1,
    pollInterval: options.pollInterval ?? 1000,
    heartbeatInterval: options.heartbeatInterval ?? 5000,
    shutdownTimeout: options.shutdownTimeout ?? 30000,
    autoStart: options.autoStart ?? true,
    connection: options.connection,
    hostname: options.hostname,
    version: options.version,
    metadata: options.metadata,
  });

  // Auto-start if enabled
  if (options.autoStart !== false) {
    worker.start().catch((err) => {
      console.error('[flashQ] Failed to start worker:', err);
      process.exit(1);
    });
  }

  return worker;
}

/**
 * Define multiple workers in one file
 *
 * @example
 * ```typescript
 * import { defineWorkers } from 'flashq';
 *
 * export default defineWorkers({
 *   'email:send': async (ctx) => {
 *     await sendEmail(ctx.payload);
 *   },
 *
 *   'email:bulk': {
 *     handler: async (ctx) => {
 *       for (const recipient of ctx.payload.recipients) {
 *         await sendEmail(recipient);
 *       }
 *     },
 *     concurrency: 5,
 *   },
 * });
 * ```
 */
export function defineWorkers(
  handlers: Record<
    string,
    | JobHandler
    | {
        handler: JobHandler;
        concurrency?: number;
      }
  >,
  globalOptions: Omit<DefineWorkerOptions, 'concurrency'> = {}
): WorkerInstance[] {
  const workers: WorkerInstance[] = [];

  for (const [queueName, config] of Object.entries(handlers)) {
    const isSimple = typeof config === 'function';
    const handler = isSimple ? config : config.handler;
    const concurrency = isSimple ? 1 : config.concurrency ?? 1;

    workers.push(
      defineWorker(queueName, handler, {
        ...globalOptions,
        concurrency,
      })
    );
  }

  return workers;
}

export default defineWorker;
