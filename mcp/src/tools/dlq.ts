/**
 * Dead Letter Queue (DLQ) tools for MCP server
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQClient } from '../client.js';
import { formatSuccess, formatError } from '../errors.js';

export function registerDlqTools(server: McpServer, client: FlashQClient): void {
  // get_dlq
  server.tool(
    'get_dlq',
    'Get jobs from the Dead Letter Queue (DLQ) for a specific queue. These are jobs that failed after exhausting all retry attempts.',
    {
      queue: z.string().describe('Queue name'),
      count: z.number().max(100).default(20).describe('Maximum jobs to return (max 100)'),
    },
    async (args) => {
      try {
        const result = await client.send('DLQ', { queue: args.queue, count: args.count });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // retry_dlq
  server.tool(
    'retry_dlq',
    'Retry jobs from the Dead Letter Queue. Can retry all jobs in the queue or a specific job by ID. Jobs are moved back to waiting state.',
    {
      queue: z.string().describe('Queue name'),
      job_id: z
        .number()
        .optional()
        .describe('Specific job ID to retry, or omit to retry all DLQ jobs'),
    },
    async (args) => {
      try {
        const result = await client.send('RETRYDLQ', { queue: args.queue, id: args.job_id });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // purge_dlq
  server.tool(
    'purge_dlq',
    'Permanently remove all jobs from the Dead Letter Queue for a specific queue. This action cannot be undone.',
    {
      queue: z.string().describe('Queue name'),
    },
    async (args) => {
      try {
        const result = await client.send('PURGEDLQ', { queue: args.queue });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
