#!/usr/bin/env node
/**
 * flashQ MCP Server - Entry Point
 *
 * Enables AI assistants to manage flashQ job queues through the
 * Model Context Protocol (MCP).
 *
 * Environment variables:
 *   FLASHQ_HOST       - Server host (default: localhost)
 *   FLASHQ_HTTP_PORT  - HTTP API port (default: 6790)
 *   FLASHQ_TOKEN      - Auth token (optional)
 *   FLASHQ_TIMEOUT    - Request timeout in ms (default: 30000)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error('flashQ MCP server started');
}

main().catch((error) => {
  console.error('Failed to start flashQ MCP server:', error);
  process.exit(1);
});
