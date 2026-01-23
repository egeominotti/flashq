/**
 * Event types for flashQ real-time subscriptions.
 */

export type EventType = 'pushed' | 'completed' | 'failed' | 'progress' | 'timeout';

export interface JobEvent {
  eventType: EventType;
  queue: string;
  jobId: number;
  timestamp: number;
  data?: unknown;
  error?: string;
  progress?: number;
}

export interface EventSubscriberOptions {
  host?: string;
  httpPort?: number;
  token?: string;
  queue?: string;
  type?: 'sse' | 'websocket';
  autoReconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export interface EventSubscriberEvents {
  connected: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number) => void;
  error: (error: Error) => void;
  event: (event: JobEvent) => void;
  pushed: (event: JobEvent) => void;
  completed: (event: JobEvent) => void;
  failed: (event: JobEvent) => void;
  progress: (event: JobEvent) => void;
  timeout: (event: JobEvent) => void;
}
