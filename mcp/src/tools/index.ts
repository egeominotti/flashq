/**
 * Tool registration aggregator
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQClient } from '../client.js';
import { registerJobTools } from './jobs.js';
import { registerQueueTools } from './queues.js';
import { registerDlqTools } from './dlq.js';
import { registerMonitoringTools } from './monitoring.js';
import { registerAdminTools } from './admin.js';

export function registerAllTools(server: McpServer, client: FlashQClient): void {
  registerJobTools(server, client);
  registerQueueTools(server, client);
  registerDlqTools(server, client);
  registerMonitoringTools(server, client);
  registerAdminTools(server, client);
}
