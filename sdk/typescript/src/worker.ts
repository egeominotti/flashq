import { EventEmitter } from 'events';
import { FlashQ } from './client';
import type { Job, JobProcessor, WorkerOptions, ClientOptions } from './types';
import {
  callHook,
  callErrorHook,
  createHookContext,
  type WorkerHooks,
  type ProcessHookContext,
} from './hooks';

export interface BullMQWorkerOptions extends Omit<ClientOptions, 'hooks'>, WorkerOptions {
  /** Auto-start worker (BullMQ-compatible, default: true) */
  autorun?: boolean;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Graceful shutdown timeout in ms (default: 30000). Use 0 for infinite wait. */
  closeTimeout?: number;
  /** Worker hooks for observability */
  workerHooks?: WorkerHooks;
}

type WorkerState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';

/**
 * FlashQ Worker (BullMQ-compatible)
 *
 * @example
 * ```typescript
 * // BullMQ-style: auto-starts by default
 * const worker = new Worker('emails', async (job) => {
 *   await sendEmail(job.data.to);
 *   return { sent: true };
 * });
 *
 * // With options
 * const worker = new Worker('tasks', processor, {
 *   concurrency: 10,
 *   autorun: false,  // disable auto-start
 * });
 * await worker.start();
 *
 * // Graceful shutdown
 * process.on('SIGTERM', () => worker.close());
 * ```
 */
export class Worker<T = unknown, R = unknown> extends EventEmitter {
  private clients: FlashQ[] = [];
  private clientOptions: ClientOptions;
  private queues: string[];
  private processor: JobProcessor<T, R>;
  private options: Required<WorkerOptions> & {
    autorun: boolean;
    debug: boolean;
    closeTimeout: number;
  };
  private state: WorkerState = 'idle';
  private processing = 0;
  private jobsProcessed = 0;
  private workers: Promise<void>[] = [];
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private workerHooks?: WorkerHooks;

