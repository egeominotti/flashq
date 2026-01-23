/**
 * Error Classes Tests
 */
import { describe, test, expect } from 'bun:test';
import {
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
  parseServerError,
  Errors,
} from '../../src/errors';

describe('Error Classes', () => {
  test('FlashQError has code and retryable properties', () => {
    const error = new FlashQError('Test error', 'TEST_CODE', true);
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('FlashQError');
  });

  test('ConnectionError is retryable by default', () => {
    const error = new ConnectionError('Connection failed');
    expect(error.code).toBe('CONNECTION_FAILED');
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('ConnectionError');
  });

  test('ConnectionError accepts custom code', () => {
    const error = new ConnectionError('Timeout', 'CONNECTION_TIMEOUT');
    expect(error.code).toBe('CONNECTION_TIMEOUT');
  });

  test('AuthenticationError is not retryable', () => {
    const error = new AuthenticationError();
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.retryable).toBe(false);
    expect(error.name).toBe('AuthenticationError');
  });

  test('TimeoutError includes timeout value', () => {
    const error = new TimeoutError('Request timeout', 5000);
    expect(error.code).toBe('REQUEST_TIMEOUT');
    expect(error.timeoutMs).toBe(5000);
    expect(error.retryable).toBe(true);
  });

  test('ValidationError includes field name', () => {
    const error = new ValidationError('Invalid queue name', 'queue');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.field).toBe('queue');
    expect(error.retryable).toBe(false);
  });

  test('JobNotFoundError includes job ID', () => {
    const error = new JobNotFoundError(123);
    expect(error.code).toBe('JOB_NOT_FOUND');
    expect(error.jobId).toBe(123);
    expect(error.message).toContain('123');
  });

  test('QueueNotFoundError includes queue name', () => {
    const error = new QueueNotFoundError('my-queue');
    expect(error.code).toBe('QUEUE_NOT_FOUND');
    expect(error.queue).toBe('my-queue');
  });

  test('DuplicateJobError includes existing job ID', () => {
    const error = new DuplicateJobError('Job already exists', 456);
    expect(error.code).toBe('DUPLICATE_JOB');
    expect(error.existingJobId).toBe(456);
    expect(error.retryable).toBe(false);
  });

  test('QueuePausedError is retryable', () => {
    const error = new QueuePausedError('emails');
    expect(error.code).toBe('QUEUE_PAUSED');
    expect(error.queue).toBe('emails');
    expect(error.retryable).toBe(true);
  });

  test('RateLimitError includes retry info', () => {
    const error = new RateLimitError('emails', 1000);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.queue).toBe('emails');
    expect(error.retryAfterMs).toBe(1000);
    expect(error.retryable).toBe(true);
  });

  test('ConcurrencyLimitError is retryable', () => {
    const error = new ConcurrencyLimitError('tasks');
    expect(error.code).toBe('CONCURRENCY_LIMITED');
    expect(error.queue).toBe('tasks');
    expect(error.retryable).toBe(true);
  });

  test('errors are instanceof Error', () => {
    const errors = [
      new FlashQError('test', 'TEST'),
      new ConnectionError('test'),
      new AuthenticationError(),
      new TimeoutError('test', 1000),
      new ValidationError('test'),
      new ServerError('test'),
      new JobNotFoundError(1),
      new QueueNotFoundError('q'),
      new DuplicateJobError('test'),
      new QueuePausedError('q'),
      new RateLimitError('q'),
      new ConcurrencyLimitError('q'),
    ];

    for (const error of errors) {
      expect(error instanceof Error).toBe(true);
      expect(error instanceof FlashQError).toBe(true);
    }
  });
});

describe('parseServerError', () => {
  test('parses job not found error', () => {
    const error = parseServerError('Job not found: 123');
    expect(error).toBeInstanceOf(JobNotFoundError);
    expect((error as JobNotFoundError).jobId).toBe(123);
  });

  test('parses queue not found error', () => {
    const error = parseServerError('Queue not found: my-queue');
    expect(error).toBeInstanceOf(QueueNotFoundError);
  });

  test('parses duplicate job error', () => {
    const error = parseServerError('Job already exists with id 456');
    expect(error).toBeInstanceOf(DuplicateJobError);
    expect((error as DuplicateJobError).existingJobId).toBe(456);
  });

  test('parses queue paused error', () => {
    const error = parseServerError('Queue is paused: emails');
    expect(error).toBeInstanceOf(QueuePausedError);
  });

  test('parses rate limit error', () => {
    const error = parseServerError('Rate limit exceeded for queue: tasks');
    expect(error).toBeInstanceOf(RateLimitError);
  });

  test('parses concurrency limit error', () => {
    const error = parseServerError('Concurrency limit reached for queue: workers');
    expect(error).toBeInstanceOf(ConcurrencyLimitError);
  });

  test('parses auth error', () => {
    const error = parseServerError('Unauthorized access');
    expect(error).toBeInstanceOf(AuthenticationError);
  });

  test('returns ServerError for unknown errors', () => {
    const error = parseServerError('Something went wrong');
    expect(error).toBeInstanceOf(ServerError);
  });
});

describe('Errors namespace', () => {
  test('exports all error classes', () => {
    expect(Errors.FlashQError).toBe(FlashQError);
    expect(Errors.ConnectionError).toBe(ConnectionError);
    expect(Errors.AuthenticationError).toBe(AuthenticationError);
    expect(Errors.TimeoutError).toBe(TimeoutError);
    expect(Errors.ValidationError).toBe(ValidationError);
    expect(Errors.ServerError).toBe(ServerError);
    expect(Errors.JobNotFoundError).toBe(JobNotFoundError);
    expect(Errors.QueueNotFoundError).toBe(QueueNotFoundError);
    expect(Errors.DuplicateJobError).toBe(DuplicateJobError);
    expect(Errors.QueuePausedError).toBe(QueuePausedError);
    expect(Errors.RateLimitError).toBe(RateLimitError);
    expect(Errors.ConcurrencyLimitError).toBe(ConcurrencyLimitError);
  });
});
