/**
 * FlashQ Client - Job Query Tests
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { FlashQ } from '../../src/client';

const TEST_QUEUE = 'test-query';

describe('FlashQ Job Query Operations', () => {
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

  test('should get job with state', async () => {
    const pushed = await client.push(TEST_QUEUE, { query: 'test' });
    const result = await client.getJob(pushed.id);

    expect(result).not.toBeNull();
    expect(result!.job.id).toBe(pushed.id);
    expect(result!.state).toBe('waiting');
  });

  test('should get job state only', async () => {
    const pushed = await client.push(TEST_QUEUE, { data: 1 });
    const state = await client.getState(pushed.id);
    expect(state).toBe('waiting');
  });

  test('should get job by custom ID', async () => {
    const customId = `lookup-${Date.now()}`;
    await client.push(TEST_QUEUE, { data: 1 }, { jobId: customId });

    const result = await client.getJobByCustomId(customId);
    expect(result).not.toBeNull();
    expect(result!.job.custom_id).toBe(customId);
  });

  test('should return null for non-existent job', async () => {
    const result = await client.getJob(999999999);
    expect(result).toBeNull();
  });

  test('should return null for non-existent custom ID', async () => {
    const result = await client.getJobByCustomId('non-existent-id');
    expect(result).toBeNull();
  });

  test('should get result for completed job', async () => {
    const pushed = await client.push(TEST_QUEUE, { data: 1 });
    const pulled = await client.pull(TEST_QUEUE, 1000);
    await client.ack(pulled!.id, { result: 'success' });

    const result = await client.getResult<{ result: string }>(pushed.id);
    expect(result).toEqual({ result: 'success' });
  });

  test('should get jobs batch', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const job = await client.push(TEST_QUEUE, { i });
      ids.push(job.id);
    }

    const jobs = await client.getJobsBatch(ids);
    expect(jobs.length).toBe(5);
    jobs.forEach((j) => expect(ids).toContain(j.job.id));
  });

  test('should get jobs with filtering', async () => {
    await client.push(TEST_QUEUE, { type: 'waiting' });
    await client.push(TEST_QUEUE, { type: 'delayed' }, { delay: 60000 });

    const result = await client.getJobs({ queue: TEST_QUEUE });
    expect(result.jobs.length).toBeGreaterThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  test('should get jobs with state filter', async () => {
    await client.push(TEST_QUEUE, { type: 'waiting' });

    const result = await client.getJobs({ queue: TEST_QUEUE, state: 'waiting' });
    expect(result.jobs.every((j) => j.state === 'waiting')).toBe(true);
  });

  test('should get jobs with pagination', async () => {
    for (let i = 0; i < 15; i++) {
      await client.push(TEST_QUEUE, { i });
    }

    const page1 = await client.getJobs({ queue: TEST_QUEUE, limit: 10, offset: 0 });
    const page2 = await client.getJobs({ queue: TEST_QUEUE, limit: 10, offset: 10 });

    expect(page1.jobs.length).toBe(10);
    expect(page2.jobs.length).toBeGreaterThanOrEqual(5);
  });
});
