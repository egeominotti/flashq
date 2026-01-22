import { useEffect, useRef, useState, useCallback } from 'react';
import { getDashboardWebSocketUrl } from '../api/client';
import type { Stats, Metrics, Queue, Worker, MetricsHistory } from '../api/types';

/**
 * Dashboard update payload from WebSocket /ws/dashboard
 * Server sends this every 1 second
 */
export interface DashboardUpdate {
  stats: Stats;
  metrics: Metrics;
  queues: Queue[];
  workers: Worker[];
  metrics_history: MetricsHistory[];
  timestamp: number;
}

export interface UseDashboardWebSocketOptions {
  enabled?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onUpdate?: (data: DashboardUpdate) => void;
}

export interface UseDashboardWebSocketReturn {
  isConnected: boolean;
  data: DashboardUpdate | null;
  stats: Stats | null;
  metrics: Metrics | null;
  queues: Queue[];
  workers: Worker[];
  metricsHistory: MetricsHistory[];
  lastUpdate: number | null;
  reconnect: () => void;
}

export function useDashboardWebSocket(
  options: UseDashboardWebSocketOptions = {}
): UseDashboardWebSocketReturn {
  const { enabled = true, onConnect, onDisconnect, onUpdate } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [data, setData] = useState<DashboardUpdate | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const connect = useCallback(() => {
    if (!enabled) return;

    try {
      const wsUrl = getDashboardWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const update: DashboardUpdate = JSON.parse(event.data);
          setData(update);
          onUpdateRef.current?.(update);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        onDisconnect?.();

        // Reconnect with exponential backoff
        if (enabled) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('Dashboard WebSocket error:', error);
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
    }
  }, [enabled, onConnect, onDisconnect]);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    if (!enabled) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, connect]);

  return {
    isConnected,
    data,
    stats: data?.stats ?? null,
    metrics: data?.metrics ?? null,
    queues: data?.queues ?? [],
    workers: data?.workers ?? [],
    metricsHistory: data?.metrics_history ?? [],
    lastUpdate: data?.timestamp ?? null,
    reconnect,
  };
}
