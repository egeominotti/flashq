/**
 * Validation Utilities Tests
 */
import { describe, test, expect } from 'bun:test';
import {
  validateQueueName,
  validateJobDataSize,
  validateBatchSize,
  validateJobId,
  validateTimeout,
  MAX_JOB_DATA_SIZE,
  MAX_BATCH_SIZE,
} from '../../src/client/validation';
import { ValidationError } from '../../src/errors';

describe('validateQueueName', () => {
  test('accepts valid queue names', () => {
    expect(() => validateQueueName('my-queue')).not.toThrow();
    expect(() => validateQueueName('queue_name')).not.toThrow();
    expect(() => validateQueueName('queue.name')).not.toThrow();
    expect(() => validateQueueName('Queue123')).not.toThrow();
    expect(() => validateQueueName('a')).not.toThrow();
    expect(() => validateQueueName('A'.repeat(256))).not.toThrow();
  });

  test('rejects empty queue name', () => {
    expect(() => validateQueueName('')).toThrow(ValidationError);
    expect(() => validateQueueName('')).toThrow('Queue name is required');
  });

  test('rejects non-string queue name', () => {
    expect(() => validateQueueName(null as unknown as string)).toThrow(ValidationError);
    expect(() => validateQueueName(undefined as unknown as string)).toThrow(ValidationError);
    expect(() => validateQueueName(123 as unknown as string)).toThrow(ValidationError);
  });

  test('rejects queue names with invalid characters', () => {
    expect(() => validateQueueName('queue name')).toThrow(ValidationError);
    expect(() => validateQueueName('queue/name')).toThrow(ValidationError);
    expect(() => validateQueueName('queue:name')).toThrow(ValidationError);
    expect(() => validateQueueName('queue@name')).toThrow(ValidationError);
    expect(() => validateQueueName('queue#name')).toThrow(ValidationError);
    expect(() => validateQueueName('queue$name')).toThrow(ValidationError);
  });

  test('rejects queue names exceeding max length', () => {
    expect(() => validateQueueName('A'.repeat(257))).toThrow(ValidationError);
    expect(() => validateQueueName('A'.repeat(257))).toThrow('Invalid queue name');
  });

  test('error includes field name', () => {
    try {
      validateQueueName('invalid queue');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe('queue');
    }
  });
});

describe('validateJobDataSize', () => {
  test('accepts data within size limit', () => {
    expect(() => validateJobDataSize({ small: 'data' })).not.toThrow();
    expect(() => validateJobDataSize('string data')).not.toThrow();
    expect(() => validateJobDataSize(123)).not.toThrow();
    expect(() => validateJobDataSize(null)).not.toThrow();
    expect(() => validateJobDataSize([])).not.toThrow();
  });

  test('accepts data near size limit', () => {
    // Create data that's just under the limit
    const largeData = 'x'.repeat(MAX_JOB_DATA_SIZE - 10);
    expect(() => validateJobDataSize(largeData)).not.toThrow();
  });

  test('rejects data exceeding size limit', () => {
    // Create data that exceeds the limit
    const hugeData = 'x'.repeat(MAX_JOB_DATA_SIZE + 100);
    expect(() => validateJobDataSize(hugeData)).toThrow(ValidationError);
    expect(() => validateJobDataSize(hugeData)).toThrow('exceeds max');
  });

  test('error includes field name', () => {
    const hugeData = 'x'.repeat(MAX_JOB_DATA_SIZE + 100);
    try {
      validateJobDataSize(hugeData);
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe('data');
    }
  });
});

