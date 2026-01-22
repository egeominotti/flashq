/**
 * WebSocket Store - React 19 Best Practices
 * Single shared connection with useSyncExternalStore pattern
 */

import { useSyncExternalStore } from 'react';
import { getDashboardWebSocketUrl, type SystemMetrics, type SqliteStats } from '../api/client';
import type { Stats, Metrics, Queue, Worker, MetricsHistory, CronJob } from '../api/types';

export interface DashboardData {
  stats: Stats | null;
  metrics: Metrics | null;
  queues: Queue[];
  workers: Worker[];
  crons: CronJob[];
  metricsHistory: MetricsHistory[];
  systemMetrics: SystemMetrics | null;
  sqliteStats: SqliteStats | null;
  timestamp: number | null;
}

// Singleton state
let socket: WebSocket | null = null;
let isConnected = false;
let data: DashboardData = {
  stats: null,
  metrics: null,
  queues: [],
  workers: [],
  crons: [],
  metricsHistory: [],
  systemMetrics: null,
  sqliteStats: null,
  timestamp: null,
};
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

// Helper function to ensure all numeric values are non-negative
function sanitizeStats(stats: Stats | null | undefined): Stats | null {
  if (!stats) return null;
  return {
    queued: Math.max(0, stats.queued ?? 0),
    processing: Math.max(0, stats.processing ?? 0),
    completed: Math.max(0, stats.completed ?? 0),
    delayed: Math.max(0, stats.delayed ?? 0),
    dlq: Math.max(0, stats.dlq ?? 0),
  };
}

function sanitizeMetrics(metrics: Metrics | null | undefined): Metrics | null {
  if (!metrics) return null;
  return {
    ...metrics,
    total_pushed: Math.max(0, metrics.total_pushed ?? 0),
    total_completed: Math.max(0, metrics.total_completed ?? 0),
    total_failed: Math.max(0, metrics.total_failed ?? 0),
    jobs_per_second: Math.max(0, metrics.jobs_per_second ?? 0),
    avg_latency_ms: Math.max(0, metrics.avg_latency_ms ?? 0),
    queues: (metrics.queues ?? []).map((q) => ({
      ...q,
      pending: Math.max(0, q.pending ?? 0),
      processing: Math.max(0, q.processing ?? 0),
      dlq: Math.max(0, q.dlq ?? 0),
    })),
  };
}

function sanitizeQueues(queues: Queue[] | null | undefined): Queue[] {
  if (!queues) return [];
  return queues.map((q) => ({
    ...q,
    pending: Math.max(0, q.pending ?? 0),
    processing: Math.max(0, q.processing ?? 0),
    dlq: Math.max(0, q.dlq ?? 0),
    completed: Math.max(0, q.completed ?? 0),
    delayed: Math.max(0, q.delayed ?? 0),
  }));
}

function sanitizeMetricsHistory(history: MetricsHistory[] | null | undefined): MetricsHistory[] {
  if (!history) return [];
  return history.map((h) => ({
    ...h,
    queued: Math.max(0, h.queued ?? 0),
    processing: Math.max(0, h.processing ?? 0),
    completed: Math.max(0, h.completed ?? 0),
    failed: Math.max(0, h.failed ?? 0),
    throughput: Math.max(0, h.throughput ?? 0),
  }));
}

function sanitizeSystemMetrics(metrics: SystemMetrics | null | undefined): SystemMetrics | null {
  if (!metrics) return null;
  return {
    ...metrics,
    cpu_percent: Math.max(0, metrics.cpu_percent ?? 0),
    memory_percent: Math.max(0, metrics.memory_percent ?? 0),
    memory_used_mb: Math.max(0, metrics.memory_used_mb ?? 0),
    memory_total_mb: Math.max(0, metrics.memory_total_mb ?? 0),
    tcp_connections: Math.max(0, metrics.tcp_connections ?? 0),
    uptime_seconds: Math.max(0, metrics.uptime_seconds ?? 0),
    process_id: Math.max(0, metrics.process_id ?? 0),
  };
}

