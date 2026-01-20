// API Response Types

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface QueueStats {
  name: string;
  waiting: number;
  processing: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  rate_limit?: number;
  concurrency_limit?: number;
}

export interface Stats {
  queued: number;
  processing: number;
  delayed: number;
  dlq: number;
}

export interface MetricsHistory {
  timestamp: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  throughput: number;
  latency_ms: number;
}

export interface MetricsQueue {
  name: string;
  pending: number;
  processing: number;
  dlq: number;
  rate_limit: number | null;
}

export interface Metrics {
  total_pushed: number;
  total_completed: number;
  total_failed: number;
  jobs_per_second: number;
  avg_latency_ms: number;
  queues: MetricsQueue[];
}

export interface Queue {
  name: string;
  pending: number;
  waiting: number;
  processing: number;
  completed: number;
  failed: number;
  delayed: number;
  dlq: number;
  paused: boolean;
  rate_limit?: number;
  concurrency?: number;
}

export interface Job {
  id: number;
  custom_id?: string;
  queue: string;
  data: unknown;
  priority: number;
  attempts: number;
  max_attempts: number;
  created_at: string;
  run_at?: string;
  timeout?: number;
  tags?: string[];
  state?: JobState;
  result?: unknown;
  error?: string;
}

export type JobState = 'waiting' | 'delayed' | 'active' | 'completed' | 'failed';

export interface JobsResponse {
  jobs: Job[];
  total: number;
}

export interface CronJob {
  name: string;
  queue: string;
  schedule: string;
  priority?: number;
  data?: unknown;
  enabled: boolean;
  last_run?: string;
  next_run?: string;
}

export interface CronsResponse {
  crons: CronJob[];
}

export interface Worker {
  id: string;
  queues: string[];
  concurrency: number;
  last_heartbeat: number;
  jobs_processed: number;
}

export interface WorkersResponse {
  workers: Worker[];
}

export interface SqliteSettings {
  enabled: boolean;
  path?: string;
  synchronous: boolean;
  snapshot_interval: number;
  snapshot_min_changes: number;
}

export interface S3BackupSettings {
  enabled: boolean;
  endpoint?: string;
  bucket?: string;
  region?: string;
  interval_secs: number;
  keep_count: number;
  compress: boolean;
}

export interface Settings {
  version: string;
  tcp_port: number;
  http_port: number;
  sqlite: SqliteSettings;
  s3_backup: S3BackupSettings;
  auth_enabled: boolean;
  auth_token_count: number;
  uptime_seconds: number;
}

export interface S3Backup {
  key: string;
  size: number;
  last_modified?: string;
}
