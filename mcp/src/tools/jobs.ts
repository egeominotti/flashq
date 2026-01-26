/**
 * Job operation tools for MCP server
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQClient } from '../client.js';
import { formatSuccess, formatError } from '../errors.js';

export function registerJobTools(server: McpServer, client: FlashQClient): void {
  // push_job
  server.tool(
    'push_job',
    'Create a new job in a flashQ queue. Use this to add work items that workers will process. Returns the created job ID.',
    {
      queue: z.string().describe('Queue name (alphanumeric, underscore, hyphen, dot)'),
      data: z.any().describe('Job payload data (JSON object)'),
      priority: z
        .number()
        .optional()
        .describe('Job priority (higher = processed first, default: 0)'),
      delay: z.number().optional().describe('Delay in milliseconds before job is available'),
      max_attempts: z
        .number()
        .optional()
        .describe('Maximum retry attempts (default: 0 = no retry)'),
      timeout: z.number().optional().describe('Job processing timeout in milliseconds'),
      ttl: z.number().optional().describe('Time-to-live in milliseconds (job expires after)'),
      unique_key: z.string().optional().describe('Unique key for deduplication'),
      jobId: z.string().optional().describe('Custom job ID for idempotent operations'),
      tags: z.array(z.string()).optional().describe('Tags for filtering'),
    },
    async (args) => {
      try {
        const result = await client.send('PUSH', {
          queue: args.queue,
          data: args.data,
          priority: args.priority,
          delay: args.delay,
          max_attempts: args.max_attempts,
          timeout: args.timeout,
          ttl: args.ttl,
          unique_key: args.unique_key,
          job_id: args.jobId,
          tags: args.tags,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // push_batch_jobs
  server.tool(
    'push_batch_jobs',
    'Create multiple jobs at once for efficient bulk operations. Maximum 1000 jobs per batch.',
    {
      queue: z.string().describe('Queue name'),
      jobs: z
        .array(
          z.object({
            data: z.any().describe('Job payload'),
            priority: z.number().optional().describe('Job priority'),
            delay: z.number().optional().describe('Delay in milliseconds'),
          })
        )
        .max(1000)
        .describe('Array of jobs to create (max 1000)'),
    },
    async (args) => {
      try {
        const result = await client.send('PUSHB', {
          queue: args.queue,
          jobs: args.jobs,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // get_job
  server.tool(
    'get_job',
    'Get detailed information about a specific job including its current state, data, and metadata.',
    {
      job_id: z.number().describe('Numeric job ID'),
    },
    async (args) => {
      try {
        const result = await client.send('GETJOB', { id: args.job_id });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // get_job_state
  server.tool(
    'get_job_state',
    'Get only the current state of a job. Returns: waiting, delayed, active, completed, or failed.',
    {
      job_id: z.number().describe('Numeric job ID'),
    },
    async (args) => {
      try {
        const result = await client.send('GETSTATE', { id: args.job_id });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // get_job_result
  server.tool(
    'get_job_result',
    'Get the result data from a completed job. Returns null if job is not completed or result was not stored.',
    {
      job_id: z.number().describe('Numeric job ID'),
    },
    async (args) => {
      try {
        const result = await client.send('GETRESULT', { id: args.job_id });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // get_job_by_custom_id
  server.tool(
    'get_job_by_custom_id',
    'Find a job using its custom ID (set via jobId option during push). Useful for idempotent operations and tracking.',
    {
      custom_id: z.string().describe('Custom job ID'),
    },
    async (args) => {
      try {
        const result = await client.send('GETJOBBYCUSTOMID', { custom_id: args.custom_id });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // list_jobs
  server.tool(
    'list_jobs',
    'List jobs with optional filtering by queue and state. Supports pagination for large result sets.',
    {
      queue: z.string().optional().describe('Filter by queue name'),
      state: z
        .enum(['waiting', 'delayed', 'active', 'completed', 'failed'])
        .optional()
        .describe('Filter by job state'),
      limit: z.number().max(100).default(20).describe('Maximum jobs to return (max 100)'),
      offset: z.number().default(0).describe('Offset for pagination'),
    },
    async (args) => {
      try {
        const result = await client.send('GETJOBS', {
          queue: args.queue,
          state: args.state,
          limit: args.limit,
          offset: args.offset,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // get_job_counts
  server.tool(
    'get_job_counts',
    'Get the count of jobs in each state (waiting, active, delayed, completed, failed) for a specific queue.',
    {
      queue: z.string().describe('Queue name'),
    },
    async (args) => {
      try {
        const result = await client.send('GETJOBCOUNTS', { queue: args.queue });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // cancel_job
  server.tool(
    'cancel_job',
    'Cancel a job that is waiting or delayed. Cannot cancel jobs that are already being processed (active).',
    {
      job_id: z.number().describe('Numeric job ID to cancel'),
    },
    async (args) => {
      try {
        const result = await client.send('CANCEL', { id: args.job_id });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // get_job_progress
  server.tool(
    'get_job_progress',
    'Get the progress percentage and message for an active job. Used for long-running tasks that report progress.',
    {
      job_id: z.number().describe('Numeric job ID'),
    },
    async (args) => {
      try {
        const result = await client.send('GETPROGRESS', { id: args.job_id });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
