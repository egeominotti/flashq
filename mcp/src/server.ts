/**
 * MCP server setup and configuration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FlashQClient } from './client.js';
import { loadConfig } from './config.js';
import { registerAllTools } from './tools/index.js';

export function createServer(): McpServer {
  const config = loadConfig();

  const client = new FlashQClient(config.flashq);

  const server = new McpServer({
    name: 'flashq',
    version: '0.1.0',
  });

  registerAllTools(server, client);

  return server;
}
