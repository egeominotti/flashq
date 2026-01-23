/**
 * Retry Utility Tests
 */
import { describe, test, expect } from 'bun:test';
import {
  withRetry,
  retryable,
  isRetryable,
  calculateDelay,
  RetryPresets,
} from '../../src/utils/retry';
import { ConnectionError, TimeoutError, ValidationError } from '../../src/errors';

describe('isRetryable', () => {
  test('returns true for retryable FlashQ errors', () => {
    expect(isRetryable(new ConnectionError('test'))).toBe(true);
    expect(isRetryable(new TimeoutError('test', 1000))).toBe(true);
  });

  test('returns false for non-retryable FlashQ errors', () => {
    expect(isRetryable(new ValidationError('test'))).toBe(false);
  });

  test('returns true for network errors', () => {
    expect(isRetryable(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryable(new Error('socket hang up'))).toBe(true);
    expect(isRetryable(new Error('network error'))).toBe(true);
    expect(isRetryable(new Error('connection timeout'))).toBe(true);
  });

  test('returns false for generic errors', () => {
    expect(isRetryable(new Error('Something went wrong'))).toBe(false);
    expect(isRetryable(new Error('Invalid input'))).toBe(false);
  });
});

describe('calculateDelay', () => {
  const baseOptions = {
    maxRetries: 3,
    initialDelay: 100,
    maxDelay: 5000,
    backoffMultiplier: 2,
    jitter: false,
  };

  test('calculates exponential backoff', () => {
    expect(calculateDelay(1, baseOptions)).toBe(100);
    expect(calculateDelay(2, baseOptions)).toBe(200);
    expect(calculateDelay(3, baseOptions)).toBe(400);
    expect(calculateDelay(4, baseOptions)).toBe(800);
  });

  test('respects max delay', () => {
    expect(calculateDelay(10, baseOptions)).toBe(5000);
  });

  test('adds jitter when enabled', () => {
    const options = { ...baseOptions, jitter: true };
    const delays = new Set<number>();

    for (let i = 0; i < 10; i++) {
      delays.add(calculateDelay(1, options));
    }

    // With jitter, we should get different values
    expect(delays.size).toBeGreaterThan(1);
  });
});

describe('withRetry', () => {
  test('returns result on success', async () => {
    const fn = async () => 'success';
    const result = await withRetry(fn);
    expect(result).toBe('success');
  });

  test('retries on retryable error', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new ConnectionError('test');
      return 'success';
    };

    const result = await withRetry(fn, { maxRetries: 3, initialDelay: 10 });
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  test('throws immediately on non-retryable error', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new ValidationError('test');
    };

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow(ValidationError);
    expect(attempts).toBe(1);
  });

  test('throws after max retries exhausted', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new ConnectionError('test');
    };

    await expect(withRetry(fn, { maxRetries: 2, initialDelay: 10 })).rejects.toThrow(
      ConnectionError
    );
    expect(attempts).toBe(3); // initial + 2 retries
  });

  test('calls onRetry callback', async () => {
    const retryAttempts: number[] = [];
    const fn = async () => {
      if (retryAttempts.length < 2) throw new ConnectionError('test');
      return 'success';
    };

    await withRetry(fn, {
      maxRetries: 3,
      initialDelay: 10,
      onRetry: (_, attempt) => retryAttempts.push(attempt),
    });

    expect(retryAttempts).toEqual([1, 2]);
  });

  test('respects custom shouldRetry function', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('custom error');
    };

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        initialDelay: 10,
        shouldRetry: (error) => error.message === 'custom error' && attempts < 2,
      })
    ).rejects.toThrow();

    expect(attempts).toBe(2);
  });

  test('respects retryOn filter', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new ConnectionError('test', 'CONNECTION_TIMEOUT');
    };

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        initialDelay: 10,
        retryOn: ['CONNECTION_FAILED'], // Not CONNECTION_TIMEOUT
      })
    ).rejects.toThrow();

    expect(attempts).toBe(1);
  });
});

describe('retryable wrapper', () => {
  test('wraps function with retry logic', async () => {
    let attempts = 0;
    const fn = async (x: number) => {
      attempts++;
      if (attempts < 2) throw new ConnectionError('test');
      return x * 2;
    };

    const retryableFn = retryable(fn, { maxRetries: 3, initialDelay: 10 });
    const result = await retryableFn(5);

    expect(result).toBe(10);
    expect(attempts).toBe(2);
  });

  test('preserves function arguments', async () => {
    const fn = async (a: number, b: string, c: boolean) => ({ a, b, c });
    const retryableFn = retryable(fn, { maxRetries: 1 });

    const result = await retryableFn(1, 'test', true);
    expect(result).toEqual({ a: 1, b: 'test', c: true });
  });
});

describe('RetryPresets', () => {
  test('fast preset has low retries and delays', () => {
    expect(RetryPresets.fast.maxRetries).toBe(2);
    expect(RetryPresets.fast.initialDelay).toBe(50);
  });

  test('standard preset has moderate settings', () => {
    expect(RetryPresets.standard.maxRetries).toBe(3);
    expect(RetryPresets.standard.initialDelay).toBe(100);
  });

  test('aggressive preset has high retries', () => {
    expect(RetryPresets.aggressive.maxRetries).toBe(5);
    expect(RetryPresets.aggressive.maxDelay).toBe(30000);
  });

  test('none preset disables retries', () => {
    expect(RetryPresets.none.maxRetries).toBe(0);
  });

  test('presets work with withRetry', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 2) throw new ConnectionError('test');
      return 'success';
    };

    const result = await withRetry(fn, { ...RetryPresets.fast, initialDelay: 10 });
    expect(result).toBe('success');
  });
});
