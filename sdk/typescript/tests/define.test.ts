/**
 * FlashQ defineWorker Tests
 *
 * Tests for the zero-config defineWorker API, including error handling,
 * job context, NonRetryableError, and RetryableError.
 *
 * Run: bun test tests/define.test.ts
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { FlashQ } from '../src/client';
import {
  defineWorker,
  defineWorkers,
  NonRetryableError,
  RetryableError,
} from '../src/define';
import type { WorkerInstance, JobContext } from '../src/define';

const TEST_QUEUE = 'test-define-worker';

describe('defineWorker API', () => {
  let client: FlashQ;

  beforeAll(async () => {
    client = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await client.connect();
  });

  afterAll(async () => {
    await client.obliterate(TEST_QUEUE);
    await client.close();
  });

  beforeEach(async () => {
    await client.obliterate(TEST_QUEUE);
  });

  // ============== Error Classes Tests ==============

  describe('NonRetryableError', () => {
    test('should create non-retryable error', () => {
      const error = new NonRetryableError('Invalid input');
      expect(error.name).toBe('NonRetryableError');
      expect(error.message).toBe('Invalid input');
      expect(error.retryable).toBe(false);
    });

    test('should be instance of Error', () => {
      const error = new NonRetryableError('Test');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('RetryableError', () => {
    test('should create retryable error', () => {
      const error = new RetryableError('Temporary failure');
      expect(error.name).toBe('RetryableError');
      expect(error.message).toBe('Temporary failure');
      expect(error.retryable).toBe(true);
    });

    test('should create retryable error with delay', () => {
      const error = new RetryableError('Rate limited', 5000);
      expect(error.retryDelay).toBe(5000);
    });

    test('should be instance of Error', () => {
      const error = new RetryableError('Test');
      expect(error).toBeInstanceOf(Error);
    });
  });

  // ============== defineWorker Basic Tests ==============

  describe('defineWorker - Basic', () => {
    test('should create worker instance', () => {
      const worker = defineWorker(TEST_QUEUE, async () => ({}), {
        autoStart: false,
        connection: { host: 'localhost', port: 6789 },
      });

      expect(worker).toBeDefined();
      expect(worker.queueName).toBe(TEST_QUEUE);
      expect(worker.isRunning).toBe(false);
      expect(worker.processing).toBe(0);
      expect(worker.processed).toBe(0);
      expect(typeof worker.workerId).toBe('string');
    });

    test('should start and stop worker', async () => {
      const worker = defineWorker(TEST_QUEUE, async () => ({}), {
        autoStart: false,
        connection: { host: 'localhost', port: 6789 },
      });

      await worker.start();
      expect(worker.isRunning).toBe(true);

      await worker.stop();
      expect(worker.isRunning).toBe(false);
    });

    test('should not auto-start when autoStart is false', () => {
      const worker = defineWorker(TEST_QUEUE, async () => ({}), {
        autoStart: false,
        connection: { host: 'localhost', port: 6789 },
      });

      expect(worker.isRunning).toBe(false);
    });

    test('should process job', async () => {
      let processedPayload: any = null;

      const worker = defineWorker<{ value: number }, { doubled: number }>(
        TEST_QUEUE,
        async (ctx) => {
          processedPayload = ctx.payload;
          return { doubled: ctx.payload.value * 2 };
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { value: 21 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(processedPayload).toEqual({ value: 21 });
    });

    test('should track processed count', async () => {
      const worker = defineWorker(
        TEST_QUEUE,
        async () => ({}),
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();

      for (let i = 0; i < 3; i++) {
        await client.push(TEST_QUEUE, { i });
      }

      await new Promise(r => setTimeout(r, 500));

      expect(worker.processed).toBe(3);
      await worker.stop();
    });
  });

  // ============== JobContext Tests ==============

  describe('defineWorker - JobContext', () => {
    test('should provide job ID in context', async () => {
      let receivedJobId: number | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          receivedJobId = ctx.jobId;
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      const job = await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(receivedJobId).toBe(job.id);
    });

    test('should provide payload in context', async () => {
      let receivedPayload: any;

      const worker = defineWorker<{ name: string; value: number }>(
        TEST_QUEUE,
        async (ctx) => {
          receivedPayload = ctx.payload;
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { name: 'test', value: 42 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(receivedPayload).toEqual({ name: 'test', value: 42 });
    });

    test('should provide queue name in context', async () => {
      let receivedQueue: string | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          receivedQueue = ctx.queueName;
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(receivedQueue).toBe(TEST_QUEUE);
    });

    test('should provide retry count in context', async () => {
      let receivedRetryCount: number | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          receivedRetryCount = ctx.retryCount;
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(receivedRetryCount).toBe(0); // First attempt = 0 retries
    });

    test('should provide max retries in context', async () => {
      let receivedMaxRetries: number | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          receivedMaxRetries = ctx.maxRetries;
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 }, { max_attempts: 5 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(receivedMaxRetries).toBe(5);
    });

    test('should provide priority in context', async () => {
      let receivedPriority: number | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          receivedPriority = ctx.priority;
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 }, { priority: 100 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(receivedPriority).toBe(100);
    });

    test('should provide tags in context', async () => {
      let receivedTags: string[] | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          receivedTags = ctx.tags;
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 }, { tags: ['important', 'email'] });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(receivedTags).toEqual(['important', 'email']);
    });

    test('should provide abort signal in context', async () => {
      let receivedSignal: AbortSignal | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          receivedSignal = ctx.signal;
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });

    test('should provide error classes in context', async () => {
      let hasNonRetryable = false;
      let hasRetryable = false;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          hasNonRetryable = ctx.NonRetryableError === NonRetryableError;
          hasRetryable = ctx.RetryableError === RetryableError;
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(hasNonRetryable).toBe(true);
      expect(hasRetryable).toBe(true);
    });

    test('should call progress method', async () => {
      let progressCalled = false;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          await ctx.progress(50, 'Halfway there');
          progressCalled = true;
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(progressCalled).toBe(true);
    });

    test('should call heartbeat method', async () => {
      let heartbeatCalled = false;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          await ctx.heartbeat();
          heartbeatCalled = true;
          return {};
        },
        {
          autoStart: false,
          connection: { host: 'localhost', port: 6789 },
          heartbeatInterval: 0, // Disable auto-heartbeat
        }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(heartbeatCalled).toBe(true);
    });
  });

  // ============== Events Tests ==============

  describe('defineWorker - Events', () => {
    test('should emit ready event', async () => {
      let readyEmitted = false;

      const worker = defineWorker(
        TEST_QUEUE,
        async () => ({}),
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      worker.on('ready', () => {
        readyEmitted = true;
      });

      await worker.start();
      expect(readyEmitted).toBe(true);
      await worker.stop();
    });

    test('should emit stopping and stopped events', async () => {
      const events: string[] = [];

      const worker = defineWorker(
        TEST_QUEUE,
        async () => ({}),
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      worker.on('stopping', () => events.push('stopping'));
      worker.on('stopped', () => events.push('stopped'));

      await worker.start();
      await worker.stop();

      expect(events).toContain('stopping');
      expect(events).toContain('stopped');
    });

    test('should emit job:claimed event', async () => {
      let claimedJobId: number | undefined;
      let claimedQueue: string | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async () => ({}),
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      worker.on('job:claimed', (jobId, queueName) => {
        claimedJobId = jobId;
        claimedQueue = queueName;
      });

      await worker.start();
      const job = await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(claimedJobId).toBe(job.id);
      expect(claimedQueue).toBe(TEST_QUEUE);
    });

    test('should emit job:started event', async () => {
      let startedJobId: number | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async () => ({}),
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      worker.on('job:started', (jobId) => {
        startedJobId = jobId;
      });

      await worker.start();
      const job = await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(startedJobId).toBe(job.id);
    });

    test('should emit job:completed event', async () => {
      let completedJobId: number | undefined;
      let completedResult: any;

      const worker = defineWorker(
        TEST_QUEUE,
        async () => ({ result: 'success' }),
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      worker.on('job:completed', (jobId, result) => {
        completedJobId = jobId;
        completedResult = result;
      });

      await worker.start();
      const job = await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(completedJobId).toBe(job.id);
      expect(completedResult).toEqual({ result: 'success' });
    });

    test('should emit job:failed event', async () => {
      let failedJobId: number | undefined;
      let failedError: Error | undefined;
      let willRetry: boolean | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async () => {
          throw new Error('Test failure');
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      worker.on('job:failed', (jobId, error, retry) => {
        failedJobId = jobId;
        failedError = error;
        willRetry = retry;
      });

      await worker.start();
      const job = await client.push(TEST_QUEUE, { data: 1 }, { max_attempts: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(failedJobId).toBe(job.id);
      expect(failedError?.message).toBe('Test failure');
      expect(willRetry).toBe(false); // max_attempts: 1 means no retry
    });

    test('should emit job:progress event', async () => {
      let progressJobId: number | undefined;
      let progressPercent: number | undefined;
      let progressMessage: string | undefined;

      const worker = defineWorker(
        TEST_QUEUE,
        async (ctx) => {
          await ctx.progress(75, 'Almost done');
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      worker.on('job:progress', (jobId, percent, message) => {
        progressJobId = jobId;
        progressPercent = percent;
        progressMessage = message;
      });

      await worker.start();
      const job = await client.push(TEST_QUEUE, { data: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(progressJobId).toBe(job.id);
      expect(progressPercent).toBe(75);
      expect(progressMessage).toBe('Almost done');
    });
  });

  // ============== Error Handling Tests ==============

  describe('defineWorker - Error Handling', () => {
    test('should not retry NonRetryableError', async () => {
      let attempts = 0;

      const worker = defineWorker(
        TEST_QUEUE,
        async () => {
          attempts++;
          throw new NonRetryableError('Invalid input');
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 }, { max_attempts: 5 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(attempts).toBe(1); // Should not retry
    });

    test('should retry regular errors', async () => {
      let attempts = 0;

      const worker = defineWorker(
        TEST_QUEUE,
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return {};
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 }, { max_attempts: 5, backoff: 50 });

      await new Promise(r => setTimeout(r, 1000));
      await worker.stop();

      expect(attempts).toBe(3); // Retry until success
    });

    test('should move to DLQ after max attempts', async () => {
      const worker = defineWorker(
        TEST_QUEUE,
        async () => {
          throw new Error('Always fails');
        },
        { autoStart: false, connection: { host: 'localhost', port: 6789 } }
      );

      await worker.start();
      const job = await client.push(TEST_QUEUE, { data: 1 }, { max_attempts: 1 });

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      const state = await client.getState(job.id);
      expect(state).toBe('failed');
    });
  });

  // ============== Concurrency Tests ==============

  describe('defineWorker - Concurrency', () => {
    test('should process jobs concurrently', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const worker = defineWorker(
        TEST_QUEUE,
        async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise(r => setTimeout(r, 100));
          currentConcurrent--;
          return {};
        },
        {
          autoStart: false,
          concurrency: 3,
          connection: { host: 'localhost', port: 6789 },
        }
      );

      await worker.start();

      for (let i = 0; i < 6; i++) {
        await client.push(TEST_QUEUE, { i });
      }

      await new Promise(r => setTimeout(r, 500));
      await worker.stop();

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    test('should track processing count', async () => {
      let observedProcessing = 0;

      const worker = defineWorker(
        TEST_QUEUE,
        async () => {
          observedProcessing = Math.max(observedProcessing, worker.processing);
          await new Promise(r => setTimeout(r, 100));
          return {};
        },
        {
          autoStart: false,
          concurrency: 2,
          connection: { host: 'localhost', port: 6789 },
        }
      );

      await worker.start();

      for (let i = 0; i < 4; i++) {
        await client.push(TEST_QUEUE, { i });
      }

      await new Promise(r => setTimeout(r, 300));
      await worker.stop();

      expect(observedProcessing).toBeGreaterThan(0);
      expect(observedProcessing).toBeLessThanOrEqual(2);
    });
  });

  // ============== defineWorkers Tests ==============

  describe('defineWorkers - Multiple Workers', () => {
    const QUEUE_A = 'test-define-a';
    const QUEUE_B = 'test-define-b';

    afterEach(async () => {
      await client.obliterate(QUEUE_A);
      await client.obliterate(QUEUE_B);
    });

    test('should create multiple workers', () => {
      const workers = defineWorkers(
        {
          [QUEUE_A]: async () => ({ queue: 'a' }),
          [QUEUE_B]: async () => ({ queue: 'b' }),
        },
        {
          autoStart: false,
          connection: { host: 'localhost', port: 6789 },
        }
      );

      expect(workers).toHaveLength(2);
      expect(workers[0].queueName).toBe(QUEUE_A);
      expect(workers[1].queueName).toBe(QUEUE_B);
    });

    test('should accept object config with handler and concurrency', () => {
      const workers = defineWorkers(
        {
          [QUEUE_A]: async () => ({}),
          [QUEUE_B]: {
            handler: async () => ({}),
            concurrency: 5,
          },
        },
        {
          autoStart: false,
          connection: { host: 'localhost', port: 6789 },
        }
      );

      expect(workers).toHaveLength(2);
    });

    test('should process jobs from multiple queues', async () => {
      const processed: string[] = [];

      const workers = defineWorkers(
        {
          [QUEUE_A]: async () => {
            processed.push('A');
            return {};
          },
          [QUEUE_B]: async () => {
            processed.push('B');
            return {};
          },
        },
        {
          autoStart: false,
          connection: { host: 'localhost', port: 6789 },
        }
      );

      for (const worker of workers) {
        await worker.start();
      }

      await client.push(QUEUE_A, { queue: 'A' });
      await client.push(QUEUE_B, { queue: 'B' });

      await new Promise(r => setTimeout(r, 500));

      for (const worker of workers) {
        await worker.stop();
      }

      expect(processed).toContain('A');
      expect(processed).toContain('B');
    });
  });

  // ============== Options Tests ==============

  describe('defineWorker - Options', () => {
    test('should respect pollInterval', async () => {
      const worker = defineWorker(
        TEST_QUEUE,
        async () => ({}),
        {
          autoStart: false,
          pollInterval: 2000,
          connection: { host: 'localhost', port: 6789 },
        }
      );

      // Just verify it starts without error
      await worker.start();
      await worker.stop();
    });

    test('should respect shutdownTimeout', async () => {
      const worker = defineWorker(
        TEST_QUEUE,
        async () => {
          await new Promise(r => setTimeout(r, 100));
          return {};
        },
        {
          autoStart: false,
          shutdownTimeout: 5000,
          connection: { host: 'localhost', port: 6789 },
        }
      );

      await worker.start();
      await client.push(TEST_QUEUE, { data: 1 });

      // Start processing then stop
      await new Promise(r => setTimeout(r, 50));
      await worker.stop(); // Should wait for job to complete
    });

    test('should use custom connection options', async () => {
      const worker = defineWorker(
        TEST_QUEUE,
        async () => ({}),
        {
          autoStart: false,
          connection: {
            host: 'localhost',
            port: 6789,
            timeout: 10000,
          },
        }
      );

      await worker.start();
      expect(worker.isRunning).toBe(true);
      await worker.stop();
    });
  });
});
