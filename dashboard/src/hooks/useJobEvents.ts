import { useEffect, useRef, useState, useCallback } from 'react';
import { getWebSocketUrl } from '../api/client';

export interface JobEvent {
  event_type: 'pushed' | 'completed' | 'failed' | 'progress';
  queue: string;
  job_id: number;
  timestamp: number;
  data?: unknown;
  error?: string;
  progress?: number;
}

export interface UseJobEventsOptions {
  queue?: string;
  onEvent?: (event: JobEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  enabled?: boolean;
}

export interface UseJobEventsReturn {
  isConnected: boolean;
  lastEvent: JobEvent | null;
  recentEvents: JobEvent[];
  eventCounts: {
    pushed: number;
    completed: number;
    failed: number;
  };
  clearEvents: () => void;
}

const MAX_RECENT_EVENTS = 20;
const BATCH_INTERVAL_MS = 250; // Batch state updates every 250ms

export function useJobEvents(options: UseJobEventsOptions = {}): UseJobEventsReturn {
  const { queue, onEvent, onConnect, onDisconnect, enabled = true } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<JobEvent | null>(null);
  const [recentEvents, setRecentEvents] = useState<JobEvent[]>([]);
  const [eventCounts, setEventCounts] = useState({ pushed: 0, completed: 0, failed: 0 });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Batching refs to prevent too many state updates
  const pendingEventsRef = useRef<JobEvent[]>([]);
  const pendingCountsRef = useRef({ pushed: 0, completed: 0, failed: 0 });
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const flushBatch = useCallback(() => {
    if (pendingEventsRef.current.length > 0) {
      const events = pendingEventsRef.current;
      const counts = { ...pendingCountsRef.current };

      // Reset pending
      pendingEventsRef.current = [];
      pendingCountsRef.current = { pushed: 0, completed: 0, failed: 0 };

      // Update state once with all batched events
      setRecentEvents((prev) => [...events, ...prev].slice(0, MAX_RECENT_EVENTS));
      setEventCounts((prev) => ({
        pushed: prev.pushed + counts.pushed,
        completed: prev.completed + counts.completed,
        failed: prev.failed + counts.failed,
      }));
      setLastEvent(events[0]);
    }
    batchTimeoutRef.current = null;
  }, []);

  const clearEvents = useCallback(() => {
    setRecentEvents([]);
    setEventCounts({ pushed: 0, completed: 0, failed: 0 });
    setLastEvent(null);
    pendingEventsRef.current = [];
    pendingCountsRef.current = { pushed: 0, completed: 0, failed: 0 };
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const connect = () => {
      try {
        const wsUrl = queue ? getWebSocketUrl(`/ws/${encodeURIComponent(queue)}`) : getWebSocketUrl('/ws');
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          reconnectAttemptsRef.current = 0;
          onConnect?.();
        };

        ws.onmessage = (event) => {
          try {
            const jobEvent: JobEvent = JSON.parse(event.data);

            // Add to pending batch
            pendingEventsRef.current.unshift(jobEvent);
            const key = jobEvent.event_type as keyof typeof pendingCountsRef.current;
            if (key in pendingCountsRef.current) {
              pendingCountsRef.current[key]++;
            }

            // Call onEvent immediately (but debounced in the consumer)
            onEventRef.current?.(jobEvent);

            // Schedule batch flush
            if (!batchTimeoutRef.current) {
              batchTimeoutRef.current = setTimeout(flushBatch, BATCH_INTERVAL_MS);
            }
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
          console.error('WebSocket error:', error);
        };
      } catch (err) {
        console.error('Failed to create WebSocket:', err);
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, queue, onConnect, onDisconnect, flushBatch]);

  return {
    isConnected,
    lastEvent,
    recentEvents,
    eventCounts,
    clearEvents,
  };
}

// Hook for tracking job state transitions (for animations)
export interface JobTransition {
  jobId: number;
  queue: string;
  fromState: string;
  toState: string;
  timestamp: number;
}

export function useJobTransitions(options: UseJobEventsOptions = {}) {
  const [transitions, setTransitions] = useState<JobTransition[]>([]);
  const { recentEvents, ...rest } = useJobEvents({
    ...options,
    onEvent: (event) => {
      // Map event types to state transitions
      let toState = '';
      let fromState = '';

      switch (event.event_type) {
        case 'pushed':
          fromState = 'none';
          toState = 'waiting';
          break;
        case 'completed':
          fromState = 'active';
          toState = 'completed';
          break;
        case 'failed':
          fromState = 'active';
          toState = 'failed';
          break;
        default:
          return;
      }

      const transition: JobTransition = {
        jobId: event.job_id,
        queue: event.queue,
        fromState,
        toState,
        timestamp: event.timestamp,
      };

      setTransitions((prev) => [transition, ...prev].slice(0, 50));
      options.onEvent?.(event);
    },
  });

  const clearTransitions = useCallback(() => {
    setTransitions([]);
  }, []);

  return {
    ...rest,
    recentEvents,
    transitions,
    clearTransitions,
  };
}
