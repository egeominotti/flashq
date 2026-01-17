/**
 * Advanced Features for flashQ SDK
 *
 * - Circuit Breaker: Protect against cascading failures
 * - Retry with Jitter: Smarter retry strategies
 * - Workflows: DAG-based job orchestration
 * - Namespace API: Organized API structure
 */

import { FlashQ } from './client';
import type {
  Job,
  JobState,
  JobWithState,
  PushOptions,
  QueueInfo,
  CronJob,
  CronOptions,
  Metrics,
  FlowChild,
  FlowOptions,
  FlowResult,
} from './types';

// ============== Circuit Breaker ==============

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Number of successes in half-open state to close circuit (default: 3) */
  successThreshold?: number;
  /** Time in ms before attempting recovery (default: 30000) */
  timeout?: number;
  /** Called when circuit opens */
  onOpen?: () => void;
  /** Called when circuit closes */
  onClose?: () => void;
  /** Called when circuit enters half-open state */
  onHalfOpen?: () => void;
}

/**
 * Circuit Breaker implementation
 *
 * Protects against cascading failures by temporarily stopping
 * requests when a service is failing.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   successThreshold: 3,
 *   timeout: 30000,
 *   onOpen: () => console.log('Circuit opened!'),
 * });
 *
 * // Wrap your function
 * const result = await breaker.execute(() => client.push('emails', data));
 * ```
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private options: Required<CircuitBreakerOptions>;

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      successThreshold: options.successThreshold ?? 3,
      timeout: options.timeout ?? 30000,
      onOpen: options.onOpen ?? (() => {}),
      onClose: options.onClose ?? (() => {}),
      onHalfOpen: options.onHalfOpen ?? (() => {}),
    };
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Check if circuit allows requests
   */
  isAvailable(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      // Check if timeout has passed
      if (Date.now() - this.lastFailureTime >= this.options.timeout) {
        this.transitionTo('half-open');
        return true;
      }
      return false;
    }
    // half-open: allow requests
    return true;
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAvailable()) {
      throw new Error('Circuit breaker is open');
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.transitionTo('closed');
      }
    } else {
      this.failures = 0;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.transitionTo('open');
    } else if (this.failures >= this.options.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    this.state = newState;
    this.failures = 0;
    this.successes = 0;

    switch (newState) {
      case 'open':
        this.options.onOpen();
        break;
      case 'closed':
        this.options.onClose();
        break;
      case 'half-open':
        this.options.onHalfOpen();
        break;
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo('closed');
  }
}

// ============== Retry with Jitter ==============

export interface RetryOptions {
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms (default: 1000) */
  baseDelay?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2) */
  factor?: number;
  /** Add randomness to delays (default: true) */
  jitter?: boolean;
  /** Custom function to determine if should retry */
  retryOn?: (error: Error, attempt: number) => boolean;
  /** Called before each retry */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
export function calculateBackoff(
  attempt: number,
  options: RetryOptions = {}
): number {
  const baseDelay = options.baseDelay ?? 1000;
  const maxDelay = options.maxDelay ?? 30000;
  const factor = options.factor ?? 2;
  const jitter = options.jitter ?? true;

  // Exponential backoff
  let delay = baseDelay * Math.pow(factor, attempt - 1);

  // Add jitter (±25%)
  if (jitter) {
    const jitterRange = delay * 0.25;
    delay += Math.random() * jitterRange * 2 - jitterRange;
  }

  // Cap at maxDelay
  return Math.min(delay, maxDelay);
}

/**
 * Retry a function with exponential backoff and jitter
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   () => client.push('emails', data),
 *   {
 *     maxRetries: 5,
 *     baseDelay: 1000,
 *     jitter: true,
 *     onRetry: (err, attempt, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms: ${err.message}`);
 *     },
 *   }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const retryOn = options.retryOn ?? (() => true);
  const onRetry = options.onRetry ?? (() => {});

  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt > maxRetries || !retryOn(lastError, attempt)) {
        throw lastError;
      }

      const delay = calculateBackoff(attempt, options);
      onRetry(lastError, attempt, delay);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

// ============== Workflows API ==============

export interface WorkflowJob {
  /** Unique key for this job within the workflow */
  key: string;
  /** Queue to push this job to */
  queue: string;
  /** Job payload */
  data: unknown;
  /** Keys of jobs that must complete before this one */
  dependsOn?: string[];
  /** Job options */
  options?: Omit<PushOptions, 'depends_on'>;
}

