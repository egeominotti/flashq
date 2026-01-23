/**
 * Reconnection logic for FlashQ client.
 *
 * Implements exponential backoff with jitter for automatic reconnection
 * after connection loss.
 */

import { EventEmitter } from 'events';
import { ConnectionError } from '../errors';
import type { Logger } from '../utils/logger';

/** Connection state machine states */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed';

/** Configuration for reconnection behavior */
export interface ReconnectConfig {
  /** Whether auto-reconnect is enabled */
  enabled: boolean;
  /** Maximum number of reconnection attempts (0 = unlimited) */
  maxAttempts: number;
  /** Initial delay between reconnection attempts (ms) */
  initialDelay: number;
  /** Maximum delay between reconnection attempts (ms) */
  maxDelay: number;
}

/** Event data emitted during reconnection */
export interface ReconnectEventData {
  /** Current attempt number */
  attempt: number;
  /** Delay before this attempt (ms) */
  delay: number;
}

/**
 * Manages reconnection state and scheduling.
 *
 * Implements exponential backoff with jitter:
 * delay = min(initialDelay * 2^attempt, maxDelay) + random jitter
 *
 * @example
 * ```typescript
 * const manager = new ReconnectManager(config, logger, emitter);
 *
 * manager.schedule(async () => {
 *   await connect();
 *   manager.reset();
 * });
 * ```
 */
export class ReconnectManager {
  /** Current reconnection attempt number */
  private attempts = 0;
  /** Timer handle for scheduled reconnection */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Whether reconnection was cancelled */
  private cancelled = false;

  constructor(
    private readonly config: ReconnectConfig,
    private readonly logger: Logger,
    private readonly emitter: EventEmitter
  ) {}

  /**
   * Calculates the delay for the next reconnection attempt.
   *
   * Uses exponential backoff with 30% jitter to prevent
   * thundering herd problems.
   *
   * @param attempt - Current attempt number (1-based)
   * @returns Delay in milliseconds
   */
  calculateDelay(attempt: number): number {
    const baseDelay = Math.min(
      this.config.initialDelay * Math.pow(2, attempt - 1),
      this.config.maxDelay
    );
    // Add 0-30% jitter
    return baseDelay + Math.random() * 0.3 * baseDelay;
  }

  /**
   * Checks if more reconnection attempts are allowed.
   *
   * @returns true if another attempt can be made
   */
  canRetry(): boolean {
    if (!this.config.enabled || this.cancelled) return false;
    if (this.config.maxAttempts === 0) return true; // Unlimited
    return this.attempts < this.config.maxAttempts;
  }

  /**
   * Schedules a reconnection attempt.
   *
   * @param connectFn - Async function that performs the connection
   */
  schedule(connectFn: () => Promise<void>): void {
    if (!this.canRetry()) {
      this.logger.error('Max reconnection attempts reached', { attempts: this.attempts });
      this.emitter.emit(
        'reconnect_failed',
        new ConnectionError('Max reconnection attempts reached', 'RECONNECTION_FAILED')
      );
      return;
    }

    this.attempts++;
    const delay = this.calculateDelay(this.attempts);

    this.logger.info('Scheduling reconnection', { attempt: this.attempts, delay: Math.round(delay) });
    this.emitter.emit('reconnecting', { attempt: this.attempts, delay } as ReconnectEventData);

    this.timer = setTimeout(async () => {
      try {
        await connectFn();
        this.logger.info('Reconnected successfully', { attempt: this.attempts });
        this.emitter.emit('reconnected');
      } catch (error) {
        this.logger.warn('Reconnection attempt failed', {
          attempt: this.attempts,
          error: error instanceof Error ? error.message : error,
        });
        // Schedule next attempt
        this.schedule(connectFn);
      }
    }, delay);
  }

  /**
   * Resets the reconnection state after successful connection.
   */
  reset(): void {
    this.attempts = 0;
    this.cancelled = false;
  }

  /**
   * Cancels any pending reconnection attempt.
   */
  cancel(): void {
    this.cancelled = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Gets the current attempt count.
   */
  getAttempts(): number {
    return this.attempts;
  }
}

/**
 * Waits for a reconnection to complete.
 *
 * @param emitter - Event emitter that fires reconnection events
 * @param timeout - Maximum time to wait (ms)
 * @returns Promise that resolves when reconnected
 * @throws ConnectionError if reconnection fails or times out
 */
export function waitForReconnection(emitter: EventEmitter, timeout: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener('reconnected', onReconnect);
      emitter.removeListener('reconnect_failed', onFailed);
      reject(new ConnectionError('Reconnection timeout', 'RECONNECTION_FAILED'));
    }, timeout);

    const onReconnect = () => {
      clearTimeout(timer);
      emitter.removeListener('reconnect_failed', onFailed);
      resolve();
    };

    const onFailed = (err: Error) => {
      clearTimeout(timer);
      emitter.removeListener('reconnected', onReconnect);
      reject(err);
    };

    emitter.once('reconnected', onReconnect);
    emitter.once('reconnect_failed', onFailed);
  });
}
