/**
 * Retry utility for automatic retries on transient failures
 */
import { FlashQError } from '../errors';
import {
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_INITIAL_DELAY,
  DEFAULT_RETRY_MAX_DELAY,
  DEFAULT_BACKOFF_MULTIPLIER,
  RETRY_JITTER_FACTOR,
} from '../constants';

export interface RetryOptions {
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms (default: 100) */
  initialDelay?: number;
  /** Max delay in ms (default: 5000) */
  maxDelay?: number;
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Add jitter to delays (default: true) */
  jitter?: boolean;
  /** Only retry these error codes (default: retry all retryable errors) */
  retryOn?: string[];
  /** Custom retry condition */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Callback on each retry */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryOn' | 'shouldRetry' | 'onRetry'>> = {
  maxRetries: DEFAULT_RETRY_MAX_ATTEMPTS,
  initialDelay: DEFAULT_RETRY_INITIAL_DELAY,
  maxDelay: DEFAULT_RETRY_MAX_DELAY,
  backoffMultiplier: DEFAULT_BACKOFF_MULTIPLIER,
  jitter: true,
};

/** Check if an error is retryable */
export function isRetryable(error: Error): boolean {
  // FlashQ errors have retryable flag
  if (error instanceof FlashQError) {
    return error.retryable;
  }

  // Network errors are generally retryable
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    'timeout',
    'econnrefused',
    'econnreset',
    'epipe',
    'enetunreach',
    'ehostunreach',
    'socket hang up',
    'network',
    'connection',
    'aborted',
  ];

  return retryablePatterns.some((pattern) => message.includes(pattern));
}

/** Calculate delay for next retry with exponential backoff */
export function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, 'retryOn' | 'shouldRetry' | 'onRetry'>>
): number {
  const delay = Math.min(
    options.initialDelay * Math.pow(options.backoffMultiplier, attempt - 1),
    options.maxDelay
  );

  if (options.jitter) {
    // Add ±RETRY_JITTER_FACTOR jitter (default: ±25%)
    const jitterRange = delay * RETRY_JITTER_FACTOR;
    return delay + (Math.random() * jitterRange * 2 - jitterRange);
  }

  return delay;
}

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with automatic retries on failure.
 *
 * @param fn - Function to execute
 * @param options - Retry options
 * @returns Result of the function
 * @throws Last error after all retries exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => client.push('queue', data),
 *   { maxRetries: 3, onRetry: (err, attempt) => console.log(`Retry ${attempt}`) }
 * );
 * ```
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const shouldRetry =
        attempt <= opts.maxRetries &&
        (opts.shouldRetry ? opts.shouldRetry(lastError, attempt) : isRetryable(lastError));

      // Check retryOn filter
      if (shouldRetry && opts.retryOn && lastError instanceof FlashQError) {
        if (!opts.retryOn.includes(lastError.code)) {
          throw lastError;
        }
      }

      if (!shouldRetry) {
        throw lastError;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, opts);

      // Notify callback
      if (opts.onRetry) {
        opts.onRetry(lastError, attempt, delay);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Create a retryable version of a function.
 *
 * @param fn - Function to wrap
 * @param options - Retry options
 * @returns Wrapped function with retry logic
 *
 * @example
 * ```typescript
 * const retryablePush = retryable(
 *   (queue: string, data: any) => client.push(queue, data),
 *   { maxRetries: 3 }
 * );
 * await retryablePush('emails', { to: 'user@example.com' });
 * ```
 */
export function retryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}

/**
 * Retry configuration presets
 */
export const RetryPresets = {
  /** Quick retries for interactive operations */
  fast: {
    maxRetries: 2,
    initialDelay: 50,
    maxDelay: 500,
  } as RetryOptions,

  /** Standard retries for most operations (uses SDK defaults) */
  standard: {
    maxRetries: DEFAULT_RETRY_MAX_ATTEMPTS,
    initialDelay: DEFAULT_RETRY_INITIAL_DELAY,
    maxDelay: DEFAULT_RETRY_MAX_DELAY,
  } as RetryOptions,

  /** Aggressive retries for critical operations */
  aggressive: {
    maxRetries: 5,
    initialDelay: 200,
    maxDelay: 30000,
  } as RetryOptions,

  /** No retries */
  none: {
    maxRetries: 0,
  } as RetryOptions,
};
