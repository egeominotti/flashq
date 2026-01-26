/**
 * Admin tools for MCP server
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQClient } from '../client.js';
import { formatSuccess, formatError } from '../errors.js';

export function registerAdminTools(server: McpServer, client: FlashQClient): void {
  // list_crons
  server.tool(
    'list_crons',
    'List all scheduled cron jobs with their schedules, next run times, target queues, and execution counts.',
    {},
    async () => {
      try {
        const result = await client.send('CRONLIST');
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // clean_jobs
  server.tool(
    'clean_jobs',
    'Remove old jobs from a queue based on age and state. Useful for maintenance and cleaning up completed or failed jobs.',
    {
      queue: z.string().describe('Queue name'),
      grace_ms: z.number().describe('Remove jobs older than this many milliseconds'),
      state: z
        .enum(['waiting', 'delayed', 'completed', 'failed'])
        .describe('State of jobs to clean'),
      limit: z.number().optional().describe('Maximum number of jobs to remove'),
    },
    async (args) => {
      try {
        const result = await client.send('CLEAN', {
          queue: args.queue,
          grace: args.grace_ms,
          state: args.state,
          limit: args.limit,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
