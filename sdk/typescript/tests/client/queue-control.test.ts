/**
 * FlashQ Client - Queue Control Tests
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { FlashQ } from '../../src/client';

const TEST_QUEUE = 'test-queue-control';

describe('FlashQ Queue Management', () => {
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

  test('should pause and resume queue', async () => {
    await client.pause(TEST_QUEUE);
    let paused = await client.isPaused(TEST_QUEUE);
    expect(paused).toBe(true);

    await client.resume(TEST_QUEUE);
    paused = await client.isPaused(TEST_QUEUE);
    expect(paused).toBe(false);
  });

  test('should get queue count', async () => {
    await client.pushBatch(TEST_QUEUE, [
      { data: { i: 1 } },
      { data: { i: 2 } },
      { data: { i: 3 } },
    ]);

    const count = await client.count(TEST_QUEUE);
    expect(count).toBe(3);
  });

  test('should get job counts by state', async () => {
    await client.push(TEST_QUEUE, { data: 1 });
    await client.push(TEST_QUEUE, { data: 2 }, { delay: 60000 });

    const counts = await client.getJobCounts(TEST_QUEUE);
    expect(counts.waiting).toBeGreaterThanOrEqual(1);
    expect(counts.delayed).toBeGreaterThanOrEqual(1);
    expect(counts).toHaveProperty('active');
    expect(counts).toHaveProperty('completed');
    expect(counts).toHaveProperty('failed');
  });

  test('should drain queue', async () => {
    await client.pushBatch(TEST_QUEUE, [
      { data: { i: 1 } },
      { data: { i: 2 } },
    ]);

    const drained = await client.drain(TEST_QUEUE);
    expect(drained).toBeGreaterThanOrEqual(2);

    const count = await client.count(TEST_QUEUE);
    expect(count).toBe(0);
  });

  test('should list queues', async () => {
    await client.push(TEST_QUEUE, { data: 1 });

    const queues = await client.listQueues();
    expect(queues.length).toBeGreaterThan(0);
    expect(queues.some(q => q.name === TEST_QUEUE)).toBe(true);
  });

  test('should obliterate queue', async () => {
    const tempQueue = 'test-obliterate';
    await client.push(tempQueue, { data: 1 });
    await client.push(tempQueue, { data: 2 });

    const removed = await client.obliterate(tempQueue);
    expect(removed).toBeGreaterThanOrEqual(2);

    const count = await client.count(tempQueue);
    expect(count).toBe(0);
  });

  test('should clean jobs by state and grace', async () => {
    await client.push(TEST_QUEUE, { data: 1 });
    const pulled = await client.pull(TEST_QUEUE, 1000);
    if (pulled) await client.ack(pulled.id);

    const cleaned = await client.clean(TEST_QUEUE, 0, 'completed');
    expect(cleaned).toBeGreaterThanOrEqual(0);
  });

  test('should clean with limit', async () => {
    for (let i = 0; i < 5; i++) {
      await client.push(TEST_QUEUE, { i });
      const pulled = await client.pull(TEST_QUEUE, 1000);
      if (pulled) await client.ack(pulled.id);
    }

    const cleaned = await client.clean(TEST_QUEUE, 0, 'completed', 2);
    expect(cleaned).toBeLessThanOrEqual(2);
  });
});

describe('FlashQ Rate Limiting', () => {
  let client: FlashQ;

  beforeAll(async () => {
    client = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await client.connect();
  });

  afterAll(async () => {
    await client.obliterate(TEST_QUEUE);
    await client.close();
  });

  test('should set and clear rate limit', async () => {
    await client.setRateLimit(TEST_QUEUE, 100);
    await client.clearRateLimit(TEST_QUEUE);
  });

  test('should set and clear concurrency limit', async () => {
    await client.setConcurrency(TEST_QUEUE, 5);
    await client.clearConcurrency(TEST_QUEUE);
  });
});
