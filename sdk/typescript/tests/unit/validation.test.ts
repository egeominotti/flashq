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
