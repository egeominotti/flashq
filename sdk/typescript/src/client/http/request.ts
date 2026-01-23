/**
 * HTTP request builder for FlashQ client.
 * Part 1: Core commands (PUSH, PULL, ACK, FAIL, Jobs, Queue control)
 */
import type { ApiResponse } from '../../types';

/** Build headers for HTTP requests */
export function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

const encodeQueue = (queue: unknown): string => encodeURIComponent(String(queue));

export interface HttpRequest {
  url: string;
  method: string;
  body?: string;
}

/** Build HTTP request for core commands */
export function buildCoreRequest(
  baseUrl: string,
  cmd: string,
  params: Record<string, unknown>
): HttpRequest | null {
  switch (cmd) {
    case 'PUSH':
      return {
        url: `${baseUrl}/queues/${encodeQueue(params.queue)}/jobs`,
        method: 'POST',
        body: JSON.stringify({
          data: params.data, priority: params.priority, delay: params.delay,
          ttl: params.ttl, timeout: params.timeout, max_attempts: params.max_attempts,
          backoff: params.backoff, unique_key: params.unique_key, depends_on: params.depends_on,
          tags: params.tags, lifo: params.lifo, remove_on_complete: params.remove_on_complete,
          remove_on_fail: params.remove_on_fail, stall_timeout: params.stall_timeout,
          debounce_id: params.debounce_id, debounce_ttl: params.debounce_ttl,
          job_id: params.job_id, keep_completed_age: params.keep_completed_age,
          keep_completed_count: params.keep_completed_count, group_id: params.group_id,
        }),
      };
    case 'PUSHB':
      return {
        url: `${baseUrl}/queues/${encodeQueue(params.queue)}/jobs/batch`,
        method: 'POST',
        body: JSON.stringify({ jobs: params.jobs }),
      };
    case 'PULL':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/jobs?count=1`, method: 'GET' };
    case 'PULLB':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/jobs?count=${params.count}`, method: 'GET' };
    case 'ACK':
      return { url: `${baseUrl}/jobs/${params.id}/ack`, method: 'POST', body: JSON.stringify({ result: params.result }) };
    case 'ACKB':
      return { url: `${baseUrl}/jobs/ack/batch`, method: 'POST', body: JSON.stringify({ ids: params.ids }) };
    case 'FAIL':
      return { url: `${baseUrl}/jobs/${params.id}/fail`, method: 'POST', body: JSON.stringify({ error: params.error }) };
    default:
      return null;
  }
}

/** Build HTTP request for job query commands */
export function buildJobQueryRequest(
  baseUrl: string,
  cmd: string,
  params: Record<string, unknown>
): HttpRequest | null {
  switch (cmd) {
    case 'GETJOB':
      return { url: `${baseUrl}/jobs/${params.id}`, method: 'GET' };
    case 'GETSTATE':
      return { url: `${baseUrl}/jobs/${params.id}/state`, method: 'GET' };
    case 'GETRESULT':
      return { url: `${baseUrl}/jobs/${params.id}/result`, method: 'GET' };
    case 'GETJOBBYCUSTOMID':
      return { url: `${baseUrl}/jobs/custom/${encodeURIComponent(String(params.custom_id))}`, method: 'GET' };
    case 'GETJOBS': {
      const q: string[] = [];
      if (params.queue) q.push(`queue=${encodeQueue(params.queue)}`);
      if (params.state) q.push(`state=${params.state}`);
      if (params.limit) q.push(`limit=${params.limit}`);
      if (params.offset) q.push(`offset=${params.offset}`);
      return { url: `${baseUrl}/jobs${q.length ? '?' + q.join('&') : ''}`, method: 'GET' };
    }
    case 'GETJOBCOUNTS':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/counts`, method: 'GET' };
    case 'COUNT':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/count`, method: 'GET' };
    case 'GETPROGRESS':
      return { url: `${baseUrl}/jobs/${params.id}/progress`, method: 'GET' };
    case 'WAITJOB':
      return { url: `${baseUrl}/jobs/${params.id}/wait?timeout=${params.timeout ?? 30000}`, method: 'GET' };
    case 'GETLOGS':
      return { url: `${baseUrl}/jobs/${params.id}/logs`, method: 'GET' };
    case 'GETCHILDREN':
      return { url: `${baseUrl}/jobs/${params.id}/children`, method: 'GET' };
    default:
      return null;
  }
}

