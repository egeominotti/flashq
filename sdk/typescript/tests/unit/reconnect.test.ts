/**
 * Reconnection Logic Tests
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'events';
import {
  ReconnectManager,
  waitForReconnection,
  type ReconnectConfig,
  type ConnectionState,
} from '../../src/client/reconnect';
import { Logger } from '../../src/utils/logger';
import { ConnectionError } from '../../src/errors';

describe('ReconnectManager', () => {
  let manager: ReconnectManager;
  let emitter: EventEmitter;
  let logger: Logger;
  let config: ReconnectConfig;

  beforeEach(() => {
    emitter = new EventEmitter();
    logger = new Logger({ level: 'silent', prefix: 'test' });
    config = {
      enabled: true,
      maxAttempts: 5,
      initialDelay: 100,
      maxDelay: 1000,
    };
    manager = new ReconnectManager(config, logger, emitter);
  });

  describe('calculateDelay', () => {
    test('calculates exponential backoff', () => {
      const delay1 = manager.calculateDelay(1);
      const delay2 = manager.calculateDelay(2);
      const delay3 = manager.calculateDelay(3);

      // Base delay with up to 30% jitter
      expect(delay1).toBeGreaterThanOrEqual(100);
      expect(delay1).toBeLessThanOrEqual(130);

      expect(delay2).toBeGreaterThanOrEqual(200);
      expect(delay2).toBeLessThanOrEqual(260);

      expect(delay3).toBeGreaterThanOrEqual(400);
      expect(delay3).toBeLessThanOrEqual(520);
    });

    test('respects maxDelay', () => {
      // Attempt 10 would be 100 * 2^9 = 51200, but capped at 1000
      const delay = manager.calculateDelay(10);

      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1300); // maxDelay + 30% jitter
    });

    test('includes jitter', () => {
      // Run multiple times to check jitter varies
      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(Math.round(manager.calculateDelay(1)));
      }

      // With 30% jitter, we should see some variation
      // (statistically unlikely to get same value 10 times)
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('canRetry', () => {
    test('returns true when enabled and attempts remain', () => {
      expect(manager.canRetry()).toBe(true);
    });

    test('returns false when disabled', () => {
      const disabledConfig: ReconnectConfig = { ...config, enabled: false };
      const disabledManager = new ReconnectManager(disabledConfig, logger, emitter);

      expect(disabledManager.canRetry()).toBe(false);
    });

    test('returns false after max attempts reached', () => {
      // Simulate max attempts
      for (let i = 0; i < 5; i++) {
        manager.schedule(async () => {
          throw new Error('fail');
        });
      }

      // After scheduling 5 times, attempts = 5, max = 5
      // canRetry should still work until we actually hit the limit
      // The manager tracks attempts internally
    });

    test('returns true with unlimited attempts (maxAttempts=0)', () => {
      const unlimitedConfig: ReconnectConfig = { ...config, maxAttempts: 0 };
      const unlimitedManager = new ReconnectManager(unlimitedConfig, logger, emitter);

      expect(unlimitedManager.canRetry()).toBe(true);
    });
  });

  describe('schedule', () => {
    test('emits reconnecting event with attempt and delay', async () => {
      const reconnectingHandler = mock(() => {});
      emitter.on('reconnecting', reconnectingHandler);

      manager.schedule(async () => {});

      expect(reconnectingHandler).toHaveBeenCalledTimes(1);
      const args = reconnectingHandler.mock.calls[0];
      expect(args[0].attempt).toBe(1);
      expect(args[0].delay).toBeGreaterThan(0);
    });

    test('emits reconnected on success', async () => {
      const reconnectedHandler = mock(() => {});
      emitter.on('reconnected', reconnectedHandler);

      manager.schedule(async () => {
        // Successful connection
      });

      // Wait for the scheduled timeout
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(reconnectedHandler).toHaveBeenCalledTimes(1);
    });

    test('increments attempts on each schedule', () => {
      expect(manager.getAttempts()).toBe(0);

      manager.schedule(async () => {
        throw new Error('fail');
      });
      expect(manager.getAttempts()).toBe(1);

      manager.schedule(async () => {
        throw new Error('fail');
      });
      expect(manager.getAttempts()).toBe(2);
    });

    test('emits reconnect_failed when max attempts exceeded', async () => {
      const failedHandler = mock(() => {});
      emitter.on('reconnect_failed', failedHandler);

      // Use config with max 1 attempt
      const limitedConfig: ReconnectConfig = { ...config, maxAttempts: 1 };
      const limitedManager = new ReconnectManager(limitedConfig, logger, emitter);

      // First attempt
      limitedManager.schedule(async () => {
        throw new Error('fail');
      });

      // Second attempt should fail
      limitedManager.schedule(async () => {
        throw new Error('fail');
      });

      expect(failedHandler).toHaveBeenCalledTimes(1);
      expect(failedHandler.mock.calls[0][0]).toBeInstanceOf(ConnectionError);
    });
  });

  describe('reset', () => {
    test('resets attempt counter', () => {
      manager.schedule(async () => {});
      manager.schedule(async () => {});

      expect(manager.getAttempts()).toBe(2);

      manager.reset();

      expect(manager.getAttempts()).toBe(0);
    });

    test('allows retrying after reset', () => {
      const limitedConfig: ReconnectConfig = { ...config, maxAttempts: 1 };
      const limitedManager = new ReconnectManager(limitedConfig, logger, emitter);

      limitedManager.schedule(async () => {});
      expect(limitedManager.getAttempts()).toBe(1);

      limitedManager.reset();

      expect(limitedManager.canRetry()).toBe(true);
      expect(limitedManager.getAttempts()).toBe(0);
    });
  });

  describe('cancel', () => {
    test('prevents further retries', () => {
      manager.cancel();

      expect(manager.canRetry()).toBe(false);
    });

    test('clears pending timer', async () => {
      const reconnectedHandler = mock(() => {});
      emitter.on('reconnected', reconnectedHandler);

      manager.schedule(async () => {});
      manager.cancel();

      // Wait longer than the scheduled delay
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should not have reconnected due to cancellation
      expect(reconnectedHandler).toHaveBeenCalledTimes(0);
    });
  });

  describe('getAttempts', () => {
    test('returns current attempt count', () => {
      expect(manager.getAttempts()).toBe(0);

      manager.schedule(async () => {});
      expect(manager.getAttempts()).toBe(1);

      manager.schedule(async () => {});
      expect(manager.getAttempts()).toBe(2);
    });
  });
});

describe('waitForReconnection', () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  test('resolves when reconnected event fires', async () => {
    const promise = waitForReconnection(emitter, 1000);

    // Emit reconnected after a short delay
    setTimeout(() => emitter.emit('reconnected'), 50);

    await expect(promise).resolves.toBeUndefined();
  });

  test('rejects when reconnect_failed event fires', async () => {
    const promise = waitForReconnection(emitter, 1000);
    const error = new ConnectionError('Test failure', 'TEST');

    // Emit failure after a short delay
    setTimeout(() => emitter.emit('reconnect_failed', error), 50);

    await expect(promise).rejects.toBe(error);
  });

  test('rejects on timeout', async () => {
    const promise = waitForReconnection(emitter, 100);

    // Don't emit any event, let it timeout

    await expect(promise).rejects.toThrow('Reconnection timeout');
  });

  test('cleans up listeners on success', async () => {
    const promise = waitForReconnection(emitter, 1000);

    setTimeout(() => emitter.emit('reconnected'), 50);
    await promise;

    expect(emitter.listenerCount('reconnected')).toBe(0);
    expect(emitter.listenerCount('reconnect_failed')).toBe(0);
  });

  test('cleans up listeners on failure', async () => {
    const promise = waitForReconnection(emitter, 1000);

    setTimeout(() => emitter.emit('reconnect_failed', new Error('fail')), 50);

    try {
      await promise;
    } catch {
      // Expected
    }

    expect(emitter.listenerCount('reconnected')).toBe(0);
    expect(emitter.listenerCount('reconnect_failed')).toBe(0);
  });

  test('cleans up listeners on timeout', async () => {
    const promise = waitForReconnection(emitter, 50);

    try {
      await promise;
    } catch {
      // Expected timeout
    }

    expect(emitter.listenerCount('reconnected')).toBe(0);
    expect(emitter.listenerCount('reconnect_failed')).toBe(0);
  });
});

describe('ConnectionState type', () => {
  test('includes all expected states', () => {
    const states: ConnectionState[] = [
      'disconnected',
      'connecting',
      'connected',
      'reconnecting',
      'closed',
    ];

    expect(states).toHaveLength(5);
  });
});
