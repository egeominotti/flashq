/**
 * WebSocket Context - React 19 Best Practices
 * Re-exports hooks from the store for backward compatibility
 */

export type { DashboardData as DashboardUpdate } from '../stores';

export {
  useIsConnected,
  useStats,
  useMetrics,
  useQueues,
  useWorkers,
  useCrons,
  useMetricsHistory,
  useSystemMetrics,
  useStorageStats,
  useReconnect,
  useDashboardData,
} from '../stores';

// Legacy hook alias
export { useDashboardData as useWebSocketContext } from '../stores';

// Provider is no longer needed - connection starts on first hook usage
// Kept for backward compatibility
export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
