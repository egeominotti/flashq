/**
 * FlashQ Client - High-performance job queue client.
 *
 * This is the main facade that exposes all operations.
 * Methods are organized into logical modules under ./methods/
 */
import { FlashQConnection } from './connection';
import * as core from './methods/core';
import * as jobs from './methods/jobs';
import * as queue from './methods/queue';
import * as dlq from './methods/dlq';
import * as cron from './methods/cron';
import * as metrics from './methods/metrics';
import * as flows from './methods/flows';
import * as advanced from './methods/advanced';
import {
  callHook,
  callErrorHook,
  createHookContext,
  type ClientHooks,
  type PushHookContext,
  type PullHookContext,
  type AckHookContext,
  type FailHookContext,
  type BatchPushHookContext,
  type BatchPullHookContext,
} from '../hooks';

import type {
  Job,
  JobState,
  JobWithState,
  PushOptions,
  QueueInfo,
  QueueStats,
  Metrics,
  CronJob,
  CronOptions,
  JobLogEntry,
  FlowChild,
  FlowResult,
  FlowOptions,
  BatchPushResult,
} from './types';

export type { BatchPushResult } from './types';

/** FlashQ Client - High-performance job queue client with auto-connect. */
export class FlashQ extends FlashQConnection {
  /** Hooks for observability */
  get hooks(): ClientHooks | undefined {
    return this._options.hooks;
  }

  // === CORE OPERATIONS ===

  /** Push a job to a queue */
  async push<T = unknown>(queueName: string, data: T, opts: PushOptions = {}): Promise<Job> {
    const ctx = createHookContext<PushHookContext>({ queue: queueName, data, options: opts });
    await callHook(this.hooks?.onPush, ctx);
    try {
      const job = await core.push(this, queueName, data, opts);
      ctx.job = job;
      await callHook(this.hooks?.onPushComplete, ctx);
      return job;
    } catch (error) {
      await callErrorHook(this.hooks?.onPushError, ctx, error as Error);
      throw error;
    }
  }

  /** Add a job to a queue (alias for push) */
  add<T = unknown>(queueName: string, data: T, opts: PushOptions = {}): Promise<Job> {
    return this.push(queueName, data, opts);
  }

  /** Push multiple jobs in a single batch */
  async pushBatch<T = unknown>(
    queueName: string,
    jobList: Array<{ data: T } & PushOptions>
  ): Promise<number[]> {
    const ctx = createHookContext<BatchPushHookContext>({
      queue: queueName,
      count: jobList.length,
    });
    await callHook(this.hooks?.onBatchPush, ctx);
    try {
      const ids = await core.pushBatch(this, queueName, jobList);
      ctx.ids = ids;
      await callHook(this.hooks?.onBatchPushComplete, ctx);
      return ids;
    } catch (error) {
      await callErrorHook(this.hooks?.onBatchPushError, ctx, error as Error);
      throw error;
    }
  }

  /** Add multiple jobs (alias for pushBatch) */
  addBulk<T = unknown>(
    queueName: string,
    jobList: Array<{ data: T } & PushOptions>
  ): Promise<number[]> {
    return this.pushBatch(queueName, jobList);
  }

  /** Push multiple jobs with partial failure handling */
  async pushBatchSafe<T = unknown>(
    queueName: string,
    jobList: Array<{ data: T } & PushOptions>
  ): Promise<BatchPushResult> {
    const ctx = createHookContext<BatchPushHookContext>({
      queue: queueName,
      count: jobList.length,
    });
    await callHook(this.hooks?.onBatchPush, ctx);
    try {
      const result = await core.pushBatchSafe(this, queueName, jobList);
      ctx.ids = result.ids;
      ctx.failedCount = result.failed.length;
      await callHook(this.hooks?.onBatchPushComplete, ctx);
      return result;
    } catch (error) {
      await callErrorHook(this.hooks?.onBatchPushError, ctx, error as Error);
      throw error;
    }
  }

  /** Pull a job from a queue (blocking with timeout) */
  async pull<T = unknown>(
    queueName: string,
    timeout?: number
  ): Promise<(Job & { data: T }) | null> {
    const ctx = createHookContext<PullHookContext>({ queue: queueName, timeout });
    await callHook(this.hooks?.onPull, ctx);
    try {
      const job = await core.pull<T>(this, queueName, timeout);
      ctx.job = job;
      await callHook(this.hooks?.onPullComplete, ctx);
      return job;
    } catch (error) {
      await callErrorHook(this.hooks?.onPullError, ctx, error as Error);
      throw error;
    }
  }

