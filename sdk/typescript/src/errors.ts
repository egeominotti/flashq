/**
 * FlashQ Error Classes
 *
 * Specific error types for better error handling and programmatic responses.
 */

/** Base error class for all FlashQ errors */
export class FlashQError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable = false) {
    super(message);
    this.name = 'FlashQError';
    this.code = code;
    this.retryable = retryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Connection-related errors */
export class ConnectionError extends FlashQError {
  constructor(message: string, code: ConnectionErrorCode = 'CONNECTION_FAILED') {
    super(message, code, true);
    this.name = 'ConnectionError';
  }
}

export type ConnectionErrorCode =
  | 'CONNECTION_FAILED'
  | 'CONNECTION_TIMEOUT'
  | 'CONNECTION_CLOSED'
  | 'RECONNECTION_FAILED'
  | 'NOT_CONNECTED'
  | 'QUEUE_FULL';

/** Authentication errors */
export class AuthenticationError extends FlashQError {
  constructor(message = 'Authentication failed') {
    super(message, 'AUTH_FAILED', false);
    this.name = 'AuthenticationError';
  }
}

/** Request timeout errors */
export class TimeoutError extends FlashQError {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message, 'REQUEST_TIMEOUT', true);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Validation errors (client-side) */
export class ValidationError extends FlashQError {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', false);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/** Server-side errors */
export class ServerError extends FlashQError {
  readonly serverCode?: string;

  constructor(message: string, serverCode?: string) {
    const retryable = isRetryableServerError(serverCode);
    super(message, serverCode ?? 'SERVER_ERROR', retryable);
    this.name = 'ServerError';
    this.serverCode = serverCode;
  }
}

/** Job not found */
export class JobNotFoundError extends FlashQError {
  readonly jobId: number | string;

  constructor(jobId: number | string) {
    super(`Job not found: ${jobId}`, 'JOB_NOT_FOUND', false);
    this.name = 'JobNotFoundError';
    this.jobId = jobId;
  }
}

/** Queue not found */
export class QueueNotFoundError extends FlashQError {
  readonly queue: string;

  constructor(queue: string) {
    super(`Queue not found: ${queue}`, 'QUEUE_NOT_FOUND', false);
    this.name = 'QueueNotFoundError';
    this.queue = queue;
  }
}

/** Job already exists (duplicate) */
export class DuplicateJobError extends FlashQError {
  readonly existingJobId?: number;

  constructor(message: string, existingJobId?: number) {
    super(message, 'DUPLICATE_JOB', false);
    this.name = 'DuplicateJobError';
    this.existingJobId = existingJobId;
  }
}

/** Queue is paused */
export class QueuePausedError extends FlashQError {
  readonly queue: string;

  constructor(queue: string) {
    super(`Queue is paused: ${queue}`, 'QUEUE_PAUSED', true);
    this.name = 'QueuePausedError';
    this.queue = queue;
  }
}

/** Rate limit exceeded */
export class RateLimitError extends FlashQError {
  readonly queue: string;
  readonly retryAfterMs?: number;

  constructor(queue: string, retryAfterMs?: number) {
    super(`Rate limit exceeded for queue: ${queue}`, 'RATE_LIMITED', true);
    this.name = 'RateLimitError';
    this.queue = queue;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Concurrency limit exceeded */
export class ConcurrencyLimitError extends FlashQError {
  readonly queue: string;

  constructor(queue: string) {
    super(`Concurrency limit exceeded for queue: ${queue}`, 'CONCURRENCY_LIMITED', true);
    this.name = 'ConcurrencyLimitError';
    this.queue = queue;
  }
}

/** Check if server error code is retryable */
function isRetryableServerError(code?: string): boolean {
  if (!code) return false;
  const retryableCodes = [
    'INTERNAL_ERROR',
    'SERVICE_UNAVAILABLE',
    'DATABASE_ERROR',
    'LOCK_TIMEOUT',
  ];
  return retryableCodes.includes(code);
}

/** Parse server error message and return appropriate error class */
export function parseServerError(message: string, serverCode?: string): FlashQError {
  const lowerMessage = message.toLowerCase();

  // Job not found
  if (lowerMessage.includes('job not found') || lowerMessage.includes('job does not exist')) {
    const match = message.match(/\d+/);
    return new JobNotFoundError(match ? parseInt(match[0]) : 0);
  }

  // Queue not found
  if (lowerMessage.includes('queue not found') || lowerMessage.includes('queue does not exist')) {
    const match = message.match(/queue[:\s]+([a-zA-Z0-9_.-]+)/i);
    return new QueueNotFoundError(match?.[1] ?? 'unknown');
  }

  // Duplicate job
  if (lowerMessage.includes('duplicate') || lowerMessage.includes('already exists')) {
    const match = message.match(/\d+/);
    return new DuplicateJobError(message, match ? parseInt(match[0]) : undefined);
  }

  // Queue paused
  if (lowerMessage.includes('queue is paused') || lowerMessage.includes('paused')) {
    const match = message.match(/queue[:\s]+([a-zA-Z0-9_.-]+)/i);
    return new QueuePausedError(match?.[1] ?? 'unknown');
  }

  // Rate limited
  if (lowerMessage.includes('rate limit')) {
    const queueMatch = message.match(/queue[:\s]+([a-zA-Z0-9_.-]+)/i);
    const retryMatch = message.match(/retry after[:\s]+(\d+)/i);
    return new RateLimitError(
      queueMatch?.[1] ?? 'unknown',
      retryMatch ? parseInt(retryMatch[1]) : undefined
    );
  }

  // Concurrency limited
  if (lowerMessage.includes('concurrency limit')) {
    const match = message.match(/queue[:\s]+([a-zA-Z0-9_.-]+)/i);
    return new ConcurrencyLimitError(match?.[1] ?? 'unknown');
  }

  // Auth failed
  if (lowerMessage.includes('auth') || lowerMessage.includes('unauthorized')) {
    return new AuthenticationError(message);
  }

  // Default server error
  return new ServerError(message, serverCode);
}

/** Batch operation partial failure */
export class BatchError<T = unknown> extends FlashQError {
  /** Successfully processed items */
  readonly succeeded: T[];
  /** Failed items with their errors */
  readonly failed: Array<{ index: number; item: unknown; error: Error }>;

  constructor(
    message: string,
    succeeded: T[],
    failed: Array<{ index: number; item: unknown; error: Error }>
  ) {
    super(message, 'BATCH_PARTIAL_FAILURE', false);
    this.name = 'BatchError';
    this.succeeded = succeeded;
    this.failed = failed;
  }

  /** Get number of successful items */
  get successCount(): number {
    return this.succeeded.length;
  }

  /** Get number of failed items */
  get failureCount(): number {
    return this.failed.length;
  }
}

/** All error types exported for instanceof checks */
export const Errors = {
  FlashQError,
  ConnectionError,
  AuthenticationError,
  TimeoutError,
  ValidationError,
  ServerError,
  JobNotFoundError,
  QueueNotFoundError,
  DuplicateJobError,
  QueuePausedError,
  RateLimitError,
  ConcurrencyLimitError,
  BatchError,
};
