/**
 * FlashQ Client - Cron & Stats Tests
 */
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { FlashQ } from '../../src/client';

const TEST_QUEUE = 'test-cron';
const CRON_NAME = 'test-cron-job';

describe('FlashQ Cron Jobs', () => {
  let client: FlashQ;

  beforeAll(async () => {
    client = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await client.connect();
  });

  afterAll(async () => {
    await client.obliterate(TEST_QUEUE);
    await client.close();
  });

  afterEach(async () => {
    try { await client.deleteCron(CRON_NAME); } catch {}
  });

  test('should add cron job with schedule', async () => {
    await client.addCron(CRON_NAME, {
      queue: TEST_QUEUE,
      data: { cron: true },
      schedule: '0 * * * * *',
    });

    const crons = await client.listCrons();
    expect(crons.some(c => c.name === CRON_NAME)).toBe(true);
  });

  test('should add cron job with repeat_every', async () => {
    await client.addCron(CRON_NAME, {
      queue: TEST_QUEUE,
      data: { cron: true },
      repeat_every: 5000,
    });

    const crons = await client.listCrons();
    const cron = crons.find(c => c.name === CRON_NAME);
    expect(cron).toBeDefined();
    expect(cron!.repeat_every).toBe(5000);
  });

  test('should add cron job with limit', async () => {
    await client.addCron(CRON_NAME, {
      queue: TEST_QUEUE,
      data: { cron: true },
      schedule: '0 * * * * *',
      limit: 10,
    });

    const crons = await client.listCrons();
    const cron = crons.find(c => c.name === CRON_NAME);
    expect(cron).toBeDefined();
    expect(cron!.limit).toBe(10);
  });

  test('should add cron job with priority', async () => {
    await client.addCron(CRON_NAME, {
      queue: TEST_QUEUE,
      data: { cron: true },
      schedule: '0 * * * * *',
      priority: 100,
    });

    const crons = await client.listCrons();
    const cron = crons.find(c => c.name === CRON_NAME);
    expect(cron).toBeDefined();
    expect(cron!.priority).toBe(100);
  });

  test('should list cron jobs', async () => {
    const crons = await client.listCrons();
    expect(Array.isArray(crons)).toBe(true);
  });

  test('should delete cron job', async () => {
    await client.addCron('temp-cron', {
      queue: TEST_QUEUE,
      data: {},
      schedule: '0 0 * * * *',
    });

    const deleted = await client.deleteCron('temp-cron');
    expect(deleted).toBe(true);
  });
});

describe('FlashQ Stats and Metrics', () => {
  let client: FlashQ;

  beforeAll(async () => {
    client = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  test('should get stats', async () => {
    const stats = await client.stats();
    expect(stats).toHaveProperty('queued');
    expect(stats).toHaveProperty('processing');
    expect(stats).toHaveProperty('delayed');
    expect(stats).toHaveProperty('dlq');
  });

  test('should get metrics', async () => {
    const metrics = await client.metrics();
    expect(metrics).toBeDefined();
    expect(metrics).toHaveProperty('total_pushed');
    expect(metrics).toHaveProperty('total_completed');
    expect(metrics).toHaveProperty('total_failed');
    expect(metrics).toHaveProperty('jobs_per_second');
    expect(metrics).toHaveProperty('avg_latency_ms');
    expect(metrics).toHaveProperty('queues');
  });
});

describe('FlashQ Job Logs', () => {
  let client: FlashQ;

  beforeAll(async () => {
    client = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await client.connect();
  });

  afterAll(async () => {
    await client.obliterate(TEST_QUEUE);
    await client.close();
  });

  test.skip('should add log to job', async () => {
    await client.push(TEST_QUEUE, { data: 1 });
    const job = await client.pull(TEST_QUEUE, 2000);

    if (job) {
      await client.log(job.id, 'Processing started', 'info');
      await client.log(job.id, 'Warning: low memory', 'warn');
      await client.log(job.id, 'Error occurred', 'error');

      const logs = await client.getLogs(job.id);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBe(3);
      expect(logs[0].message).toBe('Processing started');
      expect(logs[0].level).toBe('info');
      expect(logs[1].level).toBe('warn');
      expect(logs[2].level).toBe('error');

      await client.ack(job.id);
    }
  });

  test.skip('should get empty logs for new job', async () => {
    const job = await client.push(TEST_QUEUE, { data: 1 });
    const pulled = await client.pull(TEST_QUEUE, 1000);

    if (pulled) {
      const logs = await client.getLogs(pulled.id);
      expect(logs).toEqual([]);
      await client.ack(pulled.id);
    }
  });
});
