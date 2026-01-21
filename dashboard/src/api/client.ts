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
    return (
      localStorage.getItem(STORAGE_KEY_URL) || import.meta.env.VITE_FLASHQ_API_URL || DEFAULT_URL
    );
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

// ============================================================================
// HTTP Helpers
// ============================================================================

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T | null> {
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

async function postApi<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
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

async function deleteApi<T = unknown>(endpoint: string): Promise<ApiResponse<T>> {
  const apiUrl = getApiUrl();
  const authToken = getAuthToken();

  try {
    const res = await fetch(`${apiUrl}${endpoint}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
      },
    });

    return await res.json();
  } catch (error) {
    console.error(`API Error [DELETE ${endpoint}]:`, error);
    return { ok: false, error: String(error) };
  }
}

// ============================================================================
// Health & Connection
// ============================================================================

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

export interface HealthResponse {
  status: string;
  version: string;
  uptime_seconds: number;
  node_id?: string;
  is_leader?: boolean;
}

export const fetchHealth = () => fetchApi<HealthResponse>('/health');

// ============================================================================
// Stats & Metrics
// ============================================================================

export const fetchStats = () => fetchApi<Stats>('/stats');
export const fetchMetrics = () => fetchApi<Metrics>('/metrics');
export const fetchMetricsHistory = () => fetchApi<MetricsHistory[]>('/metrics/history');
export const fetchPrometheusMetrics = async (): Promise<string | null> => {
  const apiUrl = getApiUrl();
  try {
    const res = await fetch(`${apiUrl}/metrics/prometheus`);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
};
export const fetchSettings = () => fetchApi<Settings>('/settings');

export interface SystemMetrics {
  memory_used_mb: number;
  memory_total_mb: number;
  memory_percent: number;
  cpu_percent: number;
  tcp_connections: number;
  uptime_seconds: number;
  process_id: number;
}

export const fetchSystemMetrics = () => fetchApi<SystemMetrics>('/system/metrics');

// ============================================================================
// Queue Operations
// ============================================================================

export const fetchQueues = () => fetchApi<Queue[]>('/queues');

export const pauseQueue = (name: string) => postApi(`/queues/${encodeURIComponent(name)}/pause`);

export const resumeQueue = (name: string) => postApi(`/queues/${encodeURIComponent(name)}/resume`);

export const drainQueue = (name: string) => postApi(`/queues/${encodeURIComponent(name)}/drain`);

export const obliterateQueue = (name: string) =>
  deleteApi(`/queues/${encodeURIComponent(name)}/obliterate`);

export const cleanQueue = (
  name: string,
  params: { grace?: number; limit?: number; state?: string }
) => postApi(`/queues/${encodeURIComponent(name)}/clean`, params);

export const getDlq = (name: string) => fetchApi<Job[]>(`/queues/${encodeURIComponent(name)}/dlq`);

export const retryDlq = (name: string) => postApi(`/queues/${encodeURIComponent(name)}/dlq/retry`);

export const setRateLimit = (name: string, limit: number) =>
  postApi(`/queues/${encodeURIComponent(name)}/rate-limit`, { limit });

export const clearRateLimit = (name: string) =>
  deleteApi(`/queues/${encodeURIComponent(name)}/rate-limit`);

export const setConcurrency = (name: string, limit: number) =>
  postApi(`/queues/${encodeURIComponent(name)}/concurrency`, { limit });

export const clearConcurrency = (name: string) =>
  deleteApi(`/queues/${encodeURIComponent(name)}/concurrency`);

// Push job to queue
export interface PushJobOptions {
  data?: unknown;
  priority?: number;
  delay?: number;
  ttl?: number;
  timeout?: number;
  max_attempts?: number;
  backoff?: number;
  unique_key?: string;
  depends_on?: number[];
  tags?: string[];
  job_id?: string;
}

export const pushJob = (queue: string, options: PushJobOptions) =>
  postApi<{ id: number }>(`/queues/${encodeURIComponent(queue)}/jobs`, options);

// Pull jobs from queue
export const pullJobs = (queue: string, count?: number, timeout?: number) => {
  const params = new URLSearchParams();
  if (count) params.set('count', String(count));
  if (timeout) params.set('timeout', String(timeout));
  const query = params.toString();
  return fetchApi<Job[]>(`/queues/${encodeURIComponent(queue)}/jobs${query ? `?${query}` : ''}`);
};

// ============================================================================
// Job Operations
// ============================================================================

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

export const updateProgress = (id: number, progress: number, message?: string) =>
  postApi(`/jobs/${id}/progress`, { progress, message });

export const getProgress = (id: number) =>
  fetchApi<{ progress: number; message?: string }>(`/jobs/${id}/progress`);

export const getResult = (id: number) => fetchApi<unknown>(`/jobs/${id}/result`);

export const changePriority = (id: number, priority: number) =>
  postApi(`/jobs/${id}/priority`, { priority });

export const moveToDelayed = (id: number, delay: number) =>
  postApi(`/jobs/${id}/move-to-delayed`, { delay });

export const promoteJob = (id: number) => postApi(`/jobs/${id}/promote`);

export const discardJob = (id: number) => postApi(`/jobs/${id}/discard`);

export const retryJob = (queueName: string, jobId: number) =>
  postApi(`/queues/${encodeURIComponent(queueName)}/dlq/retry`, { job_id: jobId });

// ============================================================================
// Cron Jobs
// ============================================================================

export const fetchCrons = () => fetchApi<CronJob[]>('/crons');

export const createCron = (
  name: string,
  params: {
    queue: string;
    schedule: string;
    data?: unknown;
    priority?: number;
    enabled?: boolean;
  }
) => postApi(`/crons/${encodeURIComponent(name)}`, params);

export const deleteCron = (name: string) => deleteApi(`/crons/${encodeURIComponent(name)}`);

// ============================================================================
// Workers
// ============================================================================

export const fetchWorkers = () => fetchApi<Worker[]>('/workers');

export const workerHeartbeat = (
  id: string,
  data?: { jobs_processed?: number; current_job?: number }
) => postApi(`/workers/${encodeURIComponent(id)}/heartbeat`, data);

// ============================================================================
// Webhooks
// ============================================================================

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  queue?: string;
  secret?: string;
  enabled: boolean;
  created_at: string;
}

export const fetchWebhooks = () => fetchApi<Webhook[]>('/webhooks');

export const createWebhook = (params: {
  url: string;
  events: string[];
  queue?: string;
  secret?: string;
}) => postApi<Webhook>('/webhooks', params);

export const deleteWebhook = (id: string) => deleteApi(`/webhooks/${encodeURIComponent(id)}`);

// ============================================================================
// S3 Backup
// ============================================================================

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

export interface S3SettingsResponse {
  enabled: boolean;
  endpoint?: string;
  bucket?: string;
  region?: string;
  interval_secs: number;
  keep_count: number;
  compress: boolean;
}

export const getS3Settings = () => fetchApi<S3SettingsResponse>('/s3/settings');
export const saveS3Settings = (settings: S3SettingsPayload) =>
  postApi<string>('/s3/settings', settings);
export const testS3Connection = (settings: S3SettingsPayload) =>
  postApi<string>('/s3/test', settings);

// ============================================================================
// SQLite Settings
// ============================================================================

export interface SqliteSettingsPayload {
  enabled: boolean;
  path?: string;
  synchronous?: boolean;
  cache_size_mb?: number;
}

export interface SqliteSettingsResponse {
  enabled: boolean;
  path?: string;
  synchronous: boolean;
  snapshot_interval: number;
  snapshot_min_changes: number;
}

export const getSqliteSettings = () => fetchApi<SqliteSettingsResponse>('/sqlite/settings');
export const saveSqliteSettings = (settings: SqliteSettingsPayload) =>
  postApi<string>('/sqlite/settings', settings);

// SQLite Stats
export interface SqliteStats {
  enabled: boolean;
  path?: string;
  file_size_bytes: number;
  file_size_mb: number;
  total_jobs: number;
  queued_jobs: number;
  processing_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  delayed_jobs: number;
  // Async writer stats
  async_writer_enabled: boolean;
  async_writer_queue_len: number;
  async_writer_ops_queued: number;
  async_writer_ops_written: number;
  async_writer_batches_written: number;
  async_writer_batch_interval_ms: number;
  async_writer_max_batch_size: number;
}

export const getSqliteStats = () => fetchApi<SqliteStats>('/sqlite/stats');
export const exportSqliteDatabase = () => postApi<string>('/sqlite/export');
export const restoreSqliteDatabase = async (file: File): Promise<ApiResponse<string>> => {
  const apiUrl = getApiUrl();
  const authToken = getAuthToken();

  try {
    const formData = new FormData();
    formData.append('file', file);

    const headers: HeadersInit = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    // Don't set Content-Type - browser will set it with boundary for multipart

    const res = await fetch(`${apiUrl}/sqlite/restore`, {
      method: 'POST',
      headers,
      body: formData,
    });

    return await res.json();
  } catch (error) {
    console.error('API Error [/sqlite/restore]:', error);
    return { ok: false, error: String(error) };
  }
};

// Async Writer Config
export interface AsyncWriterConfigPayload {
  batch_interval_ms?: number;
  max_batch_size?: number;
}

export const updateAsyncWriterConfig = (config: AsyncWriterConfigPayload) =>
  postApi<string>('/sqlite/async-writer', config);

// ============================================================================
// Server Management
// ============================================================================

export const clearAllQueues = () => postApi<number>('/server/clear-queues');
export const clearAllDlq = () => postApi<number>('/server/clear-dlq');
export const clearCompletedJobs = () => postApi<number>('/server/clear-completed');
export const resetMetrics = () => postApi('/server/reset-metrics');
export const resetServer = () => postApi('/server/reset');
export const shutdownServer = () => postApi('/server/shutdown');
export const restartServer = () => postApi('/server/restart');

// ============================================================================
// Settings
// ============================================================================

export const saveAuthSettings = (tokens: string) => postApi('/settings/auth', { tokens });

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

// ============================================================================
// WebSocket URLs (for client-side connections)
// ============================================================================

export function getWebSocketUrl(path: string = '/ws'): string {
  const apiUrl = getApiUrl();
  const wsUrl = apiUrl.replace(/^http/, 'ws');
  const token = getAuthToken();
  return token ? `${wsUrl}${path}?token=${encodeURIComponent(token)}` : `${wsUrl}${path}`;
}

export function getDashboardWebSocketUrl(): string {
  return getWebSocketUrl('/ws/dashboard');
}

export function getQueueWebSocketUrl(queue: string): string {
  return getWebSocketUrl(`/ws/${encodeURIComponent(queue)}`);
}

// SSE URLs
export function getEventsUrl(): string {
  const apiUrl = getApiUrl();
  const token = getAuthToken();
  return token ? `${apiUrl}/events?token=${encodeURIComponent(token)}` : `${apiUrl}/events`;
}

export function getQueueEventsUrl(queue: string): string {
  const apiUrl = getApiUrl();
  const token = getAuthToken();
  const url = `${apiUrl}/events/${encodeURIComponent(queue)}`;
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

// ============================================================================
// Export API object for use in components
// ============================================================================

export const api = {
  // Connection
  getApiUrl,
  setApiUrl,
  getAuthToken,
  setAuthToken,
  getConnectionConfig,
  testConnection,
  fetchHealth,

  // Stats & Metrics
  fetchStats,
  fetchMetrics,
  fetchMetricsHistory,
  fetchPrometheusMetrics,
  fetchSettings,
  fetchSystemMetrics,

  // Queues
  fetchQueues,
  pauseQueue,
  resumeQueue,
  drainQueue,
  obliterateQueue,
  cleanQueue,
  getDlq,
  retryDlq,
  setRateLimit,
  clearRateLimit,
  setConcurrency,
  clearConcurrency,
  pushJob,
  pullJobs,

  // Jobs
  fetchJobs,
  fetchJob,
  cancelJob,
  ackJob,
  failJob,
  updateProgress,
  getProgress,
  getResult,
  changePriority,
  moveToDelayed,
  promoteJob,
  discardJob,
  retryJob,

  // Cron Jobs
  fetchCrons,
  createCron,
  addCron: createCron, // alias
  deleteCron,

  // Workers
  fetchWorkers,
  workerHeartbeat,

  // Webhooks
  fetchWebhooks,
  createWebhook,
  deleteWebhook,

  // S3 Backup
  listS3Backups,
  triggerS3Backup,
  restoreS3Backup,

  // S3 Settings
  getS3Settings,
  saveS3Settings,
  testS3Connection,

  // SQLite Settings
  getSqliteSettings,
  saveSqliteSettings,
  getSqliteStats,
  updateAsyncWriterConfig,

  // Server Management
  clearAllQueues,
  clearAllDlq,
  clearCompletedJobs,
  resetMetrics,
  resetServer,
  shutdownServer,
  restartServer,

  // Settings
  saveAuthSettings,
  saveQueueDefaults,
  saveCleanupSettings,
  runCleanup,

  // WebSocket/SSE URLs
  getWebSocketUrl,
  getDashboardWebSocketUrl,
  getQueueWebSocketUrl,
  getEventsUrl,
  getQueueEventsUrl,
};
