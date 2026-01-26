/**
 * Queue management tools for MCP server
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQClient } from '../client.js';
import { formatSuccess, formatError } from '../errors.js';

export function registerQueueTools(server: McpServer, client: FlashQClient): void {
  // list_queues
  server.tool(
    'list_queues',
    'List all queues in the flashQ server with their current status including pending count, processing count, DLQ count, and paused state.',
    {},
    async () => {
      try {
        const result = await client.send('LISTQUEUES');
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // pause_queue
  server.tool(
    'pause_queue',
    'Pause a queue to temporarily stop workers from pulling new jobs. Existing active jobs will continue processing until completion.',
    {
      queue: z.string().describe('Queue name to pause'),
    },
    async (args) => {
      try {
        const result = await client.send('PAUSE', { queue: args.queue });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // resume_queue
  server.tool(
    'resume_queue',
    'Resume a paused queue to allow workers to pull jobs again.',
    {
      queue: z.string().describe('Queue name to resume'),
    },
    async (args) => {
      try {
        const result = await client.send('RESUME', { queue: args.queue });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // is_queue_paused
  server.tool(
    'is_queue_paused',
    'Check whether a specific queue is currently paused.',
    {
      queue: z.string().describe('Queue name to check'),
    },
    async (args) => {
      try {
        const result = await client.send('ISPAUSED', { queue: args.queue });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // drain_queue
  server.tool(
    'drain_queue',
    'Remove all waiting jobs from a queue. Active (processing) jobs are not affected. Returns the number of jobs removed.',
    {
      queue: z.string().describe('Queue name to drain'),
    },
    async (args) => {
      try {
        const result = await client.send('DRAIN', { queue: args.queue });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // count_jobs
  server.tool(
    'count_jobs',
    'Get the total count of jobs (waiting + delayed) in a queue. Does not include active, completed, or failed jobs.',
    {
      queue: z.string().describe('Queue name'),
    },
    async (args) => {
      try {
        const result = await client.send('COUNT', { queue: args.queue });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // set_rate_limit
  server.tool(
    'set_rate_limit',
    'Set a rate limit (jobs per second) for a queue to control processing speed. Useful for external API rate limiting.',
    {
      queue: z.string().describe('Queue name'),
      limit: z.number().positive().describe('Maximum jobs per second'),
    },
    async (args) => {
      try {
        const result = await client.send('RATELIMIT', { queue: args.queue, limit: args.limit });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // clear_rate_limit
  server.tool(
    'clear_rate_limit',
    'Remove the rate limit from a queue, allowing unlimited processing speed.',
    {
      queue: z.string().describe('Queue name'),
    },
    async (args) => {
      try {
        const result = await client.send('RATELIMITCLEAR', { queue: args.queue });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // set_concurrency
  server.tool(
    'set_concurrency',
    'Set maximum concurrent active jobs for a queue. Limits parallel processing regardless of workers.',
    {
      queue: z.string().describe('Queue name'),
      limit: z.number().positive().describe('Maximum concurrent active jobs'),
    },
    async (args) => {
      try {
        const result = await client.send('SETCONCURRENCY', {
          queue: args.queue,
          limit: args.limit,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // clear_concurrency
  server.tool(
    'clear_concurrency',
    'Remove concurrency limit from a queue, allowing unlimited parallel processing.',
    {
      queue: z.string().describe('Queue name'),
    },
    async (args) => {
      try {
        const result = await client.send('CLEARCONCURRENCY', { queue: args.queue });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // obliterate_queue
  server.tool(
    'obliterate_queue',
    'DESTRUCTIVE: Completely delete a queue and ALL its data (jobs, DLQ, cron, config). Irreversible!',
    {
      queue: z.string().describe('Queue name to obliterate'),
    },
    async (args) => {
      try {
        const result = await client.send('OBLITERATE', { queue: args.queue });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
