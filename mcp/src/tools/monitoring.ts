/**
 * Monitoring and metrics tools for MCP server
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQClient } from '../client.js';
import { formatSuccess, formatError } from '../errors.js';

export function registerMonitoringTools(server: McpServer, client: FlashQClient): void {
  // get_stats
  server.tool(
    'get_stats',
    'Get overall statistics for the flashQ server including total queued jobs, processing count, delayed count, and DLQ count across all queues.',
    {},
    async () => {
      try {
        const result = await client.send('STATS');
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // get_metrics
  server.tool(
    'get_metrics',
    'Get detailed performance metrics including throughput (jobs/sec), average latency, total pushed/completed/failed counts, and per-queue breakdown.',
    {},
    async () => {
      try {
        const result = await client.send('METRICS');
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // get_metrics_history
  server.tool(
    'get_metrics_history',
    'Get historical metrics data for trend analysis and graphing. Returns time-series data.',
    {},
    async () => {
      try {
        const result = await client.send('METRICSHISTORY');
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );

  // health_check
  server.tool(
    'health_check',
    'Check server health status, uptime, and configuration.',
    {},
    async () => {
      try {
        const result = await client.send('HEALTH');
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    }
  );
}