  private log(message: string, data?: unknown): void {
    if (!this.options.debug) return;
    const timestamp = new Date().toISOString();
    const prefix = `[flashQ Worker ${this.options.id} ${timestamp}]`;
    if (data !== undefined) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  constructor(
    queues: string | string[],
    processor: JobProcessor<T, R>,
    options: BullMQWorkerOptions = {}
  ) {
    super();
    this.queues = Array.isArray(queues) ? queues : [queues];
    this.processor = processor;
    this.options = {
      id: options.id ?? `worker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      concurrency: options.concurrency ?? 10,
      batchSize: options.batchSize ?? 100,
      autoAck: options.autoAck ?? true,
      autorun: options.autorun ?? true,
      debug: options.debug ?? false,
      closeTimeout: options.closeTimeout ?? 30000,
    };

    this.workerHooks = options.workerHooks;

    this.clientOptions = {
      host: options.host,
      port: options.port,
      httpPort: options.httpPort,
      token: options.token,
      timeout: options.timeout,
    };

    // Auto-start if enabled (BullMQ-compatible)
    if (this.options.autorun) {
      this.start();
    }
  }

  /**
   * Start processing jobs
   */
  async start(): Promise<void> {
    // Return existing promise if already starting
    if (this.state === 'starting' && this.startPromise) {
      return this.startPromise;
    }

    // Already running or stopped
    if (this.state === 'running') {
      return;
    }

    if (this.state === 'stopping' || this.state === 'stopped') {
      throw new Error('Cannot start a stopped worker. Create a new Worker instance.');
    }

    this.state = 'starting';
    this.startPromise = this.doStart();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async doStart(): Promise<void> {
    this.log('Starting worker', { queues: this.queues, concurrency: this.options.concurrency });
    // Create a separate client for each worker (TCP pull is blocking)
    for (let i = 0; i < this.options.concurrency; i++) {
      const client = new FlashQ({ ...this.clientOptions, debug: this.options.debug });
      await client.connect();
      this.clients.push(client);
      this.log(`Client ${i} connected`);
    }

    this.state = 'running';
    this.emit('ready');
    this.log('Worker ready');

    // Start worker loops (each with its own client)
    for (let i = 0; i < this.options.concurrency; i++) {
      this.workers.push(this.batchWorkerLoop(i, this.clients[i]));
    }
  }

  /**
   * Close the worker (BullMQ-compatible alias for stop)
   * @param force If true, don't wait for jobs to complete (default: false)
   */
  async close(force = false): Promise<void> {
    return this.stop(force);
  }

  /**
   * Stop processing jobs (graceful shutdown)
   * @param force If true, don't wait for jobs to complete (default: false)
   */
  async stop(force = false): Promise<void> {
    // Wait for starting to complete first
    if (this.state === 'starting' && this.startPromise) {
      await this.startPromise;
    }

    // Return existing promise if already stopping
    if (this.state === 'stopping' && this.stopPromise) {
      return this.stopPromise;
    }

    // Already stopped or never started
    if (this.state === 'stopped' || this.state === 'idle') {
      return;
    }

    this.state = 'stopping';
    this.emit('stopping');
    this.stopPromise = this.doStop(force);

    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  private async doStop(force: boolean): Promise<void> {
    this.log('Stopping worker', { processing: this.processing, force });

    if (force) {
      // Force close - abort immediately
      this.abortController?.abort();
      this.workers = [];
    } else {
      // Graceful shutdown - wait for jobs with timeout
      const timeout = this.options.closeTimeout;

      if (timeout > 0) {
        const timeoutPromise = new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), timeout)
        );

        const result = await Promise.race([
          Promise.all(this.workers).then(() => 'done' as const),
          timeoutPromise,
        ]);

        if (result === 'timeout') {
          this.log('Graceful shutdown timeout reached', { timeout, processing: this.processing });
          this.emit(
            'error',
            new Error(
              `Shutdown timeout after ${timeout}ms with ${this.processing} jobs still processing`
            )
          );
        }
      } else {
        // Wait indefinitely
        await Promise.all(this.workers);
      }
    }

    this.workers = [];
    this.log('All worker loops stopped');

    // Close all clients
    const clientsToClose = [...this.clients];
    this.clients = [];
    await Promise.all(clientsToClose.map((c) => c.close()));
    this.log('All clients closed');

    this.state = 'stopped';
    this.emit('stopped');
    this.emit('drained');
    this.log('Worker stopped', { totalProcessed: this.jobsProcessed });
  }

  /**
   * Wait for all currently processing jobs to complete
   * @param timeout Max wait time in ms (default: uses closeTimeout option)
   * @returns true if all jobs completed, false if timeout
   */
  async waitForJobs(timeout?: number): Promise<boolean> {
    if (this.processing === 0) return true;

    const waitTimeout = timeout ?? this.options.closeTimeout;

    return new Promise<boolean>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.processing === 0) {
          clearInterval(checkInterval);
          clearTimeout(timer);
          resolve(true);
        }
      }, 50);

      const timer = setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, waitTimeout);
    });
  }

  /**
   * Check if worker is running
   */
  isRunning(): boolean {
    return this.state === 'running';
  }

  /**
   * Get current worker state
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Get number of jobs currently being processed
   */
  getProcessingCount(): number {
    return this.processing;
  }

  /**
   * Get total number of jobs processed by this worker
   */
  getJobsProcessed(): number {
    return this.jobsProcessed;
  }

  /**
   * Batch worker loop - pulls and processes jobs in batches for maximum throughput
   */
  private async batchWorkerLoop(workerId: number, client: FlashQ): Promise<void> {
    const batchSize = this.options.batchSize;

    while (this.state === 'running') {
      for (const queue of this.queues) {
        // Check before pulling - don't start new work if stopping
        if (this.state !== 'running') break;

        try {
          // Batch pull with SHORT timeout (500ms) for responsive shutdown
          const jobs = await client.pullBatch<T>(queue, batchSize, 500);

          // No jobs available - continue polling
          if (!jobs || jobs.length === 0) {
            continue;
          }

          // IMPORTANT: Always process pulled jobs even if state changed during pullBatch
          // This ensures graceful shutdown completes in-flight work
          await this.processJobBatch(workerId, client, jobs);
        } catch (error) {
          // Timeout is expected when no jobs available - not an error
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
            // Normal - no jobs available, retry
            continue;
          }
          // Connection error - wait before retry
          if (this.state === 'running') {
            this.emit('error', error);
            await this.sleep(1000);
          }
        }
      }
    }

    this.log(`Worker loop ${workerId} exited`, { state: this.state });
  }

  /**
   * Process a batch of jobs - always completes even during shutdown
   */
  private async processJobBatch(
    workerId: number,
    client: FlashQ,
    jobs: Array<Job & { data: T }>
  ): Promise<void> {
    this.processing += jobs.length;

    // Track successful and failed jobs
    const successJobs: Array<{ job: Job & { data: T }; result: R }> = [];
    const failedJobs: Array<{ job: Job & { data: T }; error: string }> = [];

    // Process all jobs in parallel
    await Promise.all(
      jobs.map(async (job) => {
        this.emit('active', job, workerId);

        // Create hook context for this job
        const hookCtx = createHookContext<ProcessHookContext>({
          job,
          workerId,
        });
        await callHook(this.workerHooks?.onProcess, hookCtx);

        try {
          const result = await this.processJob(job);
          hookCtx.result = result as unknown;
          await callHook(this.workerHooks?.onProcessComplete, hookCtx);
          successJobs.push({ job, result });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          hookCtx.error = err;
          await callErrorHook(this.workerHooks?.onProcessError, hookCtx, err);
          failedJobs.push({ job, error: err.message });
        }
      })
    );

    // Ack successful jobs with results - THEN emit completed
    if (this.options.autoAck && successJobs.length > 0) {
      // Use individual ack() to preserve results for finished() promise
      await Promise.all(
        successJobs.map(async ({ job, result }) => {
          await client.ack(job.id, result);
          this.jobsProcessed++;
          this.emit('completed', job, result, workerId);
        })
      );
    } else if (!this.options.autoAck && successJobs.length > 0) {
      // If autoAck is disabled, emit completed after processing
      for (const { job, result } of successJobs) {
        this.jobsProcessed++;
        this.emit('completed', job, result, workerId);
      }
    }

    // Fail individual jobs that errored - THEN emit failed
    if (this.options.autoAck && failedJobs.length > 0) {
      await Promise.all(
        failedJobs.map(async ({ job, error }) => {
          await client.fail(job.id, error);
          this.emit('failed', job, new Error(error), workerId);
        })
      );
    } else if (!this.options.autoAck && failedJobs.length > 0) {
      for (const { job, error } of failedJobs) {
        this.emit('failed', job, new Error(error), workerId);
      }
    }

    this.processing -= jobs.length;
  }

  private async processJob(job: Job & { data: T }): Promise<R> {
    return this.processor(job);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Update progress for the current job
   * (Use this within your processor function)
   * @throws Error if worker is not running
   */
  async updateProgress(jobId: number, progress: number, message?: string): Promise<void> {
    if (this.state !== 'running') {
      const error = new Error(`Cannot update progress: worker is ${this.state}`);
      this.log('updateProgress failed', { jobId, state: this.state });
      throw error;
    }
    if (this.clients.length === 0) {
      const error = new Error('Cannot update progress: no active clients');
      this.log('updateProgress failed', { jobId, reason: 'no clients' });
      throw error;
    }
    await this.clients[0].progress(jobId, progress, message);
    this.log('Progress updated', { jobId, progress, message });
  }
}

export default Worker;