  /** Pull multiple jobs from a queue */
  async pullBatch<T = unknown>(
    queueName: string,
    count: number,
    timeout?: number
  ): Promise<Array<Job & { data: T }>> {
    const ctx = createHookContext<BatchPullHookContext>({ queue: queueName, count, timeout });
    await callHook(this.hooks?.onBatchPull, ctx);
    try {
      const jobList = await core.pullBatch<T>(this, queueName, count, timeout);
      ctx.jobs = jobList;
      await callHook(this.hooks?.onBatchPullComplete, ctx);
      return jobList;
    } catch (error) {
      await callErrorHook(this.hooks?.onBatchPullError, ctx, error as Error);
      throw error;
    }
  }

  /** Acknowledge a job as completed */
  async ack(jobId: number, result?: unknown): Promise<void> {
    const ctx = createHookContext<AckHookContext>({ jobId, result });
    await callHook(this.hooks?.onAck, ctx);
    try {
      await core.ack(this, jobId, result);
      await callHook(this.hooks?.onAckComplete, ctx);
    } catch (error) {
      await callErrorHook(this.hooks?.onAckError, ctx, error as Error);
      throw error;
    }
  }

  /** Acknowledge multiple jobs at once */
  ackBatch(jobIds: number[]): Promise<number> {
    return core.ackBatch(this, jobIds);
  }

  /** Fail a job (will retry or move to DLQ) */
  async fail(jobId: number, error?: string): Promise<void> {
    const ctx = createHookContext<FailHookContext>({ jobId, error });
    await callHook(this.hooks?.onFail, ctx);
    try {
      await core.fail(this, jobId, error);
      await callHook(this.hooks?.onFailComplete, ctx);
    } catch (err) {
      await callErrorHook(this.hooks?.onFailError, ctx, err as Error);
      throw err;
    }
  }

  // === JOB QUERY & MANAGEMENT ===

  /** Get a job with its current state */
  getJob(jobId: number): Promise<JobWithState | null> {
    return jobs.getJob(this, jobId);
  }

  /** Get job state only */
  getState(jobId: number): Promise<JobState | null> {
    return jobs.getState(this, jobId);
  }

  /** Get job result */
  getResult<T = unknown>(jobId: number): Promise<T | null> {
    return jobs.getResult(this, jobId);
  }

  /** Wait for a job to complete (finished() promise pattern) */
  finished<T = unknown>(jobId: number, timeout?: number): Promise<T | null> {
    return jobs.finished(this, jobId, timeout);
  }

  /** Get a job by its custom ID */
  getJobByCustomId(customId: string): Promise<JobWithState | null> {
    return jobs.getJobByCustomId(this, customId);
  }

  /** Get multiple jobs by their IDs */
  getJobsBatch(jobIds: number[]): Promise<JobWithState[]> {
    return jobs.getJobsBatch(this, jobIds);
  }

  /** Cancel a pending job */
  cancel(jobId: number): Promise<void> {
    return jobs.cancel(this, jobId);
  }

  /** Update job progress */
  progress(jobId: number, value: number, message?: string): Promise<void> {
    return jobs.progress(this, jobId, value, message);
  }

  /** Get job progress */
  getProgress(jobId: number): Promise<{ progress: number; message?: string }> {
    return jobs.getProgress(this, jobId);
  }

  /** Add a log entry to a job */
  log(jobId: number, message: string, level: 'info' | 'warn' | 'error' = 'info'): Promise<void> {
    return jobs.log(this, jobId, message, level);
  }

  /** Get log entries for a job */
  getLogs(jobId: number): Promise<JobLogEntry[]> {
    return jobs.getLogs(this, jobId);
  }

  /** Send a heartbeat for a long-running job */
  heartbeat(jobId: number): Promise<void> {
    return jobs.heartbeat(this, jobId);
  }

  /** Send partial result for streaming jobs (LLM tokens, chunks, etc.) */
  partial(jobId: number, data: unknown, index?: number): Promise<void> {
    return jobs.partial(this, jobId, data, index);
  }

  // === QUEUE CONTROL ===

  /** Pause a queue */
  pause(queueName: string): Promise<void> {
    return queue.pause(this, queueName);
  }

  /** Resume a paused queue */
  resume(queueName: string): Promise<void> {
    return queue.resume(this, queueName);
  }

  /** Check if a queue is paused */
  isPaused(queueName: string): Promise<boolean> {
    return queue.isPaused(this, queueName);
  }

  /** Set rate limit for a queue (jobs per second) */
  setRateLimit(queueName: string, limit: number): Promise<void> {
    return queue.setRateLimit(this, queueName, limit);
  }

  /** Clear rate limit for a queue */
  clearRateLimit(queueName: string): Promise<void> {
    return queue.clearRateLimit(this, queueName);
  }

  /** Set concurrency limit for a queue */
  setConcurrency(queueName: string, limit: number): Promise<void> {
    return queue.setConcurrency(this, queueName, limit);
  }

