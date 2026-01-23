/**
 * Test Setup Helpers - Reduces boilerplate in test files
 */
import { beforeAll, afterAll, beforeEach } from 'bun:test';
import { FlashQ } from '../../src/client';

/** Default client options for tests */
export const TEST_OPTIONS = {
  host: 'localhost',
  port: 6789,
  timeout: 10000,
} as const;

/** Create a connected FlashQ client */
export async function createTestClient(): Promise<FlashQ> {
  const client = new FlashQ(TEST_OPTIONS);
  await client.connect();
  return client;
}

/**
 * Setup test suite with automatic client lifecycle management.
 * Returns getter function for the client (to handle async initialization).
 *
 * @example
 * const getClient = setupTestSuite('my-queue');
 *
 * test('should work', async () => {
 *   const client = getClient();
 *   await client.push('my-queue', { data: 1 });
 * });
 */
export function setupTestSuite(queueName: string, options?: {
  skipBeforeEach?: boolean;
}): () => FlashQ {
  let client: FlashQ;

  beforeAll(async () => {
    client = new FlashQ(TEST_OPTIONS);
    await client.connect();
  });

  afterAll(async () => {
    await client.obliterate(queueName);
    await client.close();
  });

  if (!options?.skipBeforeEach) {
    beforeEach(async () => {
      await client.obliterate(queueName);
    });
  }

  return () => client;
}

/**
 * Setup multiple test suites sharing the same client.
 * Useful for files with multiple describe blocks.
 */
export function setupSharedClient(): {
  getClient: () => FlashQ;
  cleanup: (queueName: string) => Promise<void>;
} {
  let client: FlashQ;

  beforeAll(async () => {
    client = new FlashQ(TEST_OPTIONS);
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  return {
    getClient: () => client,
    cleanup: async (queueName: string) => {
      await client.obliterate(queueName);
    },
  };
}

/** Helper to create and cleanup a temporary queue */
export async function withTempQueue<T>(
  client: FlashQ,
  prefix: string,
  fn: (queueName: string) => Promise<T>
): Promise<T> {
  const queueName = `${prefix}-${Date.now()}`;
  try {
    return await fn(queueName);
  } finally {
    await client.obliterate(queueName);
  }
}
