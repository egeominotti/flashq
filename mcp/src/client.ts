/**
 * HTTP client for flashQ API
 * Maps MCP commands to available HTTP endpoints
 */

import { FlashQError } from './errors.js';
import type { FlashQConfig } from './config.js';

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

const encodeQueue = (queue: unknown): string => encodeURIComponent(String(queue));

interface HttpRequest {
  url: string;
  method: string;
  body?: string;
}

function buildRequest(baseUrl: string, cmd: string, params: Record<string, unknown>): HttpRequest {
  switch (cmd) {
    // Core operations
    case 'PUSH':
      return {
        url: `${baseUrl}/queues/${encodeQueue(params.queue)}/jobs`,
        method: 'POST',
        body: JSON.stringify({
          data: params.data,
          priority: params.priority,
          delay: params.delay,
          ttl: params.ttl,
          timeout: params.timeout,
          max_attempts: params.max_attempts,
          backoff: params.backoff,
          unique_key: params.unique_key,
          depends_on: params.depends_on,
          tags: params.tags,
          job_id: params.job_id,
        }),
      };

    // Job queries
    case 'GETJOB':
      return { url: `${baseUrl}/jobs/${params.id}`, method: 'GET' };
    case 'GETSTATE':
      return { url: `${baseUrl}/jobs/${params.id}/state`, method: 'GET' };
    case 'GETRESULT':
      return { url: `${baseUrl}/jobs/${params.id}/result`, method: 'GET' };
    case 'GETJOBS': {
      const q: string[] = [];
      if (params.queue) q.push(`queue=${encodeQueue(params.queue)}`);
      if (params.state) q.push(`state=${params.state}`);
      if (params.limit) q.push(`limit=${params.limit}`);
      if (params.offset) q.push(`offset=${params.offset}`);
      return { url: `${baseUrl}/jobs${q.length ? '?' + q.join('&') : ''}`, method: 'GET' };
    }
    case 'GETPROGRESS':
      return { url: `${baseUrl}/jobs/${params.id}/progress`, method: 'GET' };

    // Job management
    case 'CANCEL':
      return { url: `${baseUrl}/jobs/${params.id}/cancel`, method: 'POST' };

    // Queue management
    case 'LISTQUEUES':
      return { url: `${baseUrl}/queues`, method: 'GET' };
    case 'PAUSE':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/pause`, method: 'POST' };
    case 'RESUME':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/resume`, method: 'POST' };
    case 'DRAIN':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/drain`, method: 'POST' };
    case 'ISPAUSED':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/paused`, method: 'GET' };
    case 'GETJOBCOUNTS':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/counts`, method: 'GET' };
    case 'COUNT':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/count`, method: 'GET' };
    case 'RATELIMIT':
      return {
        url: `${baseUrl}/queues/${encodeQueue(params.queue)}/rate-limit`,
        method: 'POST',
        body: JSON.stringify({ limit: params.limit }),
      };
    case 'RATELIMITCLEAR':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/rate-limit`, method: 'DELETE' };

    // DLQ
    case 'DLQ':
      return {
        url: `${baseUrl}/queues/${encodeQueue(params.queue)}/dlq?count=${params.count ?? 100}`,
        method: 'GET',
      };
    case 'RETRYDLQ':
      return {
        url: `${baseUrl}/queues/${encodeQueue(params.queue)}/dlq/retry`,
        method: 'POST',
        body: JSON.stringify(params.job_id ? { job_id: params.job_id } : {}),
      };
    case 'PURGEDLQ':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/dlq`, method: 'DELETE' };

    // Monitoring
    case 'STATS':
      return { url: `${baseUrl}/stats`, method: 'GET' };
    case 'METRICS':
      return { url: `${baseUrl}/metrics`, method: 'GET' };

    // Admin
    case 'CRONLIST':
      return { url: `${baseUrl}/crons`, method: 'GET' };
    case 'CLEAN':
      return {
        url: `${baseUrl}/queues/${encodeQueue(params.queue)}/clean`,
        method: 'POST',
        body: JSON.stringify({ grace: params.grace, state: params.state, limit: params.limit }),
      };

    default:
      throw new FlashQError(`Unknown command: ${cmd}`, 400, 'UNKNOWN_COMMAND');
  }
}

export class FlashQClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private timeout: number;

  constructor(config: FlashQConfig) {
    this.baseUrl = `http://${config.host}:${config.httpPort}`;
    this.headers = buildHeaders(config.token);
    this.timeout = config.timeout;
  }

  async send<T>(cmd: string, params: Record<string, unknown> = {}): Promise<T> {
    // Handle batch push (not available via HTTP, push one by one)
    if (cmd === 'PUSHB') {
      return this.pushBatch(params) as T;
    }

    // Handle getJobByCustomId (search in job list)
    if (cmd === 'GETJOBBYCUSTOMID') {
      return this.getJobByCustomId(params) as T;
    }

    const request = buildRequest(this.baseUrl, cmd, params);

    const response = await fetch(request.url, {
      method: request.method,
      headers: this.headers,
      body: request.body,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new FlashQError(errorText || response.statusText, response.status);
    }

    const data = (await response.json()) as { ok: boolean; error?: string } & T;
    if (!data.ok) {
      throw new FlashQError(data.error || 'Unknown error', 500);
    }

    return data as T;
  }

  // Push multiple jobs one by one (batch endpoint not available)
  private async pushBatch(params: Record<string, unknown>): Promise<unknown> {
    const jobs = params.jobs as { data: unknown; priority?: number; delay?: number }[];
    const queue = params.queue as string;
    const ids: number[] = [];

    for (const job of jobs) {
      const result = await this.send<{ data: { id: number } }>('PUSH', {
        queue,
        data: job.data,
        priority: job.priority,
        delay: job.delay,
      });
      ids.push(result.data.id);
    }

    return { ok: true, data: { ids } };
  }

  // Search for job by custom_id in job list
  private async getJobByCustomId(params: Record<string, unknown>): Promise<unknown> {
    const customId = params.custom_id as string;
    // Search in jobs list - this is a limited implementation
    const result = await this.send<{ data: { custom_id?: string }[] }>('GETJOBS', {
      limit: 1000,
    });
    const job = result.data.find((j) => j.custom_id === customId);
    if (!job) {
      throw new FlashQError(`Job with custom_id ${customId} not found`, 404);
    }
    return { ok: true, data: job };
  }
}
