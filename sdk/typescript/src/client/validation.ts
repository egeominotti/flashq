/**
 * Input validation utilities for FlashQ client.
 *
 * Provides validation functions for queue names, job data sizes,
 * and batch operation limits.
 */

import { ValidationError } from '../errors';

/** Maximum allowed job data size in bytes (1MB) */
export const MAX_JOB_DATA_SIZE = 1024 * 1024;

/** Maximum number of jobs per batch operation */
export const MAX_BATCH_SIZE = 1000;

/** Regex pattern for valid queue names: alphanumeric, underscore, hyphen, dot (1-256 chars) */
const QUEUE_NAME_REGEX = /^[a-zA-Z0-9_.-]{1,256}$/;

/**
 * Validates a queue name against naming rules.
 *
 * Queue names must:
 * - Be non-empty strings
 * - Contain only alphanumeric characters, underscores, hyphens, or dots
 * - Be between 1 and 256 characters long
 *
 * @param queue - The queue name to validate
 * @throws ValidationError if the queue name is invalid
 *
 * @example
 * ```typescript
 * validateQueueName('my-queue');      // OK
 * validateQueueName('queue.name');    // OK
 * validateQueueName('queue name');    // Throws: contains space
 * validateQueueName('');              // Throws: empty
 * ```
 */
export function validateQueueName(queue: string): void {
  if (!queue || typeof queue !== 'string') {
    throw new ValidationError('Queue name is required', 'queue');
  }
  if (!QUEUE_NAME_REGEX.test(queue)) {
    throw new ValidationError(
      `Invalid queue name: "${queue}". Must be alphanumeric, _, -, . (1-256 chars)`,
      'queue'
    );
  }
}

/**
 * Validates that job data does not exceed the maximum allowed size.
 *
 * The size is calculated by JSON-stringifying the data and measuring
 * the resulting string length in bytes.
 *
 * @param data - The job data to validate
 * @throws ValidationError if the data exceeds MAX_JOB_DATA_SIZE
 *
 * @example
 * ```typescript
 * validateJobDataSize({ small: 'data' });  // OK
 * validateJobDataSize(largeBuffer);        // Throws if > 1MB
 * ```
 */
export function validateJobDataSize(data: unknown): void {
  const size = JSON.stringify(data).length;
  if (size > MAX_JOB_DATA_SIZE) {
    throw new ValidationError(
      `Job data size (${size} bytes) exceeds max (${MAX_JOB_DATA_SIZE} bytes)`,
      'data'
    );
  }
}

/**
 * Validates batch operation size.
 *
 * @param count - Number of items in the batch
 * @param operation - Name of the operation for error messages
 * @throws ValidationError if count exceeds MAX_BATCH_SIZE
 *
 * @example
 * ```typescript
 * validateBatchSize(100, 'push');   // OK
 * validateBatchSize(1500, 'push');  // Throws: exceeds 1000
 * ```
 */
export function validateBatchSize(count: number, operation: string): void {
  if (count > MAX_BATCH_SIZE) {
    throw new ValidationError(
      `Batch ${operation} size (${count}) exceeds max (${MAX_BATCH_SIZE})`,
      'batch'
    );
  }
}

/**
 * Validates a job ID is a positive integer.
 *
 * @param jobId - The job ID to validate
 * @throws ValidationError if jobId is not a positive integer
 */
export function validateJobId(jobId: number): void {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new ValidationError(`Invalid job ID: ${jobId}. Must be a positive integer`, 'jobId');
  }
}

/**
 * Validates a timeout value is within acceptable bounds.
 *
 * @param timeout - Timeout in milliseconds
 * @param min - Minimum allowed value (default: 0)
 * @param max - Maximum allowed value (default: 10 minutes)
 * @throws ValidationError if timeout is out of bounds
 */
export function validateTimeout(timeout: number, min = 0, max = 600000): void {
  if (timeout < min || timeout > max) {
    throw new ValidationError(
      `Timeout ${timeout}ms out of bounds (${min}-${max}ms)`,
      'timeout'
    );
  }
}
