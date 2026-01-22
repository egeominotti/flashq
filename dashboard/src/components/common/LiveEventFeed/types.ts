import { Zap, CheckCircle2, XCircle, TrendingUp } from 'lucide-react';
import type { JobEvent } from '../../../hooks/useJobEvents';

export type { JobEvent };

export interface LiveEventFeedProps {
  isConnected: boolean;
  recentEvents: JobEvent[];
  eventCounts: {
    pushed: number;
    completed: number;
    failed: number;
  };
}

export interface EventConfig {
  icon: typeof Zap;
  color: string;
  label: string;
}

export const eventConfig: Record<string, EventConfig> = {
  pushed: { icon: Zap, color: 'cyan', label: 'Pushed' },
  completed: { icon: CheckCircle2, color: 'emerald', label: 'Completed' },
  failed: { icon: XCircle, color: 'rose', label: 'Failed' },
  progress: { icon: TrendingUp, color: 'blue', label: 'Progress' },
};

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}
