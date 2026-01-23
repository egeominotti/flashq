/**
 * WebSocket Store - React 19 Best Practices
 * Single shared connection with useSyncExternalStore pattern
 *
 * PERFORMANCE OPTIMIZATIONS:
 * - Stable references: Only update fields that actually changed
 * - Throttled updates: Max 5 updates per second (200ms minimum between updates)
 * - Shallow comparison: Skip update if values are equal
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

// Singleton state - each field is updated independently for stable references
let socket: WebSocket | null = null;
let isConnected = false;
let stats: Stats | null = null;
let metrics: Metrics | null = null;
let queues: Queue[] = [];
let workers: Worker[] = [];
let crons: CronJob[] = [];
let metricsHistory: MetricsHistory[] = [];
let systemMetrics: SystemMetrics | null = null;
let sqliteStats: SqliteStats | null = null;
let timestamp: number | null = null;

let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

// Throttling state
let lastNotifyTime = 0;
let pendingNotify = false;
const THROTTLE_MS = 5000; // 1 update every 5 seconds (optimized for high-load scenarios)

// ============================================================================
// Shallow Comparison Helpers
// ============================================================================

function shallowEqual<T extends Record<string, unknown>>(a: T | null, b: T | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function arraysEqual<T>(a: T[], b: T[], compareFn: (x: T, y: T) => boolean): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!compareFn(a[i], b[i])) return false;
  }
  return true;
}

// ============================================================================
// Sanitization Helpers (ensure non-negative values)
// ============================================================================

function sanitizeStats(s: Stats | null | undefined): Stats | null {
  if (!s) return null;
  return {
    queued: Math.max(0, s.queued ?? 0),
    processing: Math.max(0, s.processing ?? 0),
    completed: Math.max(0, s.completed ?? 0),
    delayed: Math.max(0, s.delayed ?? 0),
    dlq: Math.max(0, s.dlq ?? 0),
  };
}

function sanitizeMetrics(m: Metrics | null | undefined): Metrics | null {
  if (!m) return null;
  return {
    ...m,
    total_pushed: Math.max(0, m.total_pushed ?? 0),
    total_completed: Math.max(0, m.total_completed ?? 0),
    total_failed: Math.max(0, m.total_failed ?? 0),
    jobs_per_second: Math.max(0, m.jobs_per_second ?? 0),
    avg_latency_ms: Math.max(0, m.avg_latency_ms ?? 0),
    queues: (m.queues ?? []).map((q) => ({
      ...q,
      pending: Math.max(0, q.pending ?? 0),
      processing: Math.max(0, q.processing ?? 0),
      dlq: Math.max(0, q.dlq ?? 0),
    })),
  };
}

function sanitizeQueues(qs: Queue[] | null | undefined): Queue[] {
  if (!qs) return [];
  return qs.map((q) => ({
    ...q,
    pending: Math.max(0, q.pending ?? 0),
    processing: Math.max(0, q.processing ?? 0),
    dlq: Math.max(0, q.dlq ?? 0),
    completed: Math.max(0, q.completed ?? 0),
    delayed: Math.max(0, q.delayed ?? 0),
  }));
}

function sanitizeMetricsHistory(h: MetricsHistory[] | null | undefined): MetricsHistory[] {
  if (!h) return [];
  return h.map((p) => ({
    ...p,
    queued: Math.max(0, p.queued ?? 0),
    processing: Math.max(0, p.processing ?? 0),
    completed: Math.max(0, p.completed ?? 0),
    failed: Math.max(0, p.failed ?? 0),
    throughput: Math.max(0, p.throughput ?? 0),
  }));
}

function sanitizeSystemMetrics(m: SystemMetrics | null | undefined): SystemMetrics | null {
  if (!m) return null;
  return {
    ...m,
    cpu_percent: Math.max(0, m.cpu_percent ?? 0),
    memory_percent: Math.max(0, m.memory_percent ?? 0),
    memory_used_mb: Math.max(0, m.memory_used_mb ?? 0),
    memory_total_mb: Math.max(0, m.memory_total_mb ?? 0),
    tcp_connections: Math.max(0, m.tcp_connections ?? 0),
    uptime_seconds: Math.max(0, m.uptime_seconds ?? 0),
    process_id: Math.max(0, m.process_id ?? 0),
  };
}

// ============================================================================
// Listeners with Throttling
// ============================================================================

const listeners = new Set<() => void>();

function notify() {
  const now = performance.now();
  const elapsed = now - lastNotifyTime;

  if (elapsed >= THROTTLE_MS) {
    // Enough time has passed, notify immediately
    lastNotifyTime = now;
    pendingNotify = false;
    listeners.forEach((l) => l());
  } else if (!pendingNotify) {
    // Schedule a delayed notification
    pendingNotify = true;
    setTimeout(() => {
      if (pendingNotify) {
        lastNotifyTime = performance.now();
        pendingNotify = false;
        listeners.forEach((l) => l());
      }
    }, THROTTLE_MS - elapsed);
  }
  // If pendingNotify is already true, we just skip (coalesce updates)
}

// ============================================================================
// Connection Management
// ============================================================================

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

        let hasChanges = false;

        // Update each field only if it actually changed
        const newStats = sanitizeStats(update.stats);
        if (newStats && !shallowEqual(stats as unknown as Record<string, unknown>, newStats as unknown as Record<string, unknown>)) {
          stats = newStats;
          hasChanges = true;
        }

        const newMetrics = sanitizeMetrics(update.metrics);
        if (newMetrics && !shallowEqual(metrics as unknown as Record<string, unknown>, newMetrics as unknown as Record<string, unknown>)) {
          metrics = newMetrics;
          hasChanges = true;
        }

        if (update.queues) {
          const newQueues = sanitizeQueues(update.queues);
          // Quick length check first, then compare
          if (newQueues.length !== queues.length ||
              !arraysEqual(queues, newQueues, (a, b) =>
                a.name === b.name &&
                a.pending === b.pending &&
                a.processing === b.processing &&
                a.completed === b.completed &&
                a.delayed === b.delayed &&
                a.dlq === b.dlq &&
                a.paused === b.paused
              )) {
            queues = newQueues;
            hasChanges = true;
          }
        }

        if (update.workers) {
          const newWorkers = update.workers as Worker[];
          if (newWorkers.length !== workers.length ||
              !arraysEqual(workers, newWorkers, (a, b) =>
                a.id === b.id &&
                a.jobs_processed === b.jobs_processed &&
                a.last_heartbeat === b.last_heartbeat
              )) {
            workers = newWorkers;
            hasChanges = true;
          }
        }

        if (update.crons) {
          const newCrons = update.crons as CronJob[];
          if (newCrons.length !== crons.length) {
            crons = newCrons;
            hasChanges = true;
          }
        }

        if (update.metrics_history) {
          const newHistory = sanitizeMetricsHistory(update.metrics_history);
          // Only update if length changed or last item is different
          if (newHistory.length !== metricsHistory.length ||
              (newHistory.length > 0 && metricsHistory.length > 0 &&
               newHistory[newHistory.length - 1].timestamp !== metricsHistory[metricsHistory.length - 1].timestamp)) {
            metricsHistory = newHistory;
            hasChanges = true;
          }
        }

        const newSystemMetrics = sanitizeSystemMetrics(update.system_metrics);
        if (newSystemMetrics && !shallowEqual(systemMetrics as unknown as Record<string, unknown>, newSystemMetrics as unknown as Record<string, unknown>)) {
          systemMetrics = newSystemMetrics;
          hasChanges = true;
        }

        if (update.sqlite_stats && !shallowEqual(sqliteStats as unknown as Record<string, unknown>, update.sqlite_stats as unknown as Record<string, unknown>)) {
          sqliteStats = update.sqlite_stats;
          hasChanges = true;
        }

        if (update.timestamp && update.timestamp !== timestamp) {
          timestamp = update.timestamp;
          // Timestamp changes don't trigger re-render alone
        }

        // Only notify if something actually changed
        if (hasChanges) {
          notify();
        }
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
  };
}

// ============================================================================
// Snapshots - Return stable references
// ============================================================================

const getIsConnected = () => isConnected;
const getStats = () => stats;
const getMetrics = () => metrics;
const getQueues = () => queues;
const getWorkers = () => workers;
const getCrons = () => crons;
const getMetricsHistory = () => metricsHistory;
const getSystemMetrics = () => systemMetrics;
const getSqliteStats = () => sqliteStats;
const getTimestamp = () => timestamp;

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
