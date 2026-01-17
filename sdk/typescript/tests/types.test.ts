/**
 * FlashQ Types Tests
 *
 * Tests to verify all types are properly exported and usable.
 *
 * Run: bun test tests/types.test.ts
 */

import { describe, test, expect } from 'bun:test';
import type {
  // Job Types
  Job,
  JobState,
  JobWithState,
  JobInput,
  PushOptions,

  // Queue Types
  QueueInfo,
  QueueStats,
  QueueMetrics,

  // Worker Types
  WorkerInfo,
  WorkerOptions,
  ClientOptions,
  JobProcessor,

  // Cron Types
  CronJob,
  CronOptions,

  // Flow Types
  FlowChild,
  FlowOptions,
  FlowResult,

  // Log Types
  JobLogEntry,

  // Response Types
  Metrics,
} from '../src/types';

import type {
  // defineWorker Types
  JobContext,
  JobHandler,
  DefineWorkerOptions,
  WorkerInstance,
  WorkerEvents,
  LogLevel,
} from '../src/define';

import type {
  // Advanced Types
  CircuitState,
  CircuitBreakerOptions,
  RetryOptions,
  WorkflowJob,
  WorkflowDefinition,
  WorkflowInstance,
} from '../src/advanced';

import type {
  // Event Types
  EventType,
  JobEvent,
  EventSubscriberOptions,
  EventSubscriberEvents,
} from '../src/events';

import type {
  // Sandbox Types
  SandboxOptions,
} from '../src/sandbox';

