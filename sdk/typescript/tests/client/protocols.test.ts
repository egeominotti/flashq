/**
 * FlashQ Client - Protocol Tests (Binary & HTTP)
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { FlashQ } from '../../src/client';

const TEST_QUEUE = 'test-protocols';

describe('FlashQ Binary Protocol (MessagePack)', () => {
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

  test('should work with binary protocol', async () => {
    const binaryClient = new FlashQ({
      host: 'localhost',
      port: 6789,
      useBinary: true,
    });

    await binaryClient.connect();

    const job = await binaryClient.push(TEST_QUEUE, { binary: true, value: 123 });
    expect(job.id).toBeGreaterThan(0);

    const pulled = await binaryClient.pull(TEST_QUEUE, 1000);
    expect(pulled).not.toBeNull();
    expect(pulled!.data).toEqual({ binary: true, value: 123 });

    await binaryClient.ack(pulled!.id);
    await binaryClient.close();
  });

  test('should handle complex data with binary protocol', async () => {
    const binaryClient = new FlashQ({
      host: 'localhost',
      port: 6789,
      useBinary: true,
    });

    await binaryClient.connect();

    const complexData = {
      string: 'hello',
      number: 42,
      float: 3.14,
      boolean: true,
      array: [1, 2, 3],
      nested: { a: { b: { c: 'deep' } } },
      nullValue: null,
    };

    const _job = await binaryClient.push(TEST_QUEUE, complexData);
    const pulled = await binaryClient.pull(TEST_QUEUE, 1000);

    expect(pulled!.data).toEqual(complexData);

    await binaryClient.ack(pulled!.id);
    await binaryClient.close();
  });
});

describe('FlashQ HTTP Protocol', () => {
  test.skip('should work with HTTP protocol', async () => {
    const httpClient = new FlashQ({
      host: 'localhost',
      httpPort: 6790,
      useHttp: true,
    });

    expect(httpClient.isConnected()).toBe(true);

    const job = await httpClient.push(TEST_QUEUE, { http: true });
    expect(job.id).toBeGreaterThan(0);

    const stats = await httpClient.stats();
    expect(stats).toHaveProperty('queued');

    await httpClient.close();
  });

  test.skip('should list queues via HTTP', async () => {
    const httpClient = new FlashQ({
      host: 'localhost',
      httpPort: 6790,
      useHttp: true,
    });

    const queues = await httpClient.listQueues();
    expect(Array.isArray(queues)).toBe(true);

    await httpClient.close();
  });
});

describe('FlashQ Event Subscriptions', () => {
  let client: FlashQ;

  beforeAll(async () => {
    client = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  test('should create SSE event subscriber', () => {
    const events = client.subscribe();
    expect(events).toBeDefined();
    expect(typeof events.connect).toBe('function');
    expect(typeof events.close).toBe('function');
  });

  test('should create WebSocket event subscriber', () => {
    const events = client.subscribeWs();
    expect(events).toBeDefined();
    expect(typeof events.connect).toBe('function');
    expect(typeof events.close).toBe('function');
  });

  test('should create queue-specific subscriber', () => {
    const events = client.subscribe(TEST_QUEUE);
    expect(events).toBeDefined();
  });
});
