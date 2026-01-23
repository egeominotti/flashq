/**
 * HTTP response parser for FlashQ client.
 */
import type { ApiResponse } from '../../types';

/**
 * Parse HTTP response based on command type.
 */
export function parseHttpResponse(cmd: string, json: ApiResponse): unknown {
  if (!json.ok) throw new Error(json.error ?? 'Unknown error');
  const data = json.data;

  switch (cmd) {
    case 'PUSH':
      return data && typeof data === 'object' ? { ok: true, id: (data as { id: number }).id } : json;
    case 'PUSHB':
      return Array.isArray(data) ? { ok: true, ids: data } : json;
    case 'PULL':
    case 'PULLB':
      if (Array.isArray(data)) {
        if (data.length === 0) return { ok: true, job: null };
        return cmd === 'PULL' ? { ok: true, job: data[0] } : { ok: true, jobs: data };
      }
      return json;
    case 'STATS':
    case 'METRICS':
      return data && typeof data === 'object' ? { ok: true, ...data } : json;
    case 'LISTQUEUES':
      return Array.isArray(data) ? { ok: true, queues: data } : json;
    case 'CRONLIST':
      return Array.isArray(data) ? { ok: true, crons: data } : json;
    case 'GETJOB':
      return data && typeof data === 'object' ? { ok: true, ...data } : { ok: true, job: null };
    case 'GETSTATE':
      if (data && typeof data === 'object' && 'state' in data) {
        return { ok: true, state: (data as { state: string }).state };
      }
      return { ok: true, state: null };
    case 'GETRESULT':
      return { ok: true, result: data ?? null };
    case 'GETPROGRESS':
      return data && typeof data === 'object' ? { ok: true, ...data } : { ok: true, progress: 0 };
    case 'WAITJOB':
      return { ok: true, result: data ?? null };
    case 'GETJOBS':
      if (data && typeof data === 'object') {
        const d = data as { jobs?: unknown[]; total?: number };
        return { ok: true, jobs: d.jobs ?? [], total: d.total ?? 0 };
      }
      return { ok: true, jobs: [], total: 0 };
    case 'GETJOBCOUNTS':
      return data && typeof data === 'object' ? { ok: true, ...data } : json;
    case 'COUNT':
      if (typeof data === 'number') return { ok: true, count: data };
      if (data && typeof data === 'object' && 'count' in data) {
        return { ok: true, count: (data as { count: number }).count };
      }
      return json;
    case 'DLQ':
      return Array.isArray(data) ? { ok: true, jobs: data } : json;
    case 'GETLOGS':
      return Array.isArray(data) ? { ok: true, logs: data } : { ok: true, logs: [] };
    case 'GETCHILDREN':
      return Array.isArray(data) ? { ok: true, children: data } : { ok: true, children: [] };
    case 'PUSHFLOW':
      return data && typeof data === 'object' ? { ok: true, ...data } : json;
    case 'ISPAUSED':
      if (typeof data === 'boolean') return { ok: true, paused: data };
      if (data && typeof data === 'object' && 'paused' in data) {
        return { ok: true, paused: (data as { paused: boolean }).paused };
      }
      return json;
    default:
      return json;
  }
}