export interface WorkflowDefinition {
  /** Workflow name */
  name: string;
  /** Jobs in this workflow */
  jobs: WorkflowJob[];
}

export interface WorkflowInstance {
  /** Workflow name */
  name: string;
  /** Mapping from job key to job ID */
  jobIds: Record<string, number>;
  /** Parent job ID (if using flow-based approach) */
  parentId?: number;
}

/**
 * Workflows API for DAG-based job orchestration
 *
 * @example
 * ```typescript
 * const workflows = new Workflows(client);
 *
 * // Define an ETL workflow
 * const instance = await workflows.create({
 *   name: 'ETL Pipeline',
 *   jobs: [
 *     { key: 'extract', queue: 'etl', data: { source: 'db' } },
 *     { key: 'transform', queue: 'etl', data: {}, dependsOn: ['extract'] },
 *     { key: 'load', queue: 'etl', data: {}, dependsOn: ['transform'] },
 *   ],
 * });
 *
 * // Check status
 * const status = await workflows.getStatus(instance);
 * ```
 */
export class Workflows {
  constructor(private client: FlashQ) {}

  /**
   * Create a workflow instance
   *
   * Resolves dependencies and pushes all jobs in the correct order.
   */
  async create(definition: WorkflowDefinition): Promise<WorkflowInstance> {
    const jobIds: Record<string, number> = {};
    const jobQueue: WorkflowJob[] = [];
    const completed = new Set<string>();

    // Build dependency graph
    const remaining = [...definition.jobs];

    // Topological sort
    while (remaining.length > 0) {
      const ready = remaining.filter((job) =>
        (job.dependsOn ?? []).every((dep) => completed.has(dep))
      );

      if (ready.length === 0 && remaining.length > 0) {
        throw new Error('Circular dependency detected in workflow');
      }

      for (const job of ready) {
        jobQueue.push(job);
        completed.add(job.key);
        const idx = remaining.indexOf(job);
        remaining.splice(idx, 1);
      }
    }

    // Push jobs in order
    for (const job of jobQueue) {
      const dependsOnIds = (job.dependsOn ?? []).map((key) => jobIds[key]);

      const pushed = await this.client.push(job.queue, job.data, {
        ...job.options,
        depends_on: dependsOnIds.length > 0 ? dependsOnIds : undefined,
      });

      jobIds[job.key] = pushed.id;
    }

    return {
      name: definition.name,
      jobIds,
    };
  }

  /**
   * Get status of all jobs in a workflow
   */
  async getStatus(
    instance: WorkflowInstance
  ): Promise<Record<string, { job: Job; state: JobState } | null>> {
    const ids = Object.values(instance.jobIds);
    const jobs = await this.client.getJobsBatch(ids);

    const result: Record<string, { job: Job; state: JobState } | null> = {};

    for (const [key, id] of Object.entries(instance.jobIds)) {
      const found = jobs.find((j) => j.job.id === id);
      result[key] = found ?? null;
    }

    return result;
  }

  /**
   * Cancel all jobs in a workflow
   */
  async cancel(instance: WorkflowInstance): Promise<number> {
    let cancelled = 0;
    for (const id of Object.values(instance.jobIds)) {
      try {
        await this.client.cancel(id);
        cancelled++;
      } catch {
        // Job may already be completed or failed
      }
    }
    return cancelled;
  }

