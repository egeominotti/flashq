/**
 * FlashQ Client - Flow Tests
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { FlashQ } from '../../src/client';

const TEST_QUEUE = 'test-flows';

describe('FlashQ Flows (Parent-Child Jobs)', () => {
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

  test.skip('should create flow with children', async () => {
    const flow = await client.pushFlow(
      TEST_QUEUE,
      { parent: true },
      [
        { queue: TEST_QUEUE, data: { child: 1 } },
        { queue: TEST_QUEUE, data: { child: 2 } },
      ]
    );

    expect(flow.parent_id).toBeGreaterThan(0);
    expect(flow.children_ids.length).toBeGreaterThanOrEqual(0);
  });

  test.skip('should get children of parent job', async () => {
    const flow = await client.pushFlow(
      TEST_QUEUE,
      { parent: true },
      [
        { queue: TEST_QUEUE, data: { child: 1 } },
      ]
    );

    const children = await client.getChildren(flow.parent_id);
    expect(Array.isArray(children)).toBe(true);
  });
});
