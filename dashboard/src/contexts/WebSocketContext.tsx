import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react';
import { getDashboardWebSocketUrl, type SystemMetrics, type SqliteStats } from '../api/client';
import type { Stats, Metrics, Queue, Worker, MetricsHistory, CronJob } from '../api/types';

/**
 * Dashboard update payload from WebSocket /ws/dashboard
 * Server sends this every 1 second
 */
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

interface WebSocketContextValue {
  isConnected: boolean;
  data: DashboardUpdate | null;
  reconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

interface WebSocketProviderProps {
  children: ReactNode;
}

/**
 * Singleton WebSocket provider - creates ONE connection shared by all components
 */
export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [data, setData] = useState<DashboardUpdate | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const connect = useCallback(() => {
    // Don't create duplicate connections
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      const wsUrl = getDashboardWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const update: DashboardUpdate = JSON.parse(event.data);
          setData(update);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;

        // Reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = (error) => {
        console.error('Dashboard WebSocket error:', error);
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
    }
  }, []);

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
  }, [connect]);

  const value = useMemo(() => ({
    isConnected,
    data,
    reconnect,
  }), [isConnected, data, reconnect]);

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

/**
 * Hook to access the singleton WebSocket connection
 */
export function useWebSocketContext() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider');
  }
  return context;
}
