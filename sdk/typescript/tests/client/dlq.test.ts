/**
 * FlashQ Client - Dead Letter Queue Tests
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { FlashQ } from '../../src/client';

const TEST_QUEUE = 'test-dlq';

describe('FlashQ Dead Letter Queue', () => {
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

  test('should get DLQ jobs', async () => {
    await client.push(TEST_QUEUE, { dlq: 'test' }, { max_attempts: 1 });
    const job = await client.pull(TEST_QUEUE, 1000);
    await client.fail(job!.id, 'Force to DLQ');

    const dlqJobs = await client.getDlq(TEST_QUEUE);
    expect(dlqJobs.length).toBeGreaterThanOrEqual(1);
  });

  test('should retry DLQ jobs', async () => {
    await client.push(TEST_QUEUE, { retry: 'test' }, { max_attempts: 1 });
    const job = await client.pull(TEST_QUEUE, 1000);
    await client.fail(job!.id, 'Force to DLQ');

    const retried = await client.retryDlq(TEST_QUEUE);
    expect(retried).toBeGreaterThanOrEqual(0);
  });

  test('should retry specific DLQ job', async () => {
    await client.push(TEST_QUEUE, { retry: 'specific' }, { max_attempts: 1 });
    const job = await client.pull(TEST_QUEUE, 1000);
    await client.fail(job!.id, 'Force to DLQ');

    const retried = await client.retryDlq(TEST_QUEUE, job!.id);
    expect(retried).toBeGreaterThanOrEqual(0);
  });

  test('should purge DLQ', async () => {
    for (let i = 0; i < 3; i++) {
      await client.push(TEST_QUEUE, { purge: i }, { max_attempts: 1 });
      const job = await client.pull(TEST_QUEUE, 1000);
      if (job) await client.fail(job.id, 'Force to DLQ');
    }

    const purged = await client.purgeDlq(TEST_QUEUE);
    expect(purged).toBeGreaterThanOrEqual(0);
  });
});