describe('Type Definitions', () => {
  // ============== Job Types ==============

  describe('Job Types', () => {
    test('Job interface should be valid', () => {
      const job: Job = {
        id: 1,
        queue: 'test',
        data: { message: 'hello' },
        priority: 0,
        created_at: Date.now(),
        run_at: Date.now(),
        attempts: 0,
        max_attempts: 3,
        backoff: 1000,
        ttl: 0,
        timeout: 30000,
        tags: [],
        lifo: false,
        remove_on_complete: false,
        remove_on_fail: false,
        stall_timeout: 0,
        stall_count: 0,
      };

      expect(job.id).toBe(1);
    });

    test('JobState should include all states', () => {
      const states: JobState[] = [
        'waiting',
        'delayed',
        'active',
        'completed',
        'failed',
        'waiting-children',
        'waiting-parent',
        'stalled',
      ];

      expect(states.length).toBe(8);
    });

    test('JobWithState should combine job and state', () => {
      const jobWithState: JobWithState = {
        job: {
          id: 1,
          queue: 'test',
          data: {},
          priority: 0,
          created_at: Date.now(),
          run_at: Date.now(),
          attempts: 0,
          max_attempts: 3,
          backoff: 1000,
          ttl: 0,
          timeout: 30000,
          tags: [],
          lifo: false,
          remove_on_complete: false,
          remove_on_fail: false,
          stall_timeout: 0,
          stall_count: 0,
        },
        state: 'waiting',
      };

      expect(jobWithState.state).toBe('waiting');
    });

    test('PushOptions should accept all fields', () => {
      const options: PushOptions = {
        priority: 10,
        delay: 5000,
        ttl: 60000,
        timeout: 30000,
        max_attempts: 5,
        backoff: 2000,
        unique_key: 'unique-123',
        depends_on: [1, 2, 3],
        tags: ['important'],
        lifo: false,
        remove_on_complete: true,
        remove_on_fail: false,
        stall_timeout: 60000,
        debounce_id: 'debounce-key',
        debounce_ttl: 5000,
        jobId: 'custom-id',
        keepCompletedAge: 86400000,
        keepCompletedCount: 100,
      };

      expect(options.priority).toBe(10);
    });
  });

  // ============== Queue Types ==============

  describe('Queue Types', () => {
    test('QueueInfo should have all fields', () => {
      const info: QueueInfo = {
        name: 'test-queue',
        pending: 10,
        processing: 2,
        dlq: 1,
        paused: false,
        rate_limit: 100,
        concurrency_limit: 10,
      };

      expect(info.name).toBe('test-queue');
    });

    test('QueueStats should have all fields', () => {
      const stats: QueueStats = {
        queued: 100,
        processing: 10,
        delayed: 5,
        dlq: 2,
      };

      expect(stats.queued).toBe(100);
    });
  });

  // ============== Worker Types ==============

  describe('Worker Types', () => {
    test('WorkerOptions should have all fields', () => {
      const options: WorkerOptions = {
        id: 'worker-1',
        concurrency: 5,
        heartbeatInterval: 1000,
        autoAck: true,
      };

      expect(options.concurrency).toBe(5);
    });

    test('ClientOptions should have all fields', () => {
      const options: ClientOptions = {
        host: 'localhost',
        port: 6789,
        httpPort: 6790,
        socketPath: '/tmp/flashq.sock',
        token: 'secret',
        timeout: 5000,
        useHttp: false,
        useBinary: true,
      };

      expect(options.host).toBe('localhost');
    });

    test('JobProcessor should be a function type', () => {
      const processor: JobProcessor<{ value: number }, { doubled: number }> = async (job) => {
        return { doubled: job.data.value * 2 };
      };

      expect(typeof processor).toBe('function');
    });
  });

  // ============== Cron Types ==============

  describe('Cron Types', () => {
    test('CronJob should have all fields', () => {
      const cron: CronJob = {
        name: 'daily-cleanup',
        queue: 'maintenance',
        data: { action: 'cleanup' },
        schedule: '0 0 * * *',
        priority: 5,
        last_run: Date.now(),
        next_run: Date.now() + 86400000,
        count: 10,
      };

      expect(cron.name).toBe('daily-cleanup');
    });

    test('CronOptions should have required and optional fields', () => {
      const options: CronOptions = {
        queue: 'maintenance',
        data: { action: 'cleanup' },
        schedule: '0 0 * * *',
        repeat_every: undefined,
        priority: 5,
        limit: 100,
      };

      expect(options.queue).toBe('maintenance');
    });
  });

  // ============== Flow Types ==============

  describe('Flow Types', () => {
    test('FlowChild should have all fields', () => {
      const child: FlowChild = {
        queue: 'child-queue',
        data: { childData: true },
        priority: 5,
        delay: 1000,
      };

      expect(child.queue).toBe('child-queue');
    });

    test('FlowResult should have parent and children', () => {
      const result: FlowResult = {
        parent_id: 1,
        children_ids: [2, 3, 4],
      };

      expect(result.parent_id).toBe(1);
      expect(result.children_ids.length).toBe(3);
    });
  });

  // ============== Log Types ==============

  describe('Log Types', () => {
    test('JobLogEntry should have all fields', () => {
      const entry: JobLogEntry = {
        timestamp: Date.now(),
        message: 'Processing started',
        level: 'info',
      };

      expect(entry.level).toBe('info');
    });
  });

  // ============== defineWorker Types ==============

  describe('defineWorker Types', () => {
    test('LogLevel should include all levels', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      expect(levels.length).toBe(4);
    });

    test('DefineWorkerOptions should have all fields', () => {
      const options: DefineWorkerOptions = {
        concurrency: 5,
        connection: { host: 'localhost', port: 6789 },
        pollInterval: 1000,
        heartbeatInterval: 5000,
        shutdownTimeout: 30000,
        autoStart: true,
        hostname: 'worker-host',
        version: '1.0.0',
        metadata: { region: 'us-east' },
      };

      expect(options.concurrency).toBe(5);
    });
  });

  // ============== Advanced Types ==============

  describe('Advanced Types', () => {
    test('CircuitState should include all states', () => {
      const states: CircuitState[] = ['closed', 'open', 'half-open'];
      expect(states.length).toBe(3);
    });

    test('CircuitBreakerOptions should have all fields', () => {
      const options: CircuitBreakerOptions = {
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 30000,
        onOpen: () => {},
        onClose: () => {},
        onHalfOpen: () => {},
      };

      expect(options.failureThreshold).toBe(5);
    });

    test('RetryOptions should have all fields', () => {
      const options: RetryOptions = {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        factor: 2,
        jitter: true,
        retryOn: () => true,
        onRetry: () => {},
      };

      expect(options.maxRetries).toBe(3);
    });

    test('WorkflowJob should have all fields', () => {
      const job: WorkflowJob = {
        key: 'step1',
        queue: 'etl',
        data: { phase: 'extract' },
        dependsOn: ['init'],
        options: { priority: 10 },
      };

      expect(job.key).toBe('step1');
    });

    test('WorkflowDefinition should have all fields', () => {
      const workflow: WorkflowDefinition = {
        name: 'ETL Pipeline',
        jobs: [
          { key: 'extract', queue: 'etl', data: {} },
          { key: 'transform', queue: 'etl', data: {}, dependsOn: ['extract'] },
        ],
      };

      expect(workflow.name).toBe('ETL Pipeline');
    });

    test('WorkflowInstance should have all fields', () => {
      const instance: WorkflowInstance = {
        name: 'ETL Pipeline',
        jobIds: {
          extract: 1,
          transform: 2,
        },
        parentId: 0,
      };

      expect(instance.jobIds.extract).toBe(1);
    });
  });

  // ============== Event Types ==============

  describe('Event Types', () => {
    test('EventType should include all types', () => {
      const types: EventType[] = ['pushed', 'completed', 'failed', 'progress', 'timeout'];
      expect(types.length).toBe(5);
    });

    test('JobEvent should have all fields', () => {
      const event: JobEvent = {
        eventType: 'completed',
        queue: 'test',
        jobId: 123,
        timestamp: Date.now(),
        data: { result: true },
        error: undefined,
        progress: undefined,
      };

      expect(event.eventType).toBe('completed');
    });

    test('EventSubscriberOptions should have all fields', () => {
      const options: EventSubscriberOptions = {
        host: 'localhost',
        httpPort: 6790,
        token: 'secret',
        queue: 'test',
        type: 'sse',
        autoReconnect: true,
        reconnectDelay: 1000,
        maxReconnectAttempts: 10,
      };

      expect(options.type).toBe('sse');
    });
  });

  // ============== Sandbox Types ==============

  describe('Sandbox Types', () => {
    test('SandboxOptions should have all fields', () => {
      const options: SandboxOptions = {
        processorFile: './processor.ts',
        concurrency: 5,
        timeout: 30000,
        connection: {
          host: 'localhost',
          port: 6789,
          token: 'secret',
        },
      };

      expect(options.processorFile).toBe('./processor.ts');
    });
  });

  // ============== Metrics Type ==============

  describe('Metrics Type', () => {
    test('Metrics should have all fields', () => {
      const metrics: Metrics = {
        total_pushed: 1000,
        total_completed: 950,
        total_failed: 20,
        jobs_per_second: 100,
        avg_latency_ms: 50,
        queues: {},
        history: [],
      };

      expect(metrics.total_pushed).toBe(1000);
    });
  });
});