/** Build HTTP request for job management commands */
export function buildJobMgmtRequest(
  baseUrl: string,
  cmd: string,
  params: Record<string, unknown>
): HttpRequest | null {
  switch (cmd) {
    case 'CANCEL':
      return { url: `${baseUrl}/jobs/${params.id}/cancel`, method: 'POST' };
    case 'PROGRESS':
      return { url: `${baseUrl}/jobs/${params.id}/progress`, method: 'POST',
        body: JSON.stringify({ progress: params.progress, message: params.message }) };
    case 'UPDATE':
      return { url: `${baseUrl}/jobs/${params.id}`, method: 'PATCH', body: JSON.stringify({ data: params.data }) };
    case 'CHANGEPRIORITY':
      return { url: `${baseUrl}/jobs/${params.id}/priority`, method: 'POST', body: JSON.stringify({ priority: params.priority }) };
    case 'MOVETODELAYED':
      return { url: `${baseUrl}/jobs/${params.id}/delay`, method: 'POST', body: JSON.stringify({ delay: params.delay }) };
    case 'PROMOTE':
      return { url: `${baseUrl}/jobs/${params.id}/promote`, method: 'POST' };
    case 'DISCARD':
      return { url: `${baseUrl}/jobs/${params.id}/discard`, method: 'POST' };
    case 'HEARTBEAT':
      return { url: `${baseUrl}/jobs/${params.id}/heartbeat`, method: 'POST' };
    case 'LOG':
      return { url: `${baseUrl}/jobs/${params.id}/logs`, method: 'POST',
        body: JSON.stringify({ message: params.message, level: params.level }) };
    default:
      return null;
  }
}

/** Build HTTP request for queue control commands */
export function buildQueueRequest(
  baseUrl: string,
  cmd: string,
  params: Record<string, unknown>
): HttpRequest | null {
  switch (cmd) {
    case 'PAUSE':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/pause`, method: 'POST' };
    case 'RESUME':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/resume`, method: 'POST' };
    case 'ISPAUSED':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/paused`, method: 'GET' };
    case 'DRAIN':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/drain`, method: 'POST' };
    case 'OBLITERATE':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/obliterate`, method: 'DELETE' };
    case 'CLEAN':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/clean`, method: 'POST',
        body: JSON.stringify({ grace: params.grace, state: params.state, limit: params.limit }) };
    case 'DLQ':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/dlq?count=${params.count ?? 100}`, method: 'GET' };
    case 'RETRYDLQ':
      return params.id
        ? { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/dlq/${params.id}/retry`, method: 'POST' }
        : { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/dlq/retry`, method: 'POST' };
    case 'PURGEDLQ':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/dlq`, method: 'DELETE' };
    case 'RATELIMIT':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/ratelimit`, method: 'POST',
        body: JSON.stringify({ limit: params.limit }) };
    case 'RATELIMITCLEAR':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/ratelimit`, method: 'DELETE' };
    case 'SETCONCURRENCY':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/concurrency`, method: 'POST',
        body: JSON.stringify({ limit: params.limit }) };
    case 'CLEARCONCURRENCY':
      return { url: `${baseUrl}/queues/${encodeQueue(params.queue)}/concurrency`, method: 'DELETE' };
    case 'LISTQUEUES':
      return { url: `${baseUrl}/queues`, method: 'GET' };
    default:
      return null;
  }
}

/** Build HTTP request for cron/flow/stats commands */
export function buildOtherRequest(
  baseUrl: string,
  cmd: string,
  params: Record<string, unknown>
): HttpRequest | null {
  switch (cmd) {
    case 'CRON':
      return { url: `${baseUrl}/crons/${encodeURIComponent(String(params.name))}`, method: 'PUT',
        body: JSON.stringify({ queue: params.queue, data: params.data, schedule: params.schedule,
          repeat_every: params.repeat_every, priority: params.priority, limit: params.limit }) };
    case 'CRONDELETE':
      return { url: `${baseUrl}/crons/${encodeURIComponent(String(params.name))}`, method: 'DELETE' };
    case 'CRONLIST':
      return { url: `${baseUrl}/crons`, method: 'GET' };
    case 'PUSHFLOW':
      return { url: `${baseUrl}/flows`, method: 'POST',
        body: JSON.stringify({ queue: params.queue, parent_data: params.parent_data,
          children: params.children, priority: params.priority, delay: params.delay }) };
    case 'STATS':
      return { url: `${baseUrl}/stats`, method: 'GET' };
    case 'METRICS':
      return { url: `${baseUrl}/metrics`, method: 'GET' };
    default:
      return null;
  }
}

/** Build HTTP request from command (combines all builders) */
export function buildHttpRequest(
  baseUrl: string,
  cmd: string,
  params: Record<string, unknown>
): HttpRequest {
  const req = buildCoreRequest(baseUrl, cmd, params)
    ?? buildJobQueryRequest(baseUrl, cmd, params)
    ?? buildJobMgmtRequest(baseUrl, cmd, params)
    ?? buildQueueRequest(baseUrl, cmd, params)
    ?? buildOtherRequest(baseUrl, cmd, params);
  if (!req) throw new Error(`HTTP not supported for command: ${cmd}`);
  return req;
}
