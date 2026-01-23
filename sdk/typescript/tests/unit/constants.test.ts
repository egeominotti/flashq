/**
 * Constants Tests
 *
 * Verifies all SDK constants are correctly defined and exported.
 */
import { describe, test, expect } from 'bun:test';
import * as Constants from '../../src/constants';

describe('Validation Limits', () => {
  test('MAX_JOB_DATA_SIZE is 1MB', () => {
    expect(Constants.MAX_JOB_DATA_SIZE).toBe(1024 * 1024);
  });

  test('MAX_BATCH_SIZE is 1000', () => {
    expect(Constants.MAX_BATCH_SIZE).toBe(1000);
  });

  test('MAX_QUEUE_NAME_LENGTH is 256', () => {
    expect(Constants.MAX_QUEUE_NAME_LENGTH).toBe(256);
  });
});

describe('Timeout Defaults', () => {
  test('DEFAULT_CONNECTION_TIMEOUT is 5000ms', () => {
    expect(Constants.DEFAULT_CONNECTION_TIMEOUT).toBe(5000);
  });

  test('DEFAULT_PULL_TIMEOUT is 60000ms', () => {
    expect(Constants.DEFAULT_PULL_TIMEOUT).toBe(60000);
  });

  test('CLIENT_TIMEOUT_BUFFER is 5000ms', () => {
    expect(Constants.CLIENT_TIMEOUT_BUFFER).toBe(5000);
  });

  test('DEFAULT_FINISHED_TIMEOUT is 30000ms', () => {
    expect(Constants.DEFAULT_FINISHED_TIMEOUT).toBe(30000);
  });
});

describe('Worker Defaults', () => {
  test('DEFAULT_WORKER_CONCURRENCY is 10', () => {
    expect(Constants.DEFAULT_WORKER_CONCURRENCY).toBe(10);
  });

  test('DEFAULT_WORKER_BATCH_SIZE is 100', () => {
    expect(Constants.DEFAULT_WORKER_BATCH_SIZE).toBe(100);
  });

  test('WORKER_PULL_TIMEOUT is 500ms (for responsive shutdown)', () => {
    expect(Constants.WORKER_PULL_TIMEOUT).toBe(500);
  });

  test('WORKER_ERROR_RETRY_DELAY is 1000ms', () => {
    expect(Constants.WORKER_ERROR_RETRY_DELAY).toBe(1000);
  });

  test('DEFAULT_CLOSE_TIMEOUT is 30000ms', () => {
    expect(Constants.DEFAULT_CLOSE_TIMEOUT).toBe(30000);
  });

  test('WORKER_JOB_CHECK_INTERVAL is 50ms', () => {
    expect(Constants.WORKER_JOB_CHECK_INTERVAL).toBe(50);
  });
});

describe('Reconnection Defaults', () => {
  test('DEFAULT_RECONNECT_DELAY is 1000ms', () => {
    expect(Constants.DEFAULT_RECONNECT_DELAY).toBe(1000);
  });

  test('DEFAULT_MAX_RECONNECT_DELAY is 30000ms', () => {
    expect(Constants.DEFAULT_MAX_RECONNECT_DELAY).toBe(30000);
  });

  test('DEFAULT_MAX_RECONNECT_ATTEMPTS is 10', () => {
    expect(Constants.DEFAULT_MAX_RECONNECT_ATTEMPTS).toBe(10);
  });

  test('RECONNECT_JITTER_FACTOR is 0.3 (30%)', () => {
    expect(Constants.RECONNECT_JITTER_FACTOR).toBe(0.3);
  });
});

describe('Retry Defaults', () => {
  test('DEFAULT_RETRY_MAX_ATTEMPTS is 3', () => {
    expect(Constants.DEFAULT_RETRY_MAX_ATTEMPTS).toBe(3);
  });

  test('DEFAULT_RETRY_INITIAL_DELAY is 100ms', () => {
    expect(Constants.DEFAULT_RETRY_INITIAL_DELAY).toBe(100);
  });

  test('DEFAULT_RETRY_MAX_DELAY is 5000ms', () => {
    expect(Constants.DEFAULT_RETRY_MAX_DELAY).toBe(5000);
  });

  test('DEFAULT_BACKOFF_MULTIPLIER is 2', () => {
    expect(Constants.DEFAULT_BACKOFF_MULTIPLIER).toBe(2);
  });

  test('RETRY_JITTER_FACTOR is 0.25 (±25%)', () => {
    expect(Constants.RETRY_JITTER_FACTOR).toBe(0.25);
  });
});

describe('Compression Defaults', () => {
  test('DEFAULT_COMPRESSION_ENABLED is false', () => {
    expect(Constants.DEFAULT_COMPRESSION_ENABLED).toBe(false);
  });

  test('DEFAULT_COMPRESSION_THRESHOLD is 1024 bytes', () => {
    expect(Constants.DEFAULT_COMPRESSION_THRESHOLD).toBe(1024);
  });
});

describe('Request Queue Defaults', () => {
  test('DEFAULT_MAX_QUEUED_REQUESTS is 100', () => {
    expect(Constants.DEFAULT_MAX_QUEUED_REQUESTS).toBe(100);
  });
});

describe('Job Defaults', () => {
  test('DEFAULT_JOB_PRIORITY is 0', () => {
    expect(Constants.DEFAULT_JOB_PRIORITY).toBe(0);
  });

  test('DEFAULT_STALL_TIMEOUT is 30000ms', () => {
    expect(Constants.DEFAULT_STALL_TIMEOUT).toBe(30000);
  });
});

describe('Port Defaults', () => {
  test('DEFAULT_TCP_PORT is 6789', () => {
    expect(Constants.DEFAULT_TCP_PORT).toBe(6789);
  });

  test('DEFAULT_HTTP_PORT is 6790', () => {
    expect(Constants.DEFAULT_HTTP_PORT).toBe(6790);
  });

  test('DEFAULT_HOST is localhost', () => {
    expect(Constants.DEFAULT_HOST).toBe('localhost');
  });
});

describe('Constants Export', () => {
  test('all constants are exported from index', async () => {
    const { Constants: ExportedConstants } = await import('../../src/index');

    // Verify namespace export works
    expect(ExportedConstants).toBeDefined();
    expect(ExportedConstants.MAX_JOB_DATA_SIZE).toBe(1024 * 1024);
    expect(ExportedConstants.DEFAULT_TCP_PORT).toBe(6789);
  });
});