// ============== Export Tests ==============

describe('Module Exports', () => {
  test('should export all classes from main index', async () => {
    const exports = await import('../src/index');

    // Classes
    expect(exports.FlashQ).toBeDefined();
    expect(exports.Worker).toBeDefined();
    expect(exports.Queue).toBeDefined();
    expect(exports.SandboxedWorker).toBeDefined();
    expect(exports.CircuitBreaker).toBeDefined();
    expect(exports.Workflows).toBeDefined();
    expect(exports.FlashQClient).toBeDefined();
    expect(exports.JobsAPI).toBeDefined();
    expect(exports.QueuesAPI).toBeDefined();
    expect(exports.SchedulesAPI).toBeDefined();
    expect(exports.EventSubscriber).toBeDefined();
  });

  test('should export all functions from main index', async () => {
    const exports = await import('../src/index');

    // Functions
    expect(exports.defineWorker).toBeDefined();
    expect(exports.defineWorkers).toBeDefined();
    expect(exports.createProcessor).toBeDefined();
    expect(exports.retry).toBeDefined();
    expect(exports.calculateBackoff).toBeDefined();
    expect(exports.createEventSubscriber).toBeDefined();
    expect(exports.createWebSocketSubscriber).toBeDefined();
    expect(exports.subscribeToEvents).toBeDefined();
  });

  test('should export error classes', async () => {
    const exports = await import('../src/index');

    expect(exports.NonRetryableError).toBeDefined();
    expect(exports.RetryableError).toBeDefined();
  });

  test('should have default export as FlashQ', async () => {
    const exports = await import('../src/index');
    expect(exports.default).toBe(exports.FlashQ);
  });
});
