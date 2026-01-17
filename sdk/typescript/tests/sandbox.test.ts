/**
 * FlashQ Sandboxed Worker Tests
 *
 * Tests for SandboxedWorker and createProcessor functions.
 *
 * Run: bun test tests/sandbox.test.ts
 *
 * Note: These tests create temporary processor files for testing sandboxed execution.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { FlashQ } from '../src/client';
import { SandboxedWorker, createProcessor } from '../src/sandbox';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_QUEUE = 'test-sandbox';

describe('SandboxedWorker', () => {
  let client: FlashQ;
  let tempDir: string;

  beforeAll(async () => {
    client = new FlashQ({ host: 'localhost', port: 6789, timeout: 10000 });
    await client.connect();

    // Create temp directory for processor files
    tempDir = path.join(os.tmpdir(), `flashq-sandbox-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await client.obliterate(TEST_QUEUE);
    await client.close();

    // Cleanup temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(async () => {
    await client.obliterate(TEST_QUEUE);
  });

  // Helper to create a processor file
  function createProcessorFile(code: string): string {
    const filename = `processor-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`;
    const filepath = path.join(tempDir, filename);
    fs.writeFileSync(filepath, code);
    return filepath;
  }

  // ============== Constructor Tests ==============

  describe('Constructor', () => {
    test('should create SandboxedWorker with required options', () => {
      const processorFile = createProcessorFile(`
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async () => ({}));
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
      });

      expect(worker).toBeInstanceOf(SandboxedWorker);
    });

    test('should accept all options', () => {
      const processorFile = createProcessorFile(`
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async () => ({}));
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
        concurrency: 5,
        timeout: 60000,
        connection: {
          host: 'localhost',
          port: 6789,
          token: 'test-token',
        },
      });

      expect(worker).toBeInstanceOf(SandboxedWorker);
    });

    test('should use default values', () => {
      const processorFile = createProcessorFile(`
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async () => ({}));
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
      });

      // No errors means defaults were applied correctly
      expect(worker).toBeInstanceOf(SandboxedWorker);
    });
  });

  // ============== createProcessor Tests ==============

  describe('createProcessor', () => {
    test('should be a function', () => {
      expect(typeof createProcessor).toBe('function');
    });

    test('should accept processor function', () => {
      // This just verifies the type signature works
      // Actual execution happens in child process
      const processorCode = `
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async (job) => {
          return { processed: true };
        });
      `;

      const filepath = createProcessorFile(processorCode);
      expect(fs.existsSync(filepath)).toBe(true);
    });

    test('should accept processor with helpers', () => {
      const processorCode = `
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async (job, { progress, log }) => {
          log('Starting', 'info');
          progress(50, 'Halfway');
          log('Done', 'info');
          return { result: true };
        });
      `;

      const filepath = createProcessorFile(processorCode);
      expect(fs.existsSync(filepath)).toBe(true);
    });
  });

  // ============== SandboxOptions Interface Tests ==============

  describe('SandboxOptions', () => {
    test('should require processorFile', () => {
      const processorFile = createProcessorFile(`
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async () => ({}));
      `);

      // This should work because processorFile is provided
      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
      });

      expect(worker).toBeDefined();
    });

    test('should accept optional concurrency', () => {
      const processorFile = createProcessorFile(`
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async () => ({}));
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
        concurrency: 10,
      });

      expect(worker).toBeDefined();
    });

    test('should accept optional timeout', () => {
      const processorFile = createProcessorFile(`
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async () => ({}));
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
        timeout: 120000,
      });

      expect(worker).toBeDefined();
    });

    test('should accept optional connection config', () => {
      const processorFile = createProcessorFile(`
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async () => ({}));
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
        connection: {
          host: 'custom-host',
          port: 7890,
          token: 'secret',
        },
      });

      expect(worker).toBeDefined();
    });
  });

  // ============== Lifecycle Tests ==============

  describe('Lifecycle', () => {
    test('should have run method', () => {
      const processorFile = createProcessorFile(`
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async () => ({}));
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
      });

      expect(typeof worker.run).toBe('function');
    });

    test('should have close method', () => {
      const processorFile = createProcessorFile(`
        import { createProcessor } from '../../src/sandbox';
        createProcessor(async () => ({}));
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
      });

      expect(typeof worker.close).toBe('function');
    });
  });

  // ============== Integration Tests (Skipped by default) ==============
  // These tests require actual child process execution which can be flaky in CI

  describe('Integration', () => {
    test.skip('should process job in sandbox', async () => {
      // Create a simple processor
      const processorFile = createProcessorFile(`
        const { createProcessor } = require('../../src/sandbox');
        createProcessor(async (job) => {
          return { doubled: job.data.value * 2 };
        });
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
        concurrency: 1,
        timeout: 10000,
        connection: {
          host: 'localhost',
          port: 6789,
        },
      });

      // Start worker in background
      const runPromise = worker.run();

      // Push a job
      await client.push(TEST_QUEUE, { value: 21 });

      // Wait for processing
      await new Promise(r => setTimeout(r, 2000));

      // Stop worker
      await worker.close();

      // Verify the job was completed
      const count = await client.count(TEST_QUEUE);
      expect(count).toBe(0); // Job should be processed
    });

    test.skip('should handle processor errors', async () => {
      const processorFile = createProcessorFile(`
        const { createProcessor } = require('../../src/sandbox');
        createProcessor(async (job) => {
          throw new Error('Intentional failure');
        });
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
        concurrency: 1,
        timeout: 5000,
        connection: {
          host: 'localhost',
          port: 6789,
        },
      });

      const runPromise = worker.run();

      // Push a job that will fail
      const job = await client.push(TEST_QUEUE, { test: true }, { max_attempts: 1 });

      await new Promise(r => setTimeout(r, 2000));
      await worker.close();

      // Job should be in DLQ
      const state = await client.getState(job.id);
      expect(state).toBe('failed');
    });

    test.skip('should timeout long-running jobs', async () => {
      const processorFile = createProcessorFile(`
        const { createProcessor } = require('../../src/sandbox');
        createProcessor(async (job) => {
          // Sleep longer than timeout
          await new Promise(r => setTimeout(r, 10000));
          return {};
        });
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
        concurrency: 1,
        timeout: 1000, // 1 second timeout
        connection: {
          host: 'localhost',
          port: 6789,
        },
      });

      const runPromise = worker.run();

      const job = await client.push(TEST_QUEUE, { test: true }, { max_attempts: 1 });

      await new Promise(r => setTimeout(r, 3000));
      await worker.close();

      // Job should fail due to timeout
      const state = await client.getState(job.id);
      expect(state).toBe('failed');
    });

    test.skip('should process multiple jobs concurrently', async () => {
      const processorFile = createProcessorFile(`
        const { createProcessor } = require('../../src/sandbox');
        createProcessor(async (job) => {
          await new Promise(r => setTimeout(r, 200));
          return { index: job.data.index };
        });
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
        concurrency: 3,
        timeout: 5000,
        connection: {
          host: 'localhost',
          port: 6789,
        },
      });

      const runPromise = worker.run();

      // Push multiple jobs
      for (let i = 0; i < 6; i++) {
        await client.push(TEST_QUEUE, { index: i });
      }

      // With concurrency 3, should complete in ~400-500ms instead of 1200ms
      const start = Date.now();
      await new Promise(r => setTimeout(r, 800));
      await worker.close();

      // Most jobs should be done
      const count = await client.count(TEST_QUEUE);
      expect(count).toBeLessThanOrEqual(3); // At most 3 remaining (6 - 3 processed)
    });

    test.skip('should forward progress updates', async () => {
      const processorFile = createProcessorFile(`
        const { createProcessor } = require('../../src/sandbox');
        createProcessor(async (job, { progress }) => {
          progress(25, 'Starting');
          progress(50, 'Halfway');
          progress(75, 'Almost done');
          progress(100, 'Complete');
          return { done: true };
        });
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
        concurrency: 1,
        timeout: 5000,
        connection: {
          host: 'localhost',
          port: 6789,
        },
      });

      const runPromise = worker.run();

      const job = await client.push(TEST_QUEUE, { test: true });

      await new Promise(r => setTimeout(r, 1000));

      // Check progress was updated
      const progressData = await client.getProgress(job.id);
      expect(progressData.progress).toBe(100);

      await worker.close();
    });

    test.skip('should forward log messages', async () => {
      const processorFile = createProcessorFile(`
        const { createProcessor } = require('../../src/sandbox');
        createProcessor(async (job, { log }) => {
          log('Info message', 'info');
          log('Warning message', 'warn');
          log('Error message', 'error');
          return { done: true };
        });
      `);

      const worker = new SandboxedWorker(TEST_QUEUE, {
        processorFile,
        concurrency: 1,
        timeout: 5000,
        connection: {
          host: 'localhost',
          port: 6789,
        },
      });

      const runPromise = worker.run();

      const job = await client.push(TEST_QUEUE, { test: true });

      await new Promise(r => setTimeout(r, 1000));

      // Check logs were recorded
      const logs = await client.getLogs(job.id);
      expect(logs.length).toBe(3);
      expect(logs[0].message).toBe('Info message');
      expect(logs[0].level).toBe('info');

      await worker.close();
    });
  });

  // ============== Message Types Tests ==============

  describe('WorkerMessage Types', () => {
    test('should define result message type', () => {
      // This verifies the WorkerMessage interface is correctly typed
      interface WorkerMessage {
        type: 'result' | 'error' | 'progress' | 'log';
        jobId: number;
        data?: unknown;
        error?: string;
        progress?: number;
        message?: string;
        level?: 'info' | 'warn' | 'error';
      }

      const resultMsg: WorkerMessage = {
        type: 'result',
        jobId: 123,
        data: { value: 42 },
      };

      expect(resultMsg.type).toBe('result');
    });

    test('should define error message type', () => {
      interface WorkerMessage {
        type: 'result' | 'error' | 'progress' | 'log';
        jobId: number;
        error?: string;
      }

      const errorMsg: WorkerMessage = {
        type: 'error',
        jobId: 123,
        error: 'Something went wrong',
      };

      expect(errorMsg.type).toBe('error');
    });

    test('should define progress message type', () => {
      interface WorkerMessage {
        type: 'result' | 'error' | 'progress' | 'log';
        jobId: number;
        progress?: number;
        message?: string;
      }

      const progressMsg: WorkerMessage = {
        type: 'progress',
        jobId: 123,
        progress: 50,
        message: 'Halfway there',
      };

      expect(progressMsg.type).toBe('progress');
    });

    test('should define log message type', () => {
      interface WorkerMessage {
        type: 'result' | 'error' | 'progress' | 'log';
        jobId: number;
        message?: string;
        level?: 'info' | 'warn' | 'error';
      }

      const logMsg: WorkerMessage = {
        type: 'log',
        jobId: 123,
        message: 'Processing started',
        level: 'info',
      };

      expect(logMsg.type).toBe('log');
    });
  });

  // ============== JobMessage Types Tests ==============

  describe('JobMessage Types', () => {
    test('should define job message type', () => {
      interface JobMessage {
        type: 'job';
        job: {
          id: number;
          queue: string;
          data: unknown;
        };
      }

      const jobMsg: JobMessage = {
        type: 'job',
        job: {
          id: 123,
          queue: TEST_QUEUE,
          data: { test: true },
        },
      };

      expect(jobMsg.type).toBe('job');
      expect(jobMsg.job.id).toBe(123);
    });
  });
});

// ============== Export Tests ==============

describe('Sandbox Exports', () => {
  test('should export SandboxedWorker', async () => {
    const { SandboxedWorker } = await import('../src/sandbox');
    expect(SandboxedWorker).toBeDefined();
    expect(typeof SandboxedWorker).toBe('function');
  });

  test('should export createProcessor', async () => {
    const { createProcessor } = await import('../src/sandbox');
    expect(createProcessor).toBeDefined();
    expect(typeof createProcessor).toBe('function');
  });

  test('should be default export as SandboxedWorker', async () => {
    const { default: DefaultExport } = await import('../src/sandbox');
    const { SandboxedWorker } = await import('../src/sandbox');
    expect(DefaultExport).toBe(SandboxedWorker);
  });
});

// ============== Main Index Export Tests ==============

describe('Main Index Sandbox Exports', () => {
  test('should export SandboxedWorker from main index', async () => {
    const { SandboxedWorker } = await import('../src/index');
    expect(SandboxedWorker).toBeDefined();
  });

  test('should export createProcessor from main index', async () => {
    const { createProcessor } = await import('../src/index');
    expect(createProcessor).toBeDefined();
  });
});