  /**
   * Wait for all jobs in a workflow to complete
   */
  async waitForCompletion(
    instance: WorkflowInstance,
    options: { pollInterval?: number; timeout?: number } = {}
  ): Promise<Record<string, unknown>> {
    const pollInterval = options.pollInterval ?? 1000;
    const timeout = options.timeout ?? 300000; // 5 minutes default
    const startTime = Date.now();

    const results: Record<string, unknown> = {};

    while (Date.now() - startTime < timeout) {
      const status = await this.getStatus(instance);
      let allComplete = true;

      for (const [key, jobStatus] of Object.entries(status)) {
        if (!jobStatus) continue;

        if (jobStatus.state === 'failed') {
          throw new Error(`Job "${key}" failed in workflow "${instance.name}"`);
        }

        if (jobStatus.state === 'completed') {
          if (!(key in results)) {
            const result = await this.client.getResult(jobStatus.job.id);
            results[key] = result;
          }
        } else {
          allComplete = false;
        }
      }

      if (allComplete) {
        return results;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Workflow "${instance.name}" timed out`);
  }
}

// ============== Namespace API ==============

/**
 * Jobs namespace API
 */
export class JobsAPI {
  constructor(private client: FlashQ) {}

  async create<T = unknown>(queue: string, data: T, options?: PushOptions): Promise<Job> {
    return this.client.push(queue, data, options);
  }

  async createBulk<T = unknown>(
    queue: string,
    jobs: Array<{ data: T } & PushOptions>
  ): Promise<number[]> {
    return this.client.pushBatch(queue, jobs);
  }

  async get(jobId: number): Promise<JobWithState | null> {
    return this.client.getJob(jobId);
  }

  async getByCustomId(customId: string): Promise<JobWithState | null> {
    return this.client.getJobByCustomId(customId);
  }

  async getBatch(jobIds: number[]): Promise<JobWithState[]> {
    return this.client.getJobsBatch(jobIds);
  }

  async getState(jobId: number): Promise<JobState | null> {
    return this.client.getState(jobId);
  }

  async getResult<T = unknown>(jobId: number): Promise<T | null> {
    return this.client.getResult<T>(jobId);
  }

  async cancel(jobId: number): Promise<void> {
    return this.client.cancel(jobId);
  }

  async update<T = unknown>(jobId: number, data: T): Promise<void> {
    return this.client.update(jobId, data);
  }

  async changePriority(jobId: number, priority: number): Promise<void> {
    return this.client.changePriority(jobId, priority);
  }

  async moveToDelayed(jobId: number, delay: number): Promise<void> {
    return this.client.moveToDelayed(jobId, delay);
  }

  async promote(jobId: number): Promise<void> {
    return this.client.promote(jobId);
  }

  async discard(jobId: number): Promise<void> {
    return this.client.discard(jobId);
  }

  async progress(jobId: number, progress: number, message?: string): Promise<void> {
    return this.client.progress(jobId, progress, message);
  }

  async getProgress(jobId: number): Promise<{ progress: number; message?: string }> {
    return this.client.getProgress(jobId);
  }

  async waitForCompletion<T = unknown>(jobId: number, timeout?: number): Promise<T | null> {
    return this.client.finished<T>(jobId, timeout);
  }

  async list(options?: {
    queue?: string;
    state?: JobState;
    limit?: number;
    offset?: number;
  }): Promise<{ jobs: JobWithState[]; total: number }> {
    return this.client.getJobs(options);
  }
}

/**
 * Queues namespace API
 */
export class QueuesAPI {
  constructor(private client: FlashQ) {}

  async list(): Promise<QueueInfo[]> {
    return this.client.listQueues();
  }

  async pause(queue: string): Promise<void> {
    return this.client.pause(queue);
  }

  async resume(queue: string): Promise<void> {
    return this.client.resume(queue);
  }

  async isPaused(queue: string): Promise<boolean> {
    return this.client.isPaused(queue);
  }

  async count(queue: string): Promise<number> {
    return this.client.count(queue);
  }

  async getJobCounts(queue: string): Promise<{
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
  }> {
    return this.client.getJobCounts(queue);
  }

  async setRateLimit(queue: string, limit: number): Promise<void> {
    return this.client.setRateLimit(queue, limit);
  }

  async clearRateLimit(queue: string): Promise<void> {
    return this.client.clearRateLimit(queue);
  }

  async setConcurrency(queue: string, limit: number): Promise<void> {
    return this.client.setConcurrency(queue, limit);
  }

  async clearConcurrency(queue: string): Promise<void> {
    return this.client.clearConcurrency(queue);
  }

  async drain(queue: string): Promise<number> {
    return this.client.drain(queue);
  }

  async obliterate(queue: string): Promise<number> {
    return this.client.obliterate(queue);
  }

  async clean(
    queue: string,
    grace: number,
    state: 'waiting' | 'delayed' | 'completed' | 'failed',
    limit?: number
  ): Promise<number> {
    return this.client.clean(queue, grace, state, limit);
  }

  /** Dead Letter Queue operations */
  dlq = {
    list: async (queue: string, count?: number): Promise<Job[]> => {
      return this.client.getDlq(queue, count);
    },
    retry: async (queue: string, jobId?: number): Promise<number> => {
      return this.client.retryDlq(queue, jobId);
    },
    purge: async (queue: string): Promise<number> => {
      return this.client.purgeDlq(queue);
    },
  };
}

/**
 * Schedules namespace API
 */
export class SchedulesAPI {
  constructor(private client: FlashQ) {}

  async create(name: string, options: CronOptions): Promise<void> {
    return this.client.addCron(name, options);
  }

  async delete(name: string): Promise<boolean> {
    return this.client.deleteCron(name);
  }

  async list(): Promise<CronJob[]> {
    return this.client.listCrons();
  }
}

/**
 * Namespace-based API wrapper for flashQ
 *
 * Provides organized access to all flashQ features through namespaces.
 *
 * @example
 * ```typescript
 * import { FlashQClient } from 'flashq';
 *
 * const client = new FlashQClient();
 *
 * // Jobs
 * const job = await client.jobs.create('emails', { to: 'user@example.com' });
 * const status = await client.jobs.get(job.id);
 *
 * // Queues
 * await client.queues.pause('emails');
 * const counts = await client.queues.getJobCounts('emails');
 *
 * // DLQ
 * await client.queues.dlq.purge('emails');
 *
 * // Schedules
 * await client.schedules.create('cleanup', { queue: 'maintenance', ... });
 *
 * // Workflows
 * const workflow = await client.workflows.create({ ... });
 * ```
 */
export class FlashQClient {
  private _client: FlashQ;
  private _jobs: JobsAPI;
  private _queues: QueuesAPI;
  private _schedules: SchedulesAPI;
  private _workflows: Workflows;
  private _circuitBreaker?: CircuitBreaker;

  constructor(options?: ConstructorParameters<typeof FlashQ>[0] & {
    circuitBreaker?: CircuitBreakerOptions;
  }) {
    const { circuitBreaker: cbOptions, ...clientOptions } = options ?? {};

    this._client = new FlashQ(clientOptions);
    this._jobs = new JobsAPI(this._client);
    this._queues = new QueuesAPI(this._client);
    this._schedules = new SchedulesAPI(this._client);
    this._workflows = new Workflows(this._client);

    if (cbOptions) {
      this._circuitBreaker = new CircuitBreaker(cbOptions);
    }
  }

  /** Jobs API */
  get jobs(): JobsAPI {
    return this._jobs;
  }

  /** Queues API */
  get queues(): QueuesAPI {
    return this._queues;
  }

  /** Schedules (Cron) API */
  get schedules(): SchedulesAPI {
    return this._schedules;
  }

  /** Workflows API */
  get workflows(): Workflows {
    return this._workflows;
  }

  /** Circuit breaker instance (if configured) */
  get circuitBreaker(): CircuitBreaker | undefined {
    return this._circuitBreaker;
  }

  /** Get underlying FlashQ client */
  get raw(): FlashQ {
    return this._client;
  }

  /** Connect to server */
  async connect(): Promise<void> {
    return this._client.connect();
  }

  /** Close connection */
  async close(): Promise<void> {
    return this._client.close();
  }

  /** Check if connected */
  isConnected(): boolean {
    return this._client.isConnected();
  }

  /** Get stats */
  async stats(): Promise<{ queued: number; processing: number; delayed: number; dlq: number }> {
    return this._client.stats();
  }

  /** Get metrics */
  async metrics(): Promise<Metrics> {
    return this._client.metrics();
  }
}
