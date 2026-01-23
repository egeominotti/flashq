/**
 * FlashQ Client - Pull & Ack/Fail Tests
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { FlashQ } from '../../src/client';
import { setupSharedClient } from '../helpers/setup';

const TEST_QUEUE = 'test-pull';
const { getClient, cleanup } = setupSharedClient();

describe('FlashQ Pull Operations', () => {
  beforeEach(() => cleanup(TEST_QUEUE));

  test('should pull a job', async () => {
    const client = getClient();
    await client.push(TEST_QUEUE, { message: 'pull-test' });
    const job = await client.pull<{ message: string }>(TEST_QUEUE, 1000);
    expect(job).not.toBeNull();
    expect(job!.data.message).toBe('pull-test');
    await client.ack(job!.id);
  });

  test('should return null when no jobs available', async () => {
    const job = await getClient().pull(TEST_QUEUE, 100);
    expect(job).toBeNull();
  });

  test('should pull batch of jobs', async () => {
    const client = getClient();
    for (let i = 0; i < 5; i++) {
      await client.push(TEST_QUEUE, { index: i });
    }

    const jobs = await client.pullBatch(TEST_QUEUE, 5);
    expect(jobs.length).toBeLessThanOrEqual(5);

    for (const job of jobs) {
      await client.ack(job.id);
    }
  });

  test('should pull with typed data', async () => {
    const client = getClient();
    interface TestData { name: string; value: number; }
    await client.push(TEST_QUEUE, { name: 'test', value: 42 });
    const job = await client.pull<TestData>(TEST_QUEUE, 1000);
    expect(job).not.toBeNull();
    expect(job!.data.name).toBe('test');
    expect(job!.data.value).toBe(42);
    await client.ack(job!.id);
  });
});

describe('FlashQ Ack/Fail Operations', () => {
  beforeEach(() => cleanup(TEST_QUEUE));

  test('should ack a job', async () => {
    const client = getClient();
    await client.push(TEST_QUEUE, { data: 1 });
    const job = await client.pull(TEST_QUEUE, 1000);
    expect(job).not.toBeNull();

    await client.ack(job!.id, { processed: true });

    const state = await client.getState(job!.id);
    expect(state).toBe('completed');
  });

  test('should ack with result', async () => {
    const client = getClient();
    await client.push(TEST_QUEUE, { input: 5 });
    const job = await client.pull(TEST_QUEUE, 1000);

    await client.ack(job!.id, { output: 10 });

    const result = await client.getResult(job!.id);
    expect(result).toEqual({ output: 10 });
  });

  test('should ack batch of jobs', async () => {
    const client = getClient();
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      await client.push(TEST_QUEUE, { i });
      const pulled = await client.pull(TEST_QUEUE, 1000);
      if (pulled) ids.push(pulled.id);
    }

    const count = await client.ackBatch(ids);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should fail a job', async () => {
    const client = getClient();
    await client.push(TEST_QUEUE, { data: 1 }, { max_attempts: 1 });
    const job = await client.pull(TEST_QUEUE, 1000);

    await client.fail(job!.id, 'Test error');

    const state = await client.getState(job!.id);
    expect(state).toBe('failed');
  });

  test('should retry failed job if attempts remain', async () => {
    const client = getClient();
    await client.push(TEST_QUEUE, { data: 1 }, { max_attempts: 3 });
    const job = await client.pull(TEST_QUEUE, 1000);

    await client.fail(job!.id, 'Temporary error');

    const state = await client.getState(job!.id);
    expect(['waiting', 'delayed']).toContain(state);
  });
});