  /** Clear concurrency limit for a queue */
  clearConcurrency(queueName: string): Promise<void> {
    return queue.clearConcurrency(this, queueName);
  }

  /** List all queues */
  listQueues(): Promise<QueueInfo[]> {
    return queue.listQueues(this);
  }

  // === DEAD LETTER QUEUE ===

  /** Get jobs from the dead letter queue */
  getDlq(queueName: string, count = 100): Promise<Job[]> {
    return dlq.getDlq(this, queueName, count);
  }

  /** Retry jobs from the dead letter queue */
  retryDlq(queueName: string, jobId?: number): Promise<number> {
    return dlq.retryDlq(this, queueName, jobId);
  }

  /** Purge all jobs from the dead letter queue */
  purgeDlq(queueName: string): Promise<number> {
    return dlq.purgeDlq(this, queueName);
  }

  // === CRON JOBS ===

  /** Add a cron job for scheduled recurring tasks */
  addCron(name: string, options: CronOptions): Promise<void> {
    return cron.addCron(this, name, options);
  }

  /** Delete a cron job */
  deleteCron(name: string): Promise<boolean> {
    return cron.deleteCron(this, name);
  }

  /** List all cron jobs */
  listCrons(): Promise<CronJob[]> {
    return cron.listCrons(this);
  }

  // === STATS & METRICS ===

  /** Get queue statistics */
  stats(): Promise<QueueStats> {
    return metrics.stats(this);
  }

  /** Get detailed metrics */
  metrics(): Promise<Metrics> {
    return metrics.metrics(this);
  }

  // === FLOWS ===

  /** Push a flow (parent job with children) */
  pushFlow<T = unknown>(
    queueName: string,
    parentData: T,
    children: FlowChild[],
    options: FlowOptions = {}
  ): Promise<FlowResult> {
    return flows.pushFlow(this, queueName, parentData, children, options);
  }

  /** Get children job IDs for a parent job */
  getChildren(jobId: number): Promise<number[]> {
    return flows.getChildren(this, jobId);
  }

  // === ADVANCED FEATURES ===

  /** Get jobs filtered by queue and/or state with pagination */
  getJobs(
    options: {
      queue?: string;
      state?: JobState;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ jobs: JobWithState[]; total: number }> {
    return advanced.getJobs(this, options);
  }

  /** Get job counts by state for a queue */
  getJobCounts(queueName: string): Promise<{
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
  }> {
    return advanced.getJobCounts(this, queueName);
  }

  /** Get total count of jobs in a queue (waiting + delayed) */
  count(queueName: string): Promise<number> {
    return advanced.count(this, queueName);
  }

  /** Clean jobs older than grace period by state */
  clean(
    queueName: string,
    grace: number,
    state: 'waiting' | 'delayed' | 'completed' | 'failed',
    limit?: number
  ): Promise<number> {
    return advanced.clean(this, queueName, grace, state, limit);
  }

  /** Drain all waiting jobs from a queue */
  drain(queueName: string): Promise<number> {
    return advanced.drain(this, queueName);
  }

  /** Remove ALL data for a queue */
  obliterate(queueName: string): Promise<number> {
    return advanced.obliterate(this, queueName);
  }

  /** Change job priority */
  changePriority(jobId: number, priority: number): Promise<void> {
    return advanced.changePriority(this, jobId, priority);
  }

  /** Move job from processing back to delayed */
  moveToDelayed(jobId: number, delay: number): Promise<void> {
    return advanced.moveToDelayed(this, jobId, delay);
  }

  /** Promote delayed job to waiting immediately */
  promote(jobId: number): Promise<void> {
    return advanced.promote(this, jobId);
  }

  /** Update job data */
  update<T = unknown>(jobId: number, data: T): Promise<void> {
    return advanced.update(this, jobId, data);
  }

  /** Discard job - move directly to DLQ */
  discard(jobId: number): Promise<void> {
    return advanced.discard(this, jobId);
  }

  // === EVENT SUBSCRIPTIONS ===

  /** Subscribe to real-time events via SSE */
  subscribe(queueName?: string): import('../events').EventSubscriber {
    const { EventSubscriber } = require('../events');
    return new EventSubscriber({
      host: this.options.host,
      httpPort: this.options.httpPort,
      token: this.options.token,
      queue: queueName,
      type: 'sse',
    });
  }

  /** Subscribe to real-time events via WebSocket */
  subscribeWs(queueName?: string): import('../events').EventSubscriber {
    const { EventSubscriber } = require('../events');
    return new EventSubscriber({
      host: this.options.host,
      httpPort: this.options.httpPort,
      token: this.options.token,
      queue: queueName,
      type: 'websocket',
    });
  }
}

export default FlashQ;
