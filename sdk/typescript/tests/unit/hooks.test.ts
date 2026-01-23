/**
 * Hooks System Tests
 *
 * Tests for the observability hooks system used for OpenTelemetry,
 * DataDog, and custom metrics integration.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import {
  callHook,
  callErrorHook,
  createHookContext,
  getDuration,
  type HookContext,
  type PushHookContext,
  type PullHookContext,
  type AckHookContext,
  type FailHookContext,
  type ProcessHookContext,
  type BatchPushHookContext,
  type BatchPullHookContext,
  type ConnectionHookContext,
  type ClientHooks,
  type WorkerHooks,
  type Hook,
  type ErrorHook,
} from '../../src/hooks';

describe('createHookContext', () => {
  test('creates context with startTime', () => {
    const before = Date.now();
    const ctx = createHookContext<HookContext>({});
    const after = Date.now();

    expect(ctx.startTime).toBeGreaterThanOrEqual(before);
    expect(ctx.startTime).toBeLessThanOrEqual(after);
  });

  test('preserves additional data', () => {
    const ctx = createHookContext<PushHookContext>({
      queue: 'test-queue',
      data: { foo: 'bar' },
      options: { priority: 10 },
    });

    expect(ctx.queue).toBe('test-queue');
    expect(ctx.data).toEqual({ foo: 'bar' });
    expect(ctx.options?.priority).toBe(10);
    expect(ctx.startTime).toBeDefined();
  });

  test('creates PullHookContext correctly', () => {
    const ctx = createHookContext<PullHookContext>({
      queue: 'pull-queue',
      timeout: 5000,
    });

    expect(ctx.queue).toBe('pull-queue');
    expect(ctx.timeout).toBe(5000);
    expect(ctx.job).toBeUndefined();
  });

  test('creates AckHookContext correctly', () => {
    const ctx = createHookContext<AckHookContext>({
      jobId: 123,
      result: { success: true },
    });

    expect(ctx.jobId).toBe(123);
    expect(ctx.result).toEqual({ success: true });
  });

  test('creates FailHookContext correctly', () => {
    const ctx = createHookContext<FailHookContext>({
      jobId: 456,
      error: 'Something went wrong',
    });

    expect(ctx.jobId).toBe(456);
    expect(ctx.error).toBe('Something went wrong');
  });

  test('creates ProcessHookContext correctly', () => {
    const job = {
      id: 1,
      queue: 'test',
      data: {},
      state: 'active' as const,
      created_at: Date.now(),
    };
    const ctx = createHookContext<ProcessHookContext>({
      job,
      workerId: 0,
    });

    expect(ctx.job).toBe(job);
    expect(ctx.workerId).toBe(0);
    expect(ctx.result).toBeUndefined();
    expect(ctx.error).toBeUndefined();
  });

  test('creates BatchPushHookContext correctly', () => {
    const ctx = createHookContext<BatchPushHookContext>({
      queue: 'batch-queue',
      count: 100,
    });

    expect(ctx.queue).toBe('batch-queue');
    expect(ctx.count).toBe(100);
    expect(ctx.ids).toBeUndefined();
    expect(ctx.failedCount).toBeUndefined();
  });

  test('creates BatchPullHookContext correctly', () => {
    const ctx = createHookContext<BatchPullHookContext>({
      queue: 'batch-pull',
      count: 50,
      timeout: 1000,
    });

    expect(ctx.queue).toBe('batch-pull');
    expect(ctx.count).toBe(50);
    expect(ctx.timeout).toBe(1000);
    expect(ctx.jobs).toBeUndefined();
  });

  test('creates ConnectionHookContext correctly', () => {
    const ctx = createHookContext<ConnectionHookContext>({
      host: 'localhost',
      port: 6789,
      event: 'connect',
    });

    expect(ctx.host).toBe('localhost');
    expect(ctx.port).toBe(6789);
    expect(ctx.event).toBe('connect');
    expect(ctx.error).toBeUndefined();
    expect(ctx.attempt).toBeUndefined();
  });

  test('creates ConnectionHookContext with error event', () => {
    const error = new Error('Connection refused');
    const ctx = createHookContext<ConnectionHookContext>({
      host: 'localhost',
      port: 6789,
      event: 'error',
      error,
    });

    expect(ctx.event).toBe('error');
    expect(ctx.error).toBe(error);
  });

  test('creates ConnectionHookContext with reconnecting event', () => {
    const ctx = createHookContext<ConnectionHookContext>({
      host: 'localhost',
      port: 6789,
      event: 'reconnecting',
      attempt: 3,
    });

    expect(ctx.event).toBe('reconnecting');
    expect(ctx.attempt).toBe(3);
  });
});

describe('getDuration', () => {
  test('calculates duration from startTime', async () => {
    const ctx = createHookContext<HookContext>({});

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 50));

    const duration = getDuration(ctx);
    expect(duration).toBeGreaterThanOrEqual(50);
    expect(duration).toBeLessThan(200); // Generous upper bound
  });

  test('returns 0 for immediate call', () => {
    const ctx = createHookContext<HookContext>({});
    const duration = getDuration(ctx);

    expect(duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeLessThan(10);
  });
});

describe('callHook', () => {
  test('calls hook with context', async () => {
    const hookFn = mock(() => {});
    const ctx = createHookContext<PushHookContext>({
      queue: 'test',
      data: { x: 1 },
    });

    await callHook(hookFn, ctx);

    expect(hookFn).toHaveBeenCalledTimes(1);
    expect(hookFn).toHaveBeenCalledWith(ctx);
  });

  test('handles undefined hook gracefully', async () => {
    const ctx = createHookContext<HookContext>({});

    // Should not throw
    await callHook(undefined, ctx);
  });

  test('catches hook errors and continues', async () => {
    const errorHook = mock(() => {
      throw new Error('Hook failed');
    });
    const ctx = createHookContext<HookContext>({});

    // Should not throw despite hook error
    await callHook(errorHook, ctx);

    expect(errorHook).toHaveBeenCalledTimes(1);
  });

  test('supports async hooks', async () => {
    let completed = false;
    const asyncHook: Hook<HookContext> = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed = true;
    };
    const ctx = createHookContext<HookContext>({});

    await callHook(asyncHook, ctx);

    expect(completed).toBe(true);
  });

  test('allows context modification', async () => {
    const ctx = createHookContext<PushHookContext>({
      queue: 'test',
      data: {},
    });

    const hookFn: Hook<PushHookContext> = (c) => {
      c.requestId = 'req-123';
      (c as Record<string, unknown>).span = { traceId: 'abc' };
    };

    await callHook(hookFn, ctx);

    expect(ctx.requestId).toBe('req-123');
    expect((ctx as Record<string, unknown>).span).toEqual({ traceId: 'abc' });
  });
});

describe('callErrorHook', () => {
  test('calls error hook with context and error', async () => {
    const hookFn = mock(() => {});
    const ctx = createHookContext<PushHookContext>({
      queue: 'test',
      data: {},
    });
    const error = new Error('Push failed');

    await callErrorHook(hookFn, ctx, error);

    expect(hookFn).toHaveBeenCalledTimes(1);
    expect(hookFn).toHaveBeenCalledWith(ctx, error);
  });

  test('handles undefined error hook gracefully', async () => {
    const ctx = createHookContext<HookContext>({});
    const error = new Error('Test error');

    // Should not throw
    await callErrorHook(undefined, ctx, error);
  });

  test('catches error hook failures and continues', async () => {
    const brokenHook: ErrorHook<HookContext> = () => {
      throw new Error('Hook itself failed');
    };
    const ctx = createHookContext<HookContext>({});
    const error = new Error('Original error');

    // Should not throw despite hook error
    await callErrorHook(brokenHook, ctx, error);
  });

  test('supports async error hooks', async () => {
    let errorLogged = false;
    const asyncErrorHook: ErrorHook<HookContext> = async (_ctx, error) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      errorLogged = error.message === 'Test error';
    };
    const ctx = createHookContext<HookContext>({});

    await callErrorHook(asyncErrorHook, ctx, new Error('Test error'));

    expect(errorLogged).toBe(true);
  });
});

describe('HookContext custom data', () => {
  test('allows storing custom data like spans', () => {
    const ctx = createHookContext<PushHookContext>({
      queue: 'test',
      data: {},
    });

    // Simulate OpenTelemetry span storage
    const mockSpan = {
      end: mock(() => {}),
      recordException: mock((_e: Error) => {}),
    };

    (ctx as Record<string, unknown>).span = mockSpan;

    expect((ctx as Record<string, unknown>).span).toBe(mockSpan);

    // Can call methods on stored span
    mockSpan.end();
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  test('allows storing metrics context', () => {
    const ctx = createHookContext<PushHookContext>({
      queue: 'test',
      data: {},
    });

    // Store custom metrics data
    (ctx as Record<string, unknown>).metrics = {
      counter: 'push_total',
      labels: { queue: 'test' },
    };

    expect((ctx as Record<string, unknown>).metrics).toEqual({
      counter: 'push_total',
      labels: { queue: 'test' },
    });
  });
});

describe('ClientHooks interface', () => {
  test('type checking for all push hooks', () => {
    const hooks: ClientHooks = {
      onPush: (ctx) => {
        expect(ctx.queue).toBeDefined();
        expect(ctx.data).toBeDefined();
      },
      onPushComplete: (ctx) => {
        expect(ctx.startTime).toBeDefined();
      },
      onPushError: (ctx, error) => {
        expect(ctx.queue).toBeDefined();
        expect(error).toBeInstanceOf(Error);
      },
    };

    expect(hooks.onPush).toBeDefined();
    expect(hooks.onPushComplete).toBeDefined();
    expect(hooks.onPushError).toBeDefined();
  });

  test('type checking for all pull hooks', () => {
    const hooks: ClientHooks = {
      onPull: (ctx) => {
        expect(ctx.queue).toBeDefined();
      },
      onPullComplete: (ctx) => {
        // job may be null on timeout
        expect(ctx.job === null || ctx.job !== undefined).toBe(true);
      },
      onPullError: (ctx, error) => {
        expect(ctx.queue).toBeDefined();
        expect(error).toBeDefined();
      },
    };

    expect(hooks.onPull).toBeDefined();
    expect(hooks.onPullComplete).toBeDefined();
    expect(hooks.onPullError).toBeDefined();
  });

  test('type checking for ack/fail hooks', () => {
    const hooks: ClientHooks = {
      onAck: (ctx) => {
        expect(ctx.jobId).toBeDefined();
      },
      onAckComplete: (ctx) => {
        expect(ctx.startTime).toBeDefined();
      },
      onAckError: (ctx, error) => {
        expect(ctx.jobId).toBeDefined();
        expect(error).toBeDefined();
      },
      onFail: (ctx) => {
        expect(ctx.jobId).toBeDefined();
      },
      onFailComplete: (ctx) => {
        expect(ctx.startTime).toBeDefined();
      },
      onFailError: (ctx, error) => {
        expect(error).toBeDefined();
      },
    };

    expect(hooks.onAck).toBeDefined();
    expect(hooks.onFail).toBeDefined();
  });

  test('type checking for batch hooks', () => {
    const hooks: ClientHooks = {
      onBatchPush: (ctx) => {
        expect(ctx.queue).toBeDefined();
        expect(ctx.count).toBeDefined();
      },
      onBatchPushComplete: (ctx) => {
        expect(ctx.ids).toBeDefined();
      },
      onBatchPushError: (ctx, error) => {
        expect(error).toBeDefined();
      },
      onBatchPull: (ctx) => {
        expect(ctx.count).toBeDefined();
      },
      onBatchPullComplete: (ctx) => {
        expect(ctx.jobs).toBeDefined();
      },
      onBatchPullError: (ctx, error) => {
        expect(error).toBeDefined();
      },
    };

    expect(hooks.onBatchPush).toBeDefined();
    expect(hooks.onBatchPull).toBeDefined();
  });

  test('type checking for connection hooks', () => {
    const hooks: ClientHooks = {
      onConnection: (ctx) => {
        expect(ctx.host).toBeDefined();
        expect(ctx.port).toBeDefined();
        expect(ctx.event).toBeDefined();
      },
    };

    expect(hooks.onConnection).toBeDefined();
  });
});

describe('WorkerHooks interface', () => {
  test('type checking for process hooks', () => {
    const hooks: WorkerHooks = {
      onProcess: (ctx) => {
        expect(ctx.job).toBeDefined();
        expect(ctx.workerId).toBeDefined();
      },
      onProcessComplete: (ctx) => {
        expect(ctx.result).toBeDefined();
      },
      onProcessError: (ctx, error) => {
        expect(ctx.job).toBeDefined();
        expect(error).toBeDefined();
      },
    };

    expect(hooks.onProcess).toBeDefined();
    expect(hooks.onProcessComplete).toBeDefined();
    expect(hooks.onProcessError).toBeDefined();
  });
});

describe('OpenTelemetry integration pattern', () => {
  test('simulates tracing workflow', async () => {
    // Mock OpenTelemetry-like tracer
    const mockTracer = {
      startSpan: mock((name: string, options?: { attributes?: Record<string, unknown> }) => ({
        name,
        attributes: options?.attributes,
        end: mock(() => {}),
        recordException: mock((_e: Error) => {}),
      })),
    };

    const hooks: ClientHooks = {
      onPush: (ctx) => {
        const span = mockTracer.startSpan('flashq.push', {
          attributes: { queue: ctx.queue, priority: ctx.options?.priority },
        });
        (ctx as Record<string, unknown>).span = span;
      },
      onPushComplete: (ctx) => {
        const span = (ctx as Record<string, unknown>).span as { end: () => void };
        span?.end();
      },
      onPushError: (ctx, error) => {
        const span = (ctx as Record<string, unknown>).span as {
          recordException: (e: Error) => void;
          end: () => void;
        };
        span?.recordException(error);
        span?.end();
      },
    };

    // Simulate successful push
    const successCtx = createHookContext<PushHookContext>({
      queue: 'orders',
      data: { orderId: 123 },
      options: { priority: 5 },
    });

    await callHook(hooks.onPush, successCtx);
    expect(mockTracer.startSpan).toHaveBeenCalledWith('flashq.push', {
      attributes: { queue: 'orders', priority: 5 },
    });

    await callHook(hooks.onPushComplete, successCtx);
    const span = (successCtx as Record<string, unknown>).span as { end: ReturnType<typeof mock> };
    expect(span.end).toHaveBeenCalledTimes(1);

    // Simulate failed push
    const errorCtx = createHookContext<PushHookContext>({
      queue: 'orders',
      data: { orderId: 456 },
    });

    await callHook(hooks.onPush, errorCtx);
    const error = new Error('Queue full');
    await callErrorHook(hooks.onPushError, errorCtx, error);

    const errorSpan = (errorCtx as Record<string, unknown>).span as {
      recordException: ReturnType<typeof mock>;
      end: ReturnType<typeof mock>;
    };
    expect(errorSpan.recordException).toHaveBeenCalledWith(error);
    expect(errorSpan.end).toHaveBeenCalledTimes(1);
  });
});

describe('Metrics collection pattern', () => {
  test('simulates counter increments', async () => {
    const counters: Record<string, number> = {
      pushTotal: 0,
      pushErrors: 0,
      pullTotal: 0,
    };

    const hooks: ClientHooks = {
      onPushComplete: () => {
        counters.pushTotal++;
      },
      onPushError: () => {
        counters.pushErrors++;
      },
      onPullComplete: () => {
        counters.pullTotal++;
      },
    };

    // Simulate operations
    const pushCtx = createHookContext<PushHookContext>({ queue: 'q', data: {} });
    await callHook(hooks.onPushComplete, pushCtx);
    await callHook(hooks.onPushComplete, pushCtx);
    await callErrorHook(hooks.onPushError, pushCtx, new Error('fail'));

    const pullCtx = createHookContext<PullHookContext>({ queue: 'q' });
    await callHook(hooks.onPullComplete, pullCtx);

    expect(counters.pushTotal).toBe(2);
    expect(counters.pushErrors).toBe(1);
    expect(counters.pullTotal).toBe(1);
  });

  test('simulates histogram recording', async () => {
    const durations: number[] = [];

    const hooks: ClientHooks = {
      onPushComplete: (ctx) => {
        durations.push(getDuration(ctx));
      },
    };

    // Simulate operations with varying durations
    for (let i = 0; i < 3; i++) {
      const ctx = createHookContext<PushHookContext>({ queue: 'q', data: {} });
      await new Promise((resolve) => setTimeout(resolve, 10 * (i + 1)));
      await callHook(hooks.onPushComplete, ctx);
    }

    expect(durations.length).toBe(3);
    expect(durations[0]).toBeGreaterThanOrEqual(10);
    expect(durations[1]).toBeGreaterThanOrEqual(20);
    expect(durations[2]).toBeGreaterThanOrEqual(30);
  });
});
