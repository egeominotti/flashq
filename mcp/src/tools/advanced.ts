/**
 * Advanced job tools for MCP server
 * Includes flows, batch operations, and job synchronization
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQClient } from '../client.js';
import { formatSuccess, formatError } from '../errors.js';

export function registerAdvancedTools(server: McpServer, client: FlashQClient): void {
  // wait_job (finished)
  server.tool(
    'wait_job',
    'Wait for a job to complete and return its result. Blocks until job finishes or timeout. Useful for synchronous workflows.',
    {
      job_id: z.number().describe('Job ID to wait for'),
      timeout: z
        .number()
        .default(30000)
        .describe('Timeout in milliseconds (default: 30000)'),
    },
    async (args) => {
      try {
        const result = await client.send('WAITJOB', {
          id: args.job_id,
          timeout: args.timeout,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // update_job
  server.tool(
    'update_job',
    'Update the data payload of a job while it is waiting or delayed. Cannot update active jobs.',
    {
      job_id: z.number().describe('Job ID to update'),
      data: z.any().describe('New job data payload'),
    },
    async (args) => {
      try {
        const result = await client.send('UPDATEJOB', {
          id: args.job_id,
          data: args.data,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // push_flow
  server.tool(
    'push_flow',
    'Push a workflow with parent and child jobs. Parent waits for all children to complete. Returns parent and children IDs.',
    {
      queue: z.string().describe('Queue name for the parent job'),
      data: z.any().describe('Parent job data payload'),
      children: z
        .array(
          z.object({
            queue: z.string().describe('Queue for child job'),
            data: z.any().describe('Child job data payload'),
            priority: z.number().default(0).describe('Child job priority'),
            delay: z.number().optional().describe('Child job delay in ms'),
          })
        )
        .describe('Child jobs to create'),
      priority: z.number().default(0).describe('Parent job priority'),
    },
    async (args) => {
      try {
        const result = await client.send('FLOW', {
          queue: args.queue,
          data: args.data,
          children: args.children,
          priority: args.priority,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // get_children
  server.tool(
    'get_children',
    'Get child jobs of a parent job (flow). Returns list of child job IDs and their states.',
    {
      job_id: z.number().describe('Parent job ID'),
    },
    async (args) => {
      try {
        const result = await client.send('GETCHILDREN', { id: args.job_id });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // ack_batch
  server.tool(
    'ack_batch',
    'Acknowledge multiple jobs at once for high-throughput processing. All jobs move to completed state.',
    {
      job_ids: z.array(z.number()).describe('Array of job IDs to acknowledge'),
    },
    async (args) => {
      try {
        const result = await client.send('ACKB', { ids: args.job_ids });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // send_partial
  server.tool(
    'send_partial',
    'Send partial/streaming result for a job. Useful for long-running jobs that produce incremental output.',
    {
      job_id: z.number().describe('Job ID'),
      data: z.any().describe('Partial result data'),
    },
    async (args) => {
      try {
        const result = await client.send('PARTIAL', {
          id: args.job_id,
          data: args.data,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