describe('validateBatchSize', () => {
  test('accepts batch sizes within limit', () => {
    expect(() => validateBatchSize(1, 'push')).not.toThrow();
    expect(() => validateBatchSize(100, 'push')).not.toThrow();
    expect(() => validateBatchSize(MAX_BATCH_SIZE, 'push')).not.toThrow();
  });

  test('rejects batch sizes exceeding limit', () => {
    expect(() => validateBatchSize(MAX_BATCH_SIZE + 1, 'push')).toThrow(ValidationError);
    expect(() => validateBatchSize(2000, 'pull')).toThrow(ValidationError);
  });

  test('error message includes operation name', () => {
    try {
      validateBatchSize(1500, 'push');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toContain('push');
    }
  });

  test('error includes field name', () => {
    try {
      validateBatchSize(1500, 'push');
    } catch (e) {
      expect((e as ValidationError).field).toBe('batch');
    }
  });
});

describe('validateJobId', () => {
  test('accepts positive integers', () => {
    expect(() => validateJobId(1)).not.toThrow();
    expect(() => validateJobId(100)).not.toThrow();
    expect(() => validateJobId(999999)).not.toThrow();
  });

  test('rejects zero', () => {
    expect(() => validateJobId(0)).toThrow(ValidationError);
    expect(() => validateJobId(0)).toThrow('positive integer');
  });

  test('rejects negative numbers', () => {
    expect(() => validateJobId(-1)).toThrow(ValidationError);
    expect(() => validateJobId(-100)).toThrow(ValidationError);
  });

  test('rejects non-integers', () => {
    expect(() => validateJobId(1.5)).toThrow(ValidationError);
    expect(() => validateJobId(NaN)).toThrow(ValidationError);
    expect(() => validateJobId(Infinity)).toThrow(ValidationError);
  });

  test('error includes field name', () => {
    try {
      validateJobId(-1);
    } catch (e) {
      expect((e as ValidationError).field).toBe('jobId');
    }
  });
});

describe('validateTimeout', () => {
  test('accepts valid timeout within default bounds', () => {
    expect(() => validateTimeout(0)).not.toThrow();
    expect(() => validateTimeout(1000)).not.toThrow();
    expect(() => validateTimeout(60000)).not.toThrow();
    expect(() => validateTimeout(600000)).not.toThrow();
  });

  test('rejects timeout below minimum', () => {
    expect(() => validateTimeout(-1)).toThrow(ValidationError);
    expect(() => validateTimeout(-1000)).toThrow(ValidationError);
  });

  test('rejects timeout above maximum', () => {
    expect(() => validateTimeout(600001)).toThrow(ValidationError);
    expect(() => validateTimeout(1000000)).toThrow(ValidationError);
  });

  test('accepts custom bounds', () => {
    expect(() => validateTimeout(500, 100, 1000)).not.toThrow();
    expect(() => validateTimeout(100, 100, 1000)).not.toThrow();
    expect(() => validateTimeout(1000, 100, 1000)).not.toThrow();
  });

  test('rejects values outside custom bounds', () => {
    expect(() => validateTimeout(50, 100, 1000)).toThrow(ValidationError);
    expect(() => validateTimeout(1500, 100, 1000)).toThrow(ValidationError);
  });

  test('error message includes bounds', () => {
    try {
      validateTimeout(5000, 0, 1000);
    } catch (e) {
      expect((e as ValidationError).message).toContain('0-1000');
    }
  });

  test('error includes field name', () => {
    try {
      validateTimeout(-1);
    } catch (e) {
      expect((e as ValidationError).field).toBe('timeout');
    }
  });
});

describe('constants', () => {
  test('MAX_JOB_DATA_SIZE is 1MB', () => {
    expect(MAX_JOB_DATA_SIZE).toBe(1024 * 1024);
  });

  test('MAX_BATCH_SIZE is 1000', () => {
    expect(MAX_BATCH_SIZE).toBe(1000);
  });
});

// Import mapJobToPayload for testing
import { mapJobToPayload, type JobPayload } from '../../src/client/validation';
import { DEFAULT_JOB_PRIORITY } from '../../src/constants';