// Listeners
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  try {
    socket = new WebSocket(getDashboardWebSocketUrl());

    socket.onopen = () => {
      isConnected = true;
      reconnectAttempts = 0;
      notify();
    };

    socket.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data);
        if (!update || typeof update !== 'object') return;

        // Update data immutably with sanitization to prevent negative values
        data = {
          stats: sanitizeStats(update.stats) ?? data.stats,
          metrics: sanitizeMetrics(update.metrics) ?? data.metrics,
          queues: update.queues ? sanitizeQueues(update.queues) : data.queues,
          workers: update.workers ?? data.workers,
          crons: update.crons ?? data.crons,
          metricsHistory: update.metrics_history
            ? sanitizeMetricsHistory(update.metrics_history)
            : data.metricsHistory,
          systemMetrics: sanitizeSystemMetrics(update.system_metrics) ?? data.systemMetrics,
          sqliteStats: update.sqlite_stats ?? data.sqliteStats,
          timestamp: update.timestamp ?? data.timestamp,
        };
        notify();
      } catch {
        // Ignore parse errors
      }
    };

    socket.onclose = () => {
      isConnected = false;
      socket = null;
      notify();

      // Reconnect with exponential backoff
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
      reconnectAttempts++;
      reconnectTimeout = setTimeout(connect, delay);
    };

    socket.onerror = () => {
      // onclose handles reconnection
    };
  } catch {
    // Ignore connection errors
  }
}

function disconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  isConnected = false;
}

function reconnect() {
  disconnect();
  reconnectAttempts = 0;
  connect();
}

// Subscribe function for useSyncExternalStore
function subscribe(callback: () => void): () => void {
  listeners.add(callback);

  // Connect on first subscriber
  if (listeners.size === 1) {
    connect();
  }

  return () => {
    listeners.delete(callback);

    // Disconnect when no subscribers (optional - keep alive for better UX)
    // if (listeners.size === 0) disconnect();
  };
}

// Snapshots - must return stable references when data hasn't changed
const getIsConnected = () => isConnected;
const getStats = () => data.stats;
const getMetrics = () => data.metrics;
const getQueues = () => data.queues;
const getWorkers = () => data.workers;
const getCrons = () => data.crons;
const getMetricsHistory = () => data.metricsHistory;
const getSystemMetrics = () => data.systemMetrics;
const getSqliteStats = () => data.sqliteStats;
const getTimestamp = () => data.timestamp;

// Server snapshots (for SSR)
const getServerIsConnected = () => false;
const getServerNull = () => null;
const getServerEmptyArray = () => [] as never[];

// ============================================================================
// Hooks - React 19 useSyncExternalStore pattern
// ============================================================================

export function useIsConnected(): boolean {
  return useSyncExternalStore(subscribe, getIsConnected, getServerIsConnected);
}

export function useStats(): Stats | null {
  return useSyncExternalStore(subscribe, getStats, getServerNull);
}

export function useMetrics(): Metrics | null {
  return useSyncExternalStore(subscribe, getMetrics, getServerNull);
}

export function useQueues(): Queue[] {
  return useSyncExternalStore(subscribe, getQueues, getServerEmptyArray);
}

export function useWorkers(): Worker[] {
  return useSyncExternalStore(subscribe, getWorkers, getServerEmptyArray);
}

export function useCrons(): CronJob[] {
  return useSyncExternalStore(subscribe, getCrons, getServerEmptyArray);
}

export function useMetricsHistory(): MetricsHistory[] {
  return useSyncExternalStore(subscribe, getMetricsHistory, getServerEmptyArray);
}

export function useSystemMetrics(): SystemMetrics | null {
  return useSyncExternalStore(subscribe, getSystemMetrics, getServerNull);
}

export function useSqliteStats(): SqliteStats | null {
  return useSyncExternalStore(subscribe, getSqliteStats, getServerNull);
}

export function useTimestamp(): number | null {
  return useSyncExternalStore(subscribe, getTimestamp, getServerNull);
}

// Action
export function useReconnect(): () => void {
  return reconnect;
}

// ============================================================================
// Legacy combined hook (prefer individual hooks for performance)
// ============================================================================

export function useDashboardData() {
  return {
    isConnected: useIsConnected(),
    stats: useStats(),
    metrics: useMetrics(),
    queues: useQueues(),
    workers: useWorkers(),
    crons: useCrons(),
    metricsHistory: useMetricsHistory(),
    systemMetrics: useSystemMetrics(),
    sqliteStats: useSqliteStats(),
    timestamp: useTimestamp(),
    reconnect,
  };
}
