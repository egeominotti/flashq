import type {
  ApiResponse,
  Stats,
  Metrics,
  Queue,
  Job,
  CronJob,
  Worker,
  Settings,
  S3Backup,
  MetricsHistory,
} from './types';

// Configuration stored in localStorage
const STORAGE_KEY_URL = 'flashq_api_url';
const STORAGE_KEY_TOKEN = 'flashq_auth_token';

const DEFAULT_URL = 'http://localhost:6790';

function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(STORAGE_KEY_URL) || import.meta.env.VITE_FLASHQ_API_URL || DEFAULT_URL;
  }
  return DEFAULT_URL;
}

function getAuthToken(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(STORAGE_KEY_TOKEN) || import.meta.env.VITE_FLASHQ_AUTH_TOKEN || '';
  }
  return '';
}

export function setApiUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY_URL, url);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(STORAGE_KEY_TOKEN, token);
}

export function getConnectionConfig(): { url: string; token: string } {
  return {
    url: getApiUrl(),
    token: getAuthToken(),
  };
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T | null> {
  const apiUrl = getApiUrl();
  const authToken = getAuthToken();

  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(authToken && { Authorization: `Bearer ${authToken}` }),
      ...options.headers,
    };

    const res = await fetch(`${apiUrl}${endpoint}`, {
      ...options,
      headers,
    });

    const data: ApiResponse<T> = await res.json();
    return data.ok ? (data.data ?? null) : null;
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    return null;
  }
}

async function postApi<T>(
  endpoint: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const apiUrl = getApiUrl();
  const authToken = getAuthToken();

  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(authToken && { Authorization: `Bearer ${authToken}` }),
    };

    const res = await fetch(`${apiUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    return await res.json();
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    return { ok: false, error: String(error) };
  }
}

async function deleteApi(endpoint: string): Promise<Response | null> {
  const apiUrl = getApiUrl();
  const authToken = getAuthToken();

  try {
    return await fetch(`${apiUrl}${endpoint}`, {
      method: 'DELETE',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
  } catch (error) {
    console.error(`API Error [DELETE ${endpoint}]:`, error);
    return null;
  }
}

// Connection Test
export async function testConnection(url: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${url}/health`, { method: 'GET' });
    if (res.ok) {
      return { success: true };
    }
    return { success: false, error: `Server returned status ${res.status}` };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Stats & Metrics
export const fetchStats = () => fetchApi<Stats>('/stats');
export const fetchMetrics = () => fetchApi<Metrics>('/metrics');
export const fetchMetricsHistory = () => fetchApi<MetricsHistory[]>('/metrics/history');
export const fetchSettings = () => fetchApi<Settings>('/settings');

// Queues
export const fetchQueues = () => fetchApi<Queue[]>('/queues');
export const pauseQueue = (name: string) => postApi(`/queues/${encodeURIComponent(name)}/pause`);
export const resumeQueue = (name: string) => postApi(`/queues/${encodeURIComponent(name)}/resume`);
export const drainQueue = (name: string) => postApi(`/queues/${encodeURIComponent(name)}/drain`);
export const retryDlq = (name: string) => postApi(`/queues/${encodeURIComponent(name)}/dlq/retry`);
export const setRateLimit = (name: string, limit: number) =>
  postApi(`/queues/${encodeURIComponent(name)}/rate-limit`, { limit });
export const clearRateLimit = (name: string) =>
  deleteApi(`/queues/${encodeURIComponent(name)}/rate-limit`);
export const setConcurrency = (name: string, limit: number) =>
  postApi(`/queues/${encodeURIComponent(name)}/concurrency`, { limit });
export const clearConcurrency = (name: string) =>
  deleteApi(`/queues/${encodeURIComponent(name)}/concurrency`);

// Jobs
export const fetchJobs = (params?: {
  queue?: string;
  state?: string;
  limit?: number;
  offset?: number;
}) => {
  const searchParams = new URLSearchParams();
  if (params?.queue) searchParams.set('queue', params.queue);
  if (params?.state) searchParams.set('state', params.state);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return fetchApi<Job[]>(`/jobs${query ? `?${query}` : ''}`);
};

export const fetchJob = (id: number) => fetchApi<Job>(`/jobs/${id}`);
export const cancelJob = (id: number) => postApi(`/jobs/${id}/cancel`);
export const ackJob = (id: number, result?: unknown) => postApi(`/jobs/${id}/ack`, { result });
export const failJob = (id: number, error?: string) => postApi(`/jobs/${id}/fail`, { error });