describe('mapJobToPayload', () => {
  test('maps minimal data with defaults', () => {
    const payload = mapJobToPayload({ email: 'test@example.com' });

    expect(payload.data).toEqual({ email: 'test@example.com' });
    expect(payload.priority).toBe(DEFAULT_JOB_PRIORITY);
    expect(payload.lifo).toBe(false);
    expect(payload.remove_on_complete).toBe(false);
    expect(payload.remove_on_fail).toBe(false);
    expect(payload.delay).toBeUndefined();
    expect(payload.ttl).toBeUndefined();
    expect(payload.timeout).toBeUndefined();
    expect(payload.max_attempts).toBeUndefined();
    expect(payload.backoff).toBeUndefined();
    expect(payload.unique_key).toBeUndefined();
    expect(payload.depends_on).toBeUndefined();
    expect(payload.tags).toBeUndefined();
    expect(payload.job_id).toBeUndefined();
    expect(payload.group_id).toBeUndefined();
  });

  test('maps all options correctly', () => {
    const payload = mapJobToPayload(
      { task: 'process' },
      {
        priority: 10,
        delay: 5000,
        ttl: 60000,
        timeout: 30000,
        max_attempts: 3,
        backoff: 1000,
        unique_key: 'unique-123',
        depends_on: [1, 2, 3],
        tags: ['important', 'urgent'],
        lifo: true,
        remove_on_complete: true,
        remove_on_fail: true,
        stall_timeout: 15000,
        debounce_id: 'debounce-1',
        debounce_ttl: 2000,
        jobId: 'custom-job-id',
        keepCompletedAge: 86400000,
        keepCompletedCount: 100,
        group_id: 'group-1',
      }
    );

    expect(payload.data).toEqual({ task: 'process' });
    expect(payload.priority).toBe(10);
    expect(payload.delay).toBe(5000);
    expect(payload.ttl).toBe(60000);
    expect(payload.timeout).toBe(30000);
    expect(payload.max_attempts).toBe(3);
    expect(payload.backoff).toBe(1000);
    expect(payload.unique_key).toBe('unique-123');
    expect(payload.depends_on).toEqual([1, 2, 3]);
    expect(payload.tags).toEqual(['important', 'urgent']);
    expect(payload.lifo).toBe(true);
    expect(payload.remove_on_complete).toBe(true);
    expect(payload.remove_on_fail).toBe(true);
    expect(payload.stall_timeout).toBe(15000);
    expect(payload.debounce_id).toBe('debounce-1');
    expect(payload.debounce_ttl).toBe(2000);
    expect(payload.job_id).toBe('custom-job-id');
    expect(payload.keep_completed_age).toBe(86400000);
    expect(payload.keep_completed_count).toBe(100);
    expect(payload.group_id).toBe('group-1');
  });

  test('maps partial options with correct defaults', () => {
    const payload = mapJobToPayload(
      { data: 'value' },
      { priority: 5, delay: 1000 }
    );

    expect(payload.data).toEqual({ data: 'value' });
    expect(payload.priority).toBe(5);
    expect(payload.delay).toBe(1000);
    expect(payload.lifo).toBe(false);
    expect(payload.remove_on_complete).toBe(false);
    expect(payload.remove_on_fail).toBe(false);
  });

  test('handles empty options object', () => {
    const payload = mapJobToPayload('string-data', {});

    expect(payload.data).toBe('string-data');
    expect(payload.priority).toBe(DEFAULT_JOB_PRIORITY);
    expect(payload.lifo).toBe(false);
  });

  test('preserves data types', () => {
    // String data
    expect(mapJobToPayload('string').data).toBe('string');

    // Number data
    expect(mapJobToPayload(123).data).toBe(123);

    // Array data
    expect(mapJobToPayload([1, 2, 3]).data).toEqual([1, 2, 3]);

    // Null data
    expect(mapJobToPayload(null).data).toBeNull();

    // Complex object
    const complex = { nested: { deep: { value: true } }, arr: [1, 2] };
    expect(mapJobToPayload(complex).data).toEqual(complex);
  });

  test('returns correct TypeScript type', () => {
    const payload: JobPayload<{ email: string }> = mapJobToPayload({ email: 'test@test.com' });
    expect(payload.data.email).toBe('test@test.com');
  });
});
