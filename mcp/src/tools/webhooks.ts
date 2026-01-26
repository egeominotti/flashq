/**
 * Webhook management tools for MCP server
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQClient } from '../client.js';
import { formatSuccess, formatError } from '../errors.js';

export function registerWebhookTools(server: McpServer, client: FlashQClient): void {
  // list_webhooks
  server.tool(
    'list_webhooks',
    'List all registered webhooks. Shows URL, events subscribed, and queue filters.',
    {},
    async () => {
      try {
        const result = await client.send('LISTWEBHOOKS');
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // create_webhook
  server.tool(
    'create_webhook',
    'Create a webhook to receive HTTP callbacks on job events. Supports events: completed, failed, progress, stalled.',
    {
      url: z.string().url().describe('Webhook URL to receive POST requests'),
      events: z
        .array(z.enum(['completed', 'failed', 'progress', 'stalled']))
        .describe('Events to subscribe to'),
      queue: z.string().optional().describe('Filter to specific queue (optional)'),
      secret: z.string().optional().describe('Secret for HMAC signature verification'),
    },
    async (args) => {
      try {
        const result = await client.send('CREATEWEBHOOK', {
          url: args.url,
          events: args.events,
          queue: args.queue,
          secret: args.secret,
        });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // delete_webhook
  server.tool(
    'delete_webhook',
    'Delete a webhook by its ID. The webhook will no longer receive event callbacks.',
    {
      webhook_id: z.string().describe('Webhook ID to delete'),
    },
    async (args) => {
      try {
        const result = await client.send('DELETEWEBHOOK', { id: args.webhook_id });
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
