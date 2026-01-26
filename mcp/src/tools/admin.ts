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

  // add_cron
  server.tool(
    'add_cron',
    'Create a scheduled cron job that automatically pushes jobs to a queue on a schedule. Uses 6-field cron syntax: "sec min hour day month weekday".',
    {
      name: z.string().describe('Unique cron job name'),
      queue: z.string().describe('Target queue to push jobs to'),
      data: z.any().describe('Job data payload'),
      schedule: z
        .string()
        .describe('Cron schedule expression (e.g., "0 */5 * * * *" = every 5 minutes)'),
      priority: z.number().optional().default(0).describe('Job priority'),
    },
    async (args) => {
      try {
        const result = await client.send('CRONADD', {
          name: args.name,
          queue: args.queue,
          data: args.data,
          schedule: args.schedule,
          priority: args.priority,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // delete_cron
  server.tool(
    'delete_cron',
    'Delete a scheduled cron job by name. Already-created jobs remain in their queues.',
    {
      name: z.string().describe('Cron job name to delete'),
    },
    async (args) => {
      try {
        const result = await client.send('CRONDELETE', { name: args.name });
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