// Cron Jobs
export const fetchCrons = () => fetchApi<CronJob[]>('/crons');
export const createCron = (name: string, params: Omit<CronJob, 'name' | 'next_run'>) =>
  postApi(`/crons/${encodeURIComponent(name)}`, params);
export const deleteCron = (name: string) =>
  deleteApi(`/crons/${encodeURIComponent(name)}`);

// Workers
export const fetchWorkers = () => fetchApi<Worker[]>('/workers');

// S3 Backup
export const listS3Backups = () => fetchApi<S3Backup[]>('/s3/backups');
export const triggerS3Backup = () => postApi('/s3/backup');
export const restoreS3Backup = (key: string) => postApi('/s3/restore', { key });

// S3 Settings
export interface S3SettingsPayload {
  enabled: boolean;
  endpoint?: string;
  bucket?: string;
  region?: string;
  access_key?: string;
  secret_key?: string;
  interval_secs?: number;
  keep_count?: number;
  prefix?: string;
  compress?: boolean;
}

export const getS3Settings = () => fetchApi<{
  enabled: boolean;
  endpoint?: string;
  bucket?: string;
  region?: string;
  interval_secs: number;
  keep_count: number;
  compress: boolean;
}>('/s3/settings');

export const saveS3Settings = (settings: S3SettingsPayload) =>
  postApi<string>('/s3/settings', settings);

export const testS3Connection = (settings: S3SettingsPayload) =>
  postApi<string>('/s3/test', settings);

// SQLite Settings
export interface SqliteSettingsPayload {
  enabled: boolean;
  path?: string;
  synchronous?: boolean;
  cache_size_mb?: number;
}

export const getSqliteSettings = () => fetchApi<{
  enabled: boolean;
  path?: string;
  synchronous: boolean;
  snapshot_interval: number;
  snapshot_min_changes: number;
}>('/sqlite/settings');

export const saveSqliteSettings = (settings: SqliteSettingsPayload) =>
  postApi<string>('/sqlite/settings', settings);

// Server Management
export const clearAllQueues = () => postApi('/server/clear-queues');
export const clearAllDlq = () => postApi('/server/clear-dlq');
export const clearCompletedJobs = () => postApi('/server/clear-completed');
export const resetMetrics = () => postApi('/server/reset-metrics');
export const shutdownServer = () => postApi('/server/shutdown');
export const restartServer = () => postApi('/server/restart');

// Settings
export const saveAuthSettings = (tokens: string) =>
  postApi('/settings/auth', { tokens });
export const saveQueueDefaults = (settings: {
  default_timeout?: number;
  default_max_attempts?: number;
  default_backoff?: number;
  default_ttl?: number;
}) => postApi('/settings/queue-defaults', settings);
export const saveCleanupSettings = (settings: {
  max_completed_jobs?: number;
  max_job_results?: number;
  cleanup_interval_secs?: number;
  metrics_history_size?: number;
}) => postApi('/settings/cleanup', settings);
export const runCleanup = () => postApi('/settings/cleanup/run');

// Export API object for use in components
export const api = {
  // Connection
  getApiUrl,
  setApiUrl,
  getAuthToken,
  setAuthToken,
  getConnectionConfig,
  testConnection,

  // Stats & Metrics
  fetchStats,
  fetchMetrics,
  fetchMetricsHistory,
  fetchSettings,

  // Queues
  fetchQueues,
  pauseQueue,
  resumeQueue,
  drainQueue,
  retryDlq,
  setRateLimit,
  clearRateLimit,
  setConcurrency,
  clearConcurrency,

  // Jobs
  fetchJobs,
  fetchJob,
  cancelJob,
  ackJob,
  failJob,
  retryJob: (queueName: string, jobId: string) =>
    postApi(`/queues/${encodeURIComponent(queueName)}/jobs/${jobId}/retry`),

  // Cron Jobs
  fetchCrons,
  addCron: (name: string, params: { queue: string; schedule: string; data?: unknown }) =>
    postApi(`/crons/${encodeURIComponent(name)}`, params),
  deleteCron,

  // Workers
  fetchWorkers,

  // S3 Backup
  listS3Backups,
  triggerS3Backup,
  restoreS3Backup,

  // SQLite Settings
  getSqliteSettings,
  saveSqliteSettings,

  // S3 Settings
  getS3Settings,
  saveS3Settings,
  testS3Connection,

  // Server Management
  clearAllQueues,
  clearAllDlq,
  clearCompletedJobs,
  resetMetrics,
  shutdownServer,
  restartServer,

  // Settings
  saveAuthSettings,
  saveQueueDefaults,
  saveCleanupSettings,
  runCleanup,
};
