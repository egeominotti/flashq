/**
 * FlashQ Client - Connection Tests
 */
import { describe, test, expect } from 'bun:test';
import { FlashQ } from '../../src/client';
import { setupTestSuite, TEST_OPTIONS } from '../helpers/setup';

const TEST_QUEUE = 'test-connection';
const getClient = setupTestSuite(TEST_QUEUE, { skipBeforeEach: true });

describe('FlashQ Connection', () => {
  test('should connect successfully', () => {
    expect(getClient().isConnected()).toBe(true);
  });

  test('should create new client and connect', async () => {
    const newClient = new FlashQ();
    await newClient.connect();
    expect(newClient.isConnected()).toBe(true);
    await newClient.close();
  });

  test('should auto-connect on first operation', async () => {
    const autoClient = new FlashQ();
    const job = await autoClient.push(TEST_QUEUE, { test: true });
    expect(job.id).toBeGreaterThan(0);
    await autoClient.close();
  });

  test('should handle close gracefully', async () => {
    const tempClient = new FlashQ();
    await tempClient.connect();
    await tempClient.close();
    expect(tempClient.isConnected()).toBe(false);
  });

  test('should accept custom options', () => {
    const customClient = new FlashQ({
      ...TEST_OPTIONS,
      httpPort: 6790,
      token: '',
      useHttp: false,
      useBinary: false,
    });
    expect(customClient).toBeInstanceOf(FlashQ);
  });

  test('should authenticate with valid token', async () => {
    const authClient = new FlashQ(TEST_OPTIONS);
    await authClient.connect();
    expect(authClient.isConnected()).toBe(true);
    await authClient.close();
  });
});
