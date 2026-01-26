/**
 * Worker tools for MCP server
 * Enable Claude to act as a job processor
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQClient } from '../client.js';
import { formatSuccess, formatError } from '../errors.js';

export function registerWorkerTools(server: McpServer, client: FlashQClient): void {
  // pull_job
  server.tool(
    'pull_job',
    'Pull a job from a queue for processing. The job moves to "active" state and must be acknowledged (ack_job) or failed (fail_job) when done.',
    {
      queue: z.string().describe('Queue name to pull from'),
      count: z.number().min(1).max(10).default(1).describe('Number of jobs to pull (max 10)'),
    },
    async (args) => {
      try {
        const result = await client.send('PULL', { queue: args.queue, count: args.count });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // ack_job
  server.tool(
    'ack_job',
    'Acknowledge successful job completion. Moves the job to "completed" state and optionally stores a result.',
    {
      job_id: z.number().describe('Job ID to acknowledge'),
      result: z.any().optional().describe('Optional result data to store'),
    },
    async (args) => {
      try {
        const result = await client.send('ACK', { id: args.job_id, result: args.result });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // fail_job
  server.tool(
    'fail_job',
    'Mark a job as failed. If retries remaining, job is requeued with backoff. Otherwise, moves to Dead Letter Queue.',
    {
      job_id: z.number().describe('Job ID to fail'),
      error: z.string().optional().describe('Error message describing the failure'),
    },
    async (args) => {
      try {
        const result = await client.send('FAIL', { id: args.job_id, error: args.error });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // update_progress
  server.tool(
    'update_progress',
    'Update job progress percentage and message. Use for long-running jobs to report status.',
    {
      job_id: z.number().describe('Job ID'),
      progress: z.number().min(0).max(100).describe('Progress percentage (0-100)'),
      message: z.string().optional().describe('Optional status message'),
    },
    async (args) => {
      try {
        const result = await client.send('PROGRESS', {
          id: args.job_id,
          progress: args.progress,
          message: args.message,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // add_job_log
  server.tool(
    'add_job_log',
    'Add a log entry to a job during processing. Useful for debugging and audit trails.',
    {
      job_id: z.number().describe('Job ID'),
      message: z.string().describe('Log message'),
      level: z
        .enum(['info', 'warn', 'error'])
        .default('info')
        .describe('Log level'),
    },
    async (args) => {
      try {
        const result = await client.send('ADDLOG', {
          id: args.job_id,
          message: args.message,
          level: args.level,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // heartbeat (uses progress endpoint which also acts as heartbeat)
  server.tool(
    'heartbeat',
    'Send heartbeat for a long-running job to prevent stall detection timeout. Uses progress update internally.',
    {
      job_id: z.number().describe('Job ID'),
    },
    async (args) => {
      try {
        // Get current progress first, then send same progress as heartbeat
        const result = await client.send('PROGRESS', {
          id: args.job_id,
          progress: 0,
          message: 'heartbeat',
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
