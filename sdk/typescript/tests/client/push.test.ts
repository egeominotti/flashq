/**
 * FlashQ Client - Push Tests
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { FlashQ } from '../../src/client';

const TEST_QUEUE = 'test-push';

describe('FlashQ Push Operations', () => {
  let client: FlashQ;

  beforeAll(async () => {
    client = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await client.connect();
  });

  afterAll(async () => {
    await client.obliterate(TEST_QUEUE);
    await client.close();
  });

  beforeEach(async () => {
    await client.obliterate(TEST_QUEUE);
  });

  test('should push a job', async () => {
    const job = await client.push(TEST_QUEUE, { message: 'hello' });
    expect(job.id).toBeGreaterThan(0);
    expect(job.queue).toBe(TEST_QUEUE);
    expect(job.data).toEqual({ message: 'hello' });
  });

  test('should push with priority', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { priority: 10 });
    expect(job.priority).toBe(10);
  });

  test('should push with delay', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { delay: 5000 });
    expect(job.run_at).toBeGreaterThan(Date.now());
  });

  test('should push with custom jobId', async () => {
    const customId = `custom-${Date.now()}`;
    const job = await client.push(TEST_QUEUE, { data: 1 }, { jobId: customId });
    expect(job.custom_id).toBe(customId);
  });

  test('should push with max_attempts', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { max_attempts: 5 });
    expect(job.max_attempts).toBe(5);
  });

  test('should push with backoff', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { backoff: 2000 });
    expect(job.backoff).toBe(2000);
  });

  test('should push with tags', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { tags: ['important', 'email'] });
    expect(job.tags).toEqual(['important', 'email']);
  });

  test('should push with ttl', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { ttl: 60000 });
    expect(job.ttl).toBe(60000);
  });

  test('should push with timeout', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { timeout: 30000 });
    expect(job.timeout).toBe(30000);
  });

  test('should push with unique_key', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { unique_key: 'unique-123' });
    expect(job.unique_key).toBe('unique-123');
  });

  test('should push with lifo mode', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { lifo: true });
    expect(job.lifo).toBe(true);
  });

  test('should push with remove_on_complete', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { remove_on_complete: true });
    expect(job.remove_on_complete).toBe(true);
  });

  test('should push with remove_on_fail', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { remove_on_fail: true });
    expect(job.remove_on_fail).toBe(true);
  });

  test('should push with stall_timeout', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { stall_timeout: 60000 });
    expect(job.stall_timeout).toBe(60000);
  });

  test('should push with keepCompletedAge', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { keepCompletedAge: 86400000 });
    expect(job.keep_completed_age).toBe(86400000);
  });

  test('should push with keepCompletedCount', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { keepCompletedCount: 100 });
    expect(job.keep_completed_count).toBe(100);
  });

  test('add() should be alias for push()', async () => {
    const job = await client.add(TEST_QUEUE, { message: 'test' });
    expect(job.id).toBeGreaterThan(0);
  });
});

describe('FlashQ Batch Push Operations', () => {
  let client: FlashQ;

  beforeAll(async () => {
    client = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await client.connect();
  });

  afterAll(async () => {
    await client.obliterate(TEST_QUEUE);
    await client.close();
  });

  beforeEach(async () => {
    await client.obliterate(TEST_QUEUE);
  });

  test('should push batch of jobs', async () => {
    const jobs = Array.from({ length: 10 }, (_, i) => ({ data: { index: i } }));
    const ids = await client.pushBatch(TEST_QUEUE, jobs);
    expect(ids).toHaveLength(10);
    ids.forEach(id => expect(id).toBeGreaterThan(0));
  });

  test('should push batch with mixed options', async () => {
    const jobs = [
      { data: { type: 'normal' } },
      { data: { type: 'priority' }, priority: 10 },
      { data: { type: 'delayed' }, delay: 1000 },
      { data: { type: 'retry' }, max_attempts: 5 },
    ];
    const ids = await client.pushBatch(TEST_QUEUE, jobs);
    expect(ids).toHaveLength(4);
  });

  test('addBulk() should be alias for pushBatch()', async () => {
    const jobs = [{ data: { a: 1 } }, { data: { a: 2 } }];
    const ids = await client.addBulk(TEST_QUEUE, jobs);
    expect(ids).toHaveLength(2);
  });

  test('should push large batch', async () => {
    const jobs = Array.from({ length: 100 }, (_, i) => ({ data: { index: i } }));
    const ids = await client.pushBatch(TEST_QUEUE, jobs);
    expect(ids).toHaveLength(100);
  });
});
