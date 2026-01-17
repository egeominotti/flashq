/**
 * FlashQ Advanced Features Tests
 *
 * Tests for CircuitBreaker, Workflows, retry with jitter, and namespace APIs.
 *
 * Run: bun test tests/advanced.test.ts
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { FlashQ } from '../src/client';
import {
  CircuitBreaker,
  retry,
  calculateBackoff,
  Workflows,
  FlashQClient,
  JobsAPI,
  QueuesAPI,
  SchedulesAPI,
} from '../src/advanced';

const TEST_QUEUE = 'test-advanced';

// ============== Circuit Breaker Tests ==============

describe('CircuitBreaker', () => {
  describe('State Management', () => {
    test('should start in closed state', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getState()).toBe('closed');
    });

    test('should be available when closed', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.isAvailable()).toBe(true);
    });

    test('should open after failure threshold', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
      });

      const failFn = async () => {
        throw new Error('Fail');
      };

      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failFn);
        } catch {}
      }

      expect(breaker.getState()).toBe('open');
      expect(breaker.isAvailable()).toBe(false);
    });

    test('should throw when circuit is open', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        timeout: 10000, // Long timeout so it doesn't auto-close
      });

      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch {}

      expect(breaker.getState()).toBe('open');

      try {
        await breaker.execute(async () => 'success');
        expect(true).toBe(false); // Should not reach
      } catch (e) {
        expect((e as Error).message).toBe('Circuit breaker is open');
      }
    });

    test('should transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        timeout: 100, // Short timeout
      });

      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch {}

      expect(breaker.getState()).toBe('open');

      // Wait for timeout
      await new Promise(r => setTimeout(r, 150));

      // isAvailable() triggers transition to half-open
      expect(breaker.isAvailable()).toBe(true);
      expect(breaker.getState()).toBe('half-open');
    });

    test('should close after success threshold in half-open', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 50,
      });

      // Open the circuit
      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch {}

      // Wait for half-open
      await new Promise(r => setTimeout(r, 100));

      // Succeed twice
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      expect(breaker.getState()).toBe('closed');
    });

    test('should reopen on failure in half-open', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        timeout: 50,
      });

      // Open the circuit
      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch {}

      // Wait for half-open
      await new Promise(r => setTimeout(r, 100));

      // Trigger transition to half-open by checking availability
      breaker.isAvailable();

      expect(breaker.getState()).toBe('half-open');

      // Fail in half-open
      try {
        await breaker.execute(async () => {
          throw new Error('Fail again');
        });
      } catch {}

      expect(breaker.getState()).toBe('open');
    });
  });

  describe('Callbacks', () => {
    test('should call onOpen when circuit opens', async () => {
      let called = false;
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        onOpen: () => {
          called = true;
        },
      });

      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch {}

      expect(called).toBe(true);
    });

    test('should call onClose when circuit closes', async () => {
      let called = false;
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 50,
        onClose: () => {
          called = true;
        },
      });

      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch {}

      await new Promise(r => setTimeout(r, 100));
      await breaker.execute(async () => 'success');

      expect(called).toBe(true);
    });

    test('should call onHalfOpen when transitioning to half-open', async () => {
      let called = false;
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        timeout: 50,
        onHalfOpen: () => {
          called = true;
        },
      });

      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch {}

      await new Promise(r => setTimeout(r, 100));
      breaker.isAvailable(); // Triggers transition

      expect(called).toBe(true);
    });
  });

  describe('Reset', () => {
    test('should reset to closed state', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
      });

      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch {}

      expect(breaker.getState()).toBe('open');

      breaker.reset();

      expect(breaker.getState()).toBe('closed');
      expect(breaker.isAvailable()).toBe(true);
    });
  });

  describe('Successful Execution', () => {
    test('should return result on success', async () => {
      const breaker = new CircuitBreaker();

      const result = await breaker.execute(async () => {
        return { value: 42 };
      });

      expect(result).toEqual({ value: 42 });
    });

    test('should reset failure count on success', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
      });

      // Fail twice
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch {}
      }

      // Succeed
      await breaker.execute(async () => 'success');

      // Fail twice more - should not open because count was reset
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Fail');
          });
        } catch {}
      }

      expect(breaker.getState()).toBe('closed');
    });
  });
});

// ============== Retry with Jitter Tests ==============

describe('Retry with Jitter', () => {
  describe('calculateBackoff', () => {
    test('should calculate exponential backoff', () => {
      const options = { baseDelay: 1000, factor: 2, jitter: false };

      expect(calculateBackoff(1, options)).toBe(1000);
      expect(calculateBackoff(2, options)).toBe(2000);
      expect(calculateBackoff(3, options)).toBe(4000);
      expect(calculateBackoff(4, options)).toBe(8000);
    });

    test('should cap at maxDelay', () => {
      const options = { baseDelay: 1000, factor: 2, maxDelay: 5000, jitter: false };

      expect(calculateBackoff(10, options)).toBe(5000);
    });

    test('should add jitter when enabled', () => {
      const options = { baseDelay: 1000, jitter: true };

      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(calculateBackoff(1, options));
      }

      // With jitter, we should get different values
      expect(delays.size).toBeGreaterThan(1);
    });

    test('should use default values', () => {
      const delay = calculateBackoff(1);
      // Default baseDelay is 1000, with jitter it should be around 750-1250
      expect(delay).toBeGreaterThanOrEqual(750);
      expect(delay).toBeLessThanOrEqual(1250);
    });
  });

  describe('retry function', () => {
    test('should return result on first success', async () => {
      const result = await retry(async () => {
        return { success: true };
      });

      expect(result).toEqual({ success: true });
    });

    test('should retry on failure', async () => {
      let attempts = 0;

      const result = await retry(
        async () => {
          attempts++;
          if (attempts < 3) throw new Error('Fail');
          return { success: true };
        },
        { maxRetries: 5, baseDelay: 10 }
      );

      expect(result).toEqual({ success: true });
      expect(attempts).toBe(3);
    });

    test('should throw after max retries', async () => {
      let attempts = 0;

      try {
        await retry(
          async () => {
            attempts++;
            throw new Error('Always fails');
          },
          { maxRetries: 3, baseDelay: 10 }
        );
        expect(true).toBe(false); // Should not reach
      } catch (e) {
        expect((e as Error).message).toBe('Always fails');
        expect(attempts).toBe(4); // 1 initial + 3 retries
      }
    });

    test('should call onRetry callback', async () => {
      const retries: { attempt: number; delay: number }[] = [];

      try {
        await retry(
          async () => {
            throw new Error('Fail');
          },
          {
            maxRetries: 2,
            baseDelay: 10,
            onRetry: (err, attempt, delay) => {
              retries.push({ attempt, delay });
            },
          }
        );
      } catch {}

      expect(retries.length).toBe(2);
      expect(retries[0].attempt).toBe(1);
      expect(retries[1].attempt).toBe(2);
    });

    test('should respect retryOn predicate', async () => {
      let attempts = 0;

      try {
        await retry(
          async () => {
            attempts++;
            const err = new Error('Non-retryable');
            (err as any).code = 'FATAL';
            throw err;
          },
          {
            maxRetries: 5,
            baseDelay: 10,
            retryOn: (err) => (err as any).code !== 'FATAL',
          }
        );
      } catch {}

      expect(attempts).toBe(1); // No retries because retryOn returned false
    });
  });
});

// ============== Workflows Tests ==============

describe('Workflows', () => {
  let client: FlashQ;
  let workflows: Workflows;

  beforeAll(async () => {
    client = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await client.connect();
    workflows = new Workflows(client);
  });

  afterAll(async () => {
    await client.obliterate(TEST_QUEUE);
    await client.close();
  });

  beforeEach(async () => {
    await client.obliterate(TEST_QUEUE);
  });

  describe('Workflow Creation', () => {
    test('should create simple workflow', async () => {
      const instance = await workflows.create({
        name: 'Simple Workflow',
        jobs: [
          { key: 'step1', queue: TEST_QUEUE, data: { step: 1 } },
          { key: 'step2', queue: TEST_QUEUE, data: { step: 2 } },
        ],
      });

      expect(instance.name).toBe('Simple Workflow');
      expect(instance.jobIds.step1).toBeGreaterThan(0);
      expect(instance.jobIds.step2).toBeGreaterThan(0);
    });

    test('should create workflow with dependencies', async () => {
      const instance = await workflows.create({
        name: 'Dependent Workflow',
        jobs: [
          { key: 'extract', queue: TEST_QUEUE, data: { phase: 'extract' } },
          { key: 'transform', queue: TEST_QUEUE, data: { phase: 'transform' }, dependsOn: ['extract'] },
          { key: 'load', queue: TEST_QUEUE, data: { phase: 'load' }, dependsOn: ['transform'] },
        ],
      });

      expect(instance.jobIds.extract).toBeGreaterThan(0);
      expect(instance.jobIds.transform).toBeGreaterThan(0);
      expect(instance.jobIds.load).toBeGreaterThan(0);
    });

    test('should create workflow with multiple dependencies', async () => {
      const instance = await workflows.create({
        name: 'Multi-dependency Workflow',
        jobs: [
          { key: 'a', queue: TEST_QUEUE, data: { id: 'a' } },
          { key: 'b', queue: TEST_QUEUE, data: { id: 'b' } },
          { key: 'c', queue: TEST_QUEUE, data: { id: 'c' }, dependsOn: ['a', 'b'] },
        ],
      });

      expect(Object.keys(instance.jobIds)).toHaveLength(3);
    });

    test('should detect circular dependencies', async () => {
      try {
        await workflows.create({
          name: 'Circular Workflow',
          jobs: [
            { key: 'a', queue: TEST_QUEUE, data: { id: 'a' }, dependsOn: ['c'] },
            { key: 'b', queue: TEST_QUEUE, data: { id: 'b' }, dependsOn: ['a'] },
            { key: 'c', queue: TEST_QUEUE, data: { id: 'c' }, dependsOn: ['b'] },
          ],
        });
        expect(true).toBe(false); // Should not reach
      } catch (e) {
        expect((e as Error).message).toContain('Circular dependency');
      }
    });

    test('should pass job options', async () => {
      const instance = await workflows.create({
        name: 'Options Workflow',
        jobs: [
          {
            key: 'priority-job',
            queue: TEST_QUEUE,
            data: { priority: true },
            options: { priority: 100 },
          },
        ],
      });

      const job = await client.getJob(instance.jobIds['priority-job']);
      expect(job!.job.priority).toBe(100);
    });
  });

  describe('Workflow Status', () => {
    test('should get workflow status', async () => {
      const instance = await workflows.create({
        name: 'Status Workflow',
        jobs: [
          { key: 'job1', queue: TEST_QUEUE, data: { id: 1 } },
          { key: 'job2', queue: TEST_QUEUE, data: { id: 2 } },
        ],
      });

      // Verify jobs were created
      expect(instance.jobIds.job1).toBeGreaterThan(0);
      expect(instance.jobIds.job2).toBeGreaterThan(0);

      // Get individual job states
      const state1 = await client.getState(instance.jobIds.job1);
      const state2 = await client.getState(instance.jobIds.job2);

      expect(['waiting', 'delayed', 'waiting-children']).toContain(state1);
      expect(['waiting', 'delayed', 'waiting-children']).toContain(state2);
    });
  });

  describe('Workflow Cancel', () => {
    test('should cancel workflow jobs', async () => {
      const instance = await workflows.create({
        name: 'Cancel Workflow',
        jobs: [
          { key: 'job1', queue: TEST_QUEUE, data: { id: 1 } },
          { key: 'job2', queue: TEST_QUEUE, data: { id: 2 } },
        ],
      });

      const cancelled = await workflows.cancel(instance);
      expect(cancelled).toBe(2);
    });
  });
});

// ============== Namespace API Tests ==============

describe('Namespace APIs', () => {
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

  describe('JobsAPI', () => {
    test('should create job', async () => {
      const jobs = new JobsAPI(client);
      const job = await jobs.create(TEST_QUEUE, { data: 1 });
      expect(job.id).toBeGreaterThan(0);
    });

    test('should create bulk jobs', async () => {
      const jobs = new JobsAPI(client);
      const ids = await jobs.createBulk(TEST_QUEUE, [
        { data: { i: 1 } },
        { data: { i: 2 } },
      ]);
      expect(ids).toHaveLength(2);
    });

    test('should get job', async () => {
      const jobs = new JobsAPI(client);
      const created = await jobs.create(TEST_QUEUE, { data: 1 });
      const retrieved = await jobs.get(created.id);
      expect(retrieved!.job.id).toBe(created.id);
    });

    test('should get job by custom ID', async () => {
      const jobs = new JobsAPI(client);
      const customId = `api-${Date.now()}`;
      await jobs.create(TEST_QUEUE, { data: 1 }, { jobId: customId });
      const retrieved = await jobs.getByCustomId(customId);
      expect(retrieved!.job.custom_id).toBe(customId);
    });

    test('should get batch of jobs', async () => {
      const jobs = new JobsAPI(client);
      const ids = await jobs.createBulk(TEST_QUEUE, [
        { data: { i: 1 } },
        { data: { i: 2 } },
      ]);
      const batch = await jobs.getBatch(ids);
      expect(batch).toHaveLength(2);
    });

    test('should get job state', async () => {
      const jobs = new JobsAPI(client);
      const created = await jobs.create(TEST_QUEUE, { data: 1 });
      const state = await jobs.getState(created.id);
      expect(state).toBe('waiting');
    });

    test('should get job result', async () => {
      const jobs = new JobsAPI(client);
      const created = await jobs.create(TEST_QUEUE, { data: 1 });
      const pulled = await client.pull(TEST_QUEUE, 1000);
      await client.ack(pulled!.id, { result: 'done' });
      const result = await jobs.getResult<{ result: string }>(created.id);
      expect(result).toEqual({ result: 'done' });
    });

    test('should cancel job', async () => {
      const jobs = new JobsAPI(client);
      const created = await jobs.create(TEST_QUEUE, { data: 1 });
      await jobs.cancel(created.id);
      const state = await jobs.getState(created.id);
      expect([null, 'unknown']).toContain(state);
    });

    test('should update job data', async () => {
      const jobs = new JobsAPI(client);
      const created = await jobs.create(TEST_QUEUE, { original: true });
      await jobs.update(created.id, { updated: true });
      const retrieved = await jobs.get(created.id);
      expect(retrieved!.job.data).toEqual({ updated: true });
    });

    test('should change job priority', async () => {
      const jobs = new JobsAPI(client);
      const created = await jobs.create(TEST_QUEUE, { data: 1 }, { priority: 0 });
      await jobs.changePriority(created.id, 100);
      const retrieved = await jobs.get(created.id);
      expect(retrieved!.job.priority).toBe(100);
    });

    test('should move job to delayed', async () => {
      const jobs = new JobsAPI(client);
      const created = await jobs.create(TEST_QUEUE, { data: 1 });
      const pulled = await client.pull(TEST_QUEUE, 1000);
      await jobs.moveToDelayed(pulled!.id, 5000);
      const state = await jobs.getState(pulled!.id);
      expect(state).toBe('delayed');
    });

    test('should promote delayed job', async () => {
      const jobs = new JobsAPI(client);
      const created = await jobs.create(TEST_QUEUE, { data: 1 }, { delay: 60000 });
      await jobs.promote(created.id);
      const state = await jobs.getState(created.id);
      expect(state).toBe('waiting');
    });

    test('should discard job', async () => {
      const jobs = new JobsAPI(client);
      const created = await jobs.create(TEST_QUEUE, { data: 1 });
      await jobs.discard(created.id);
      const state = await jobs.getState(created.id);
      expect(state).toBe('failed');
    });

    test('should update job progress', async () => {
      const jobs = new JobsAPI(client);
      await jobs.create(TEST_QUEUE, { data: 1 });
      const pulled = await client.pull(TEST_QUEUE, 1000);
      await jobs.progress(pulled!.id, 50, 'Halfway');
      const progress = await jobs.getProgress(pulled!.id);
      expect(progress.progress).toBe(50);
      await client.ack(pulled!.id);
    });

    test('should list jobs', async () => {
      const jobs = new JobsAPI(client);
      await jobs.create(TEST_QUEUE, { data: 1 });
      await jobs.create(TEST_QUEUE, { data: 2 });
      const result = await jobs.list({ queue: TEST_QUEUE });
      expect(result.jobs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('QueuesAPI', () => {
    test('should list queues', async () => {
      const queues = new QueuesAPI(client);
      await client.push(TEST_QUEUE, { data: 1 });
      const list = await queues.list();
      expect(list.some(q => q.name === TEST_QUEUE)).toBe(true);
    });

    test('should pause and resume queue', async () => {
      const queues = new QueuesAPI(client);
      await queues.pause(TEST_QUEUE);
      expect(await queues.isPaused(TEST_QUEUE)).toBe(true);
      await queues.resume(TEST_QUEUE);
      expect(await queues.isPaused(TEST_QUEUE)).toBe(false);
    });

    test('should get queue count', async () => {
      const queues = new QueuesAPI(client);
      await client.push(TEST_QUEUE, { data: 1 });
      await client.push(TEST_QUEUE, { data: 2 });
      const count = await queues.count(TEST_QUEUE);
      expect(count).toBe(2);
    });

    test('should get job counts by state', async () => {
      const queues = new QueuesAPI(client);
      await client.push(TEST_QUEUE, { data: 1 });
      const counts = await queues.getJobCounts(TEST_QUEUE);
      expect(counts.waiting).toBeGreaterThanOrEqual(1);
    });

    test('should set and clear rate limit', async () => {
      const queues = new QueuesAPI(client);
      await queues.setRateLimit(TEST_QUEUE, 100);
      await queues.clearRateLimit(TEST_QUEUE);
    });

    test('should set and clear concurrency', async () => {
      const queues = new QueuesAPI(client);
      await queues.setConcurrency(TEST_QUEUE, 5);
      await queues.clearConcurrency(TEST_QUEUE);
    });

    test('should drain queue', async () => {
      const queues = new QueuesAPI(client);
      await client.push(TEST_QUEUE, { data: 1 });
      await client.push(TEST_QUEUE, { data: 2 });
      const drained = await queues.drain(TEST_QUEUE);
      expect(drained).toBeGreaterThanOrEqual(2);
    });

    test('should obliterate queue', async () => {
      const queues = new QueuesAPI(client);
      const tempQueue = 'test-obliterate-api';
      await client.push(tempQueue, { data: 1 });
      const removed = await queues.obliterate(tempQueue);
      expect(removed).toBeGreaterThanOrEqual(1);
    });

    test('should clean jobs', async () => {
      const queues = new QueuesAPI(client);
      await client.push(TEST_QUEUE, { data: 1 });
      const pulled = await client.pull(TEST_QUEUE, 1000);
      if (pulled) await client.ack(pulled.id);
      const cleaned = await queues.clean(TEST_QUEUE, 0, 'completed');
      expect(cleaned).toBeGreaterThanOrEqual(0);
    });

    describe('DLQ Operations', () => {
      test('should list DLQ jobs', async () => {
        const queues = new QueuesAPI(client);
        await client.push(TEST_QUEUE, { dlq: true }, { max_attempts: 1 });
        const pulled = await client.pull(TEST_QUEUE, 1000);
        if (pulled) await client.fail(pulled.id, 'Test failure');
        const dlqJobs = await queues.dlq.list(TEST_QUEUE);
        expect(dlqJobs.length).toBeGreaterThanOrEqual(1);
      });

      test('should retry DLQ jobs', async () => {
        const queues = new QueuesAPI(client);
        await client.push(TEST_QUEUE, { retry: true }, { max_attempts: 1 });
        const pulled = await client.pull(TEST_QUEUE, 1000);
        if (pulled) await client.fail(pulled.id, 'Test failure');
        const retried = await queues.dlq.retry(TEST_QUEUE);
        expect(retried).toBeGreaterThanOrEqual(0);
      });

      test('should purge DLQ', async () => {
        const queues = new QueuesAPI(client);
        await client.push(TEST_QUEUE, { purge: true }, { max_attempts: 1 });
        const pulled = await client.pull(TEST_QUEUE, 1000);
        if (pulled) await client.fail(pulled.id, 'Test failure');
        const purged = await queues.dlq.purge(TEST_QUEUE);
        expect(purged).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('SchedulesAPI', () => {
    const SCHEDULE_NAME = 'test-schedule';

    afterEach(async () => {
      try {
        const schedules = new SchedulesAPI(client);
        await schedules.delete(SCHEDULE_NAME);
      } catch {}
    });

    test('should create schedule', async () => {
      const schedules = new SchedulesAPI(client);
      await schedules.create(SCHEDULE_NAME, {
        queue: TEST_QUEUE,
        data: { scheduled: true },
        schedule: '0 * * * * *',
      });
      const list = await schedules.list();
      expect(list.some(s => s.name === SCHEDULE_NAME)).toBe(true);
    });

    test('should list schedules', async () => {
      const schedules = new SchedulesAPI(client);
      const list = await schedules.list();
      expect(Array.isArray(list)).toBe(true);
    });

    test('should delete schedule', async () => {
      const schedules = new SchedulesAPI(client);
      await schedules.create('temp-schedule', {
        queue: TEST_QUEUE,
        data: {},
        schedule: '0 0 * * * *',
      });
      const deleted = await schedules.delete('temp-schedule');
      expect(deleted).toBe(true);
    });
  });
});

// ============== FlashQClient (Main Wrapper) Tests ==============

describe('FlashQClient', () => {
  let flashq: FlashQClient;

  beforeAll(async () => {
    flashq = new FlashQClient({ host: 'localhost', port: 6789, timeout: 10000 });
    await flashq.connect();
  });

  afterAll(async () => {
    await flashq.raw.obliterate(TEST_QUEUE);
    await flashq.close();
  });

  beforeEach(async () => {
    await flashq.raw.obliterate(TEST_QUEUE);
  });

  describe('Connection', () => {
    test('should connect and check status', () => {
      expect(flashq.isConnected()).toBe(true);
    });

    test('should expose raw client', () => {
      expect(flashq.raw).toBeInstanceOf(FlashQ);
    });
  });

  describe('Namespaces', () => {
    test('should access jobs API', () => {
      expect(flashq.jobs).toBeInstanceOf(JobsAPI);
    });

    test('should access queues API', () => {
      expect(flashq.queues).toBeInstanceOf(QueuesAPI);
    });

    test('should access schedules API', () => {
      expect(flashq.schedules).toBeInstanceOf(SchedulesAPI);
    });

    test('should access workflows API', () => {
      expect(flashq.workflows).toBeInstanceOf(Workflows);
    });
  });

  describe('Stats and Metrics', () => {
    test('should get stats', async () => {
      const stats = await flashq.stats();
      expect(stats).toHaveProperty('queued');
      expect(stats).toHaveProperty('processing');
      expect(stats).toHaveProperty('delayed');
      expect(stats).toHaveProperty('dlq');
    });

    test('should get metrics', async () => {
      const metrics = await flashq.metrics();
      expect(metrics).toHaveProperty('total_pushed');
    });
  });

  describe('Circuit Breaker Integration', () => {
    test('should create client with circuit breaker', async () => {
      const clientWithBreaker = new FlashQClient({
        host: 'localhost',
        port: 6789,
        circuitBreaker: {
          failureThreshold: 5,
          successThreshold: 3,
          timeout: 30000,
        },
      });

      expect(clientWithBreaker.circuitBreaker).toBeInstanceOf(CircuitBreaker);
      await clientWithBreaker.close();
    });

    test('should not have circuit breaker by default', () => {
      expect(flashq.circuitBreaker).toBeUndefined();
    });
  });

  describe('Full Workflow', () => {
    test('should complete full workflow through namespace APIs', async () => {
      // Create job through jobs API
      const job = await flashq.jobs.create(TEST_QUEUE, { workflow: 'test' });
      expect(job.id).toBeGreaterThan(0);

      // Check queue count
      const count = await flashq.queues.count(TEST_QUEUE);
      expect(count).toBe(1);

      // Get job state
      const state = await flashq.jobs.getState(job.id);
      expect(state).toBe('waiting');

      // Process job
      const pulled = await flashq.raw.pull(TEST_QUEUE, 1000);
      await flashq.raw.ack(pulled!.id, { done: true });

      // Verify completion
      const finalState = await flashq.jobs.getState(job.id);
      expect(finalState).toBe('completed');
    });
  });
});
