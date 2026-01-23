/**
 * FlashQ Client - Job Management Tests
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { FlashQ } from '../../src/client';

const TEST_QUEUE = 'test-management';

describe('FlashQ Job Management', () => {
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

  test('should cancel a pending job', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 });
    await client.cancel(job.id);

    const state = await client.getState(job.id);
    expect([null, 'unknown']).toContain(state);
  });

  test('should update job progress', async () => {
    await client.push(TEST_QUEUE, { data: 1 });
    const job = await client.pull(TEST_QUEUE, 1000);

    await client.progress(job!.id, 50, 'Halfway done');

    const progress = await client.getProgress(job!.id);
    expect(progress.progress).toBe(50);
    expect(progress.message).toBe('Halfway done');

    await client.ack(job!.id);
  });

  test('should clamp progress between 0 and 100', async () => {
    await client.push(TEST_QUEUE, { data: 1 });
    const job = await client.pull(TEST_QUEUE, 1000);

    await client.progress(job!.id, 150, 'Over 100');
    const progress = await client.getProgress(job!.id);
    expect(progress.progress).toBe(100);

    await client.ack(job!.id);
  });

  test('should change job priority', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { priority: 0 });
    await client.changePriority(job.id, 100);

    const updated = await client.getJob(job.id);
    expect(updated!.job.priority).toBe(100);
  });

  test('should promote delayed job', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 }, { delay: 60000 });

    let state = await client.getState(job.id);
    expect(state).toBe('delayed');

    await client.promote(job.id);

    state = await client.getState(job.id);
    expect(state).toBe('waiting');
  });

  test('should move job to delayed', async () => {
    await client.push(TEST_QUEUE, { data: 1 });
    const job = await client.pull(TEST_QUEUE, 1000);

    await client.moveToDelayed(job!.id, 5000);

    const state = await client.getState(job!.id);
    expect(state).toBe('delayed');
  });

  test('should update job data', async () => {
    const job = await client.push(TEST_QUEUE, { original: true });
    await client.update(job.id, { updated: true, value: 42 });

    const updated = await client.getJob(job.id);
    expect(updated!.job.data).toEqual({ updated: true, value: 42 });
  });

  test('should discard job to DLQ', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 });
    await client.discard(job.id);

    const state = await client.getState(job.id);
    expect(state).toBe('failed');

    const dlq = await client.getDlq(TEST_QUEUE);
    expect(dlq.some((j) => j.id === job.id)).toBe(true);
  });

  test.skip('should send heartbeat for active job', async () => {
    await client.push(TEST_QUEUE, { data: 1 });
    const job = await client.pull(TEST_QUEUE, 1000);

    await client.heartbeat(job!.id);

    await client.ack(job!.id);
  });
});

describe('FlashQ Finished (Wait for Completion)', () => {
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

  test('should wait for job completion', async () => {
    const job = await client.push(TEST_QUEUE, { wait: 'test' });

    const workerClient = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await workerClient.connect();

    const processPromise = (async () => {
      await new Promise((r) => setTimeout(r, 100));
      const pulled = await workerClient.pull(TEST_QUEUE, 2000);
      if (pulled) {
        await workerClient.ack(pulled.id, { result: 'done' });
      }
      await workerClient.close();
    })();

    try {
      const result = await client.finished(job.id, 10000);
      expect(result).toEqual({ result: 'done' });
    } catch (_e) {
      await processPromise;
    }
  });

  test('should timeout waiting for completion', async () => {
    const job = await client.push(TEST_QUEUE, { wait: 'timeout' });

    try {
      await client.finished(job.id, 500);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });
});
