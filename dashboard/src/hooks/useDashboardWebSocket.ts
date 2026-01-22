/**
 * Dashboard WebSocket Hook - React 19 Best Practices
 *
 * For better performance, use individual hooks:
 * - useIsConnected()
 * - useStats()
 * - useMetrics()
 * - useQueues()
 * - useWorkers()
 * - useCrons()
 * - useMetricsHistory()
 * - useSystemMetrics()
 * - useSqliteStats()
 */

import {
  useIsConnected,
  useStats,
  useMetrics,
  useQueues,
  useWorkers,
  useCrons,
  useMetricsHistory,
  useSystemMetrics,
  useSqliteStats,
  useReconnect,
} from '../stores';
import type { Stats, Metrics, Queue, Worker, MetricsHistory, CronJob } from '../api/types';
import type { SystemMetrics, SqliteStats } from '../api/client';

export interface DashboardUpdate {
  stats: Stats;
  metrics: Metrics;
  queues: Queue[];
  workers: Worker[];
  crons: CronJob[];
  metrics_history: MetricsHistory[];
  system_metrics: SystemMetrics;
  sqlite_stats: SqliteStats | null;
  timestamp: number;
}

export interface UseDashboardWebSocketReturn {
  isConnected: boolean;
  data: DashboardUpdate | null;
  stats: Stats | null;
  metrics: Metrics | null;
  queues: Queue[];
  workers: Worker[];
  crons: CronJob[];
  metricsHistory: MetricsHistory[];
  systemMetrics: SystemMetrics | null;
  sqliteStats: SqliteStats | null;
  lastUpdate: number | null;
  reconnect: () => void;
}

export function useDashboardWebSocket(): UseDashboardWebSocketReturn {
  const isConnected = useIsConnected();
  const stats = useStats();
  const metrics = useMetrics();
  const queues = useQueues();
  const workers = useWorkers();
  const crons = useCrons();
  const metricsHistory = useMetricsHistory();
  const systemMetrics = useSystemMetrics();
  const sqliteStats = useSqliteStats();
  const reconnect = useReconnect();

  return {
    isConnected,
    stats,
    metrics,
    queues,
    workers,
    crons,
    metricsHistory,
    systemMetrics,
    sqliteStats,
    lastUpdate: null,
    reconnect,
    data: stats
      ? {
          stats,
          metrics: metrics!,
          queues,
          workers,
          crons,
          metrics_history: metricsHistory,
          system_metrics: systemMetrics!,
          sqlite_stats: sqliteStats,
          timestamp: Date.now(),
        }
      : null,
  };
}
