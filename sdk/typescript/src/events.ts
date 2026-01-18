/**
 * flashQ Events - Real-time event subscriptions
 *
 * Supports:
 * - SSE (Server-Sent Events) - Unidirectional, auto-reconnect
 * - WebSocket - Bidirectional, low latency
 *
 * @example
 * ```typescript
 * import { EventSubscriber } from 'flashq';
 *
 * const events = new EventSubscriber({ host: 'localhost', httpPort: 6790 });
 *
 * events.on('completed', (event) => {
 *   console.log(`Job ${event.jobId} completed`);
 * });
 *
 * events.on('failed', (event) => {
 *   console.log(`Job ${event.jobId} failed: ${event.error}`);
 * });
 *
 * await events.connect();
 * ```
 */

import { EventEmitter } from 'events';

// ============== Types ==============

export type EventType = 'pushed' | 'completed' | 'failed' | 'progress' | 'timeout';

export interface JobEvent {
  /** Event type */
  eventType: EventType;
  /** Queue name */
  queue: string;
  /** Job ID */
  jobId: number;
  /** Event timestamp (ms) */
  timestamp: number;
  /** Job data (for pushed events) */
  data?: unknown;
  /** Error message (for failed events) */
  error?: string;
  /** Progress percentage (for progress events) */
  progress?: number;
}

export interface EventSubscriberOptions {
  /** Server host (default: localhost) */
  host?: string;
  /** HTTP port (default: 6790) */
  httpPort?: number;
  /** Authentication token */
  token?: string;
  /** Filter to specific queue */
  queue?: string;
  /** Connection type: 'sse' or 'websocket' (default: 'sse') */
  type?: 'sse' | 'websocket';
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Max reconnect attempts (default: 10, 0 = infinite) */
  maxReconnectAttempts?: number;
}

export interface EventSubscriberEvents {
  /** Emitted when connected */
  connected: () => void;
  /** Emitted when disconnected */
  disconnected: () => void;
  /** Emitted on reconnect attempt */
  reconnecting: (attempt: number) => void;
  /** Emitted on error */
  error: (error: Error) => void;
  /** Emitted for all job events */
  event: (event: JobEvent) => void;
  /** Emitted when a job is pushed */
  pushed: (event: JobEvent) => void;
  /** Emitted when a job completes */
  completed: (event: JobEvent) => void;
  /** Emitted when a job fails */
  failed: (event: JobEvent) => void;
  /** Emitted on job progress update */
  progress: (event: JobEvent) => void;
  /** Emitted when a job times out */
  timeout: (event: JobEvent) => void;
}

// ============== EventSubscriber ==============

/**
 * Real-time event subscriber for flashQ
 *
 * @example
 * ```typescript
 * // SSE (default, auto-reconnect)
 * const events = new EventSubscriber({
 *   host: 'localhost',
 *   httpPort: 6790,
 *   queue: 'emails', // Optional: filter to one queue
 * });
 *
 * events.on('completed', (e) => console.log(`Job ${e.jobId} done!`));
 * events.on('failed', (e) => console.log(`Job ${e.jobId} failed: ${e.error}`));
 *
 * await events.connect();
 *
 * // Later...
 * events.close();
 * ```
 *
 * @example
 * ```typescript
 * // WebSocket
 * const events = new EventSubscriber({
 *   type: 'websocket',
 *   token: 'your-auth-token',
 * });
 *
 * await events.connect();
 * ```
 */
export class EventSubscriber extends EventEmitter {
  private options: Required<EventSubscriberOptions>;
  private eventSource: EventSource | null = null;
  private websocket: WebSocket | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  // Store handlers for proper cleanup
  private sseHandlers: Map<string, (e: Event) => void> = new Map();
  private wsMessageHandler: ((e: MessageEvent) => void) | null = null;

  constructor(options: EventSubscriberOptions = {}) {
    super();
    this.options = {
      host: options.host ?? 'localhost',
      httpPort: options.httpPort ?? 6790,
      token: options.token ?? '',
      queue: options.queue ?? '',
      type: options.type ?? 'sse',
      autoReconnect: options.autoReconnect ?? true,
      reconnectDelay: options.reconnectDelay ?? 1000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
    };
  }

  // Typed event emitter overrides
  on<K extends keyof EventSubscriberEvents>(
    event: K,
    listener: EventSubscriberEvents[K]
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof EventSubscriberEvents>(
    event: K,
    listener: EventSubscriberEvents[K]
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof EventSubscriberEvents>(
    event: K,
    ...args: Parameters<EventSubscriberEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Connect to the event stream
   */
  async connect(): Promise<void> {
    this.closed = false;
    this.reconnectAttempts = 0;

    if (this.options.type === 'websocket') {
      await this.connectWebSocket();
    } else {
      await this.connectSSE();
    }
  }

  /**
   * Close the connection
   */
  close(): void {
    this.closed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Clean up SSE handlers to prevent memory leak
    if (this.eventSource) {
      for (const [eventType, handler] of this.sseHandlers) {
        this.eventSource.removeEventListener(eventType, handler);
      }
      this.sseHandlers.clear();
      this.eventSource.close();
      this.eventSource = null;
    }

    // Clean up WebSocket
    if (this.websocket) {
      this.wsMessageHandler = null;
      this.websocket.close();
      this.websocket = null;
    }

    if (this.connected) {
      this.connected = false;
      this.emit('disconnected');
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============== SSE ==============

  private async connectSSE(): Promise<void> {
    return new Promise((resolve, reject) => {
      const baseUrl = `http://${this.options.host}:${this.options.httpPort}`;
      const url = this.options.queue
        ? `${baseUrl}/queues/${this.options.queue}/events`
        : `${baseUrl}/events`;

      try {
        this.eventSource = new EventSource(url);

        this.eventSource.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        };

        this.eventSource.onerror = (error) => {
          const wasConnected = this.connected;
          this.connected = false;

          if (wasConnected) {
            this.emit('disconnected');
          }

          if (!this.closed && this.options.autoReconnect) {
            this.scheduleReconnect();
          } else if (!wasConnected) {
            reject(new Error('Failed to connect to SSE'));
          }
        };

        // Clear any existing handlers
        this.sseHandlers.clear();

        // Listen for specific event types
        const eventTypes: EventType[] = ['pushed', 'completed', 'failed', 'progress', 'timeout'];

        for (const eventType of eventTypes) {
          const handler = (e: Event) => {
            try {
              const messageEvent = e as MessageEvent;
              const rawEvent = JSON.parse(messageEvent.data);
              const event = this.normalizeEvent(rawEvent);
              this.emit('event', event);
              this.emit(eventType, event);
            } catch {
              // Ignore parse errors
            }
          };
          this.sseHandlers.set(eventType, handler);
          this.eventSource.addEventListener(eventType, handler);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  // ============== WebSocket ==============

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = this.options.host === 'localhost' ? 'ws' : 'wss';
      let url = `${protocol}://${this.options.host}:${this.options.httpPort}`;

      if (this.options.queue) {
        url += `/ws/${this.options.queue}`;
      } else {
        url += '/ws';
      }

      if (this.options.token) {
        url += `?token=${encodeURIComponent(this.options.token)}`;
      }

      try {
        this.websocket = new WebSocket(url);

        this.websocket.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        };

        this.websocket.onclose = () => {
          const wasConnected = this.connected;
          this.connected = false;

          if (wasConnected) {
            this.emit('disconnected');
          }

          if (!this.closed && this.options.autoReconnect) {
            this.scheduleReconnect();
          }
        };

        this.websocket.onerror = () => {
          this.emit('error', new Error('WebSocket error'));
          if (!this.connected) {
            reject(new Error('Failed to connect to WebSocket'));
          }
        };

        // Store message handler for cleanup
        this.wsMessageHandler = (e: MessageEvent) => {
          try {
            const rawEvent = JSON.parse(e.data);
            const event = this.normalizeEvent(rawEvent);
            this.emit('event', event);
            this.emit(event.eventType, event);
          } catch {
            // Ignore parse errors
          }
        };
        this.websocket.onmessage = this.wsMessageHandler;
      } catch (error) {
        reject(error);
      }
    });
  }

  // ============== Helpers ==============

  private normalizeEvent(raw: Record<string, unknown>): JobEvent {
    return {
      eventType: (raw.event_type ?? raw.eventType) as EventType,
      queue: raw.queue as string,
      jobId: (raw.job_id ?? raw.jobId) as number,
      timestamp: raw.timestamp as number,
      data: raw.data,
      error: raw.error as string | undefined,
      progress: raw.progress as number | undefined,
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;

    const maxAttempts = this.options.maxReconnectAttempts;
    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      this.emit('error', new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    this.emit('reconnecting', this.reconnectAttempts);

    // Exponential backoff with jitter
    const delay = Math.min(
      this.options.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1) +
        Math.random() * 1000,
      30000
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // Error will trigger another reconnect
      });
    }, delay);
  }
}

// ============== Convenience Functions ==============

/**
 * Create an SSE event subscriber
 *
 * @example
 * ```typescript
 * const events = createEventSubscriber({ queue: 'emails' });
 * events.on('completed', (e) => console.log(e));
 * await events.connect();
 * ```
 */
export function createEventSubscriber(
  options?: EventSubscriberOptions
): EventSubscriber {
  return new EventSubscriber({ ...options, type: 'sse' });
}

/**
 * Create a WebSocket event subscriber
 *
 * @example
 * ```typescript
 * const events = createWebSocketSubscriber({ token: 'xxx' });
 * events.on('completed', (e) => console.log(e));
 * await events.connect();
 * ```
 */
export function createWebSocketSubscriber(
  options?: EventSubscriberOptions
): EventSubscriber {
  return new EventSubscriber({ ...options, type: 'websocket' });
}

/**
 * Subscribe to events with a simple callback
 *
 * @example
 * ```typescript
 * const unsubscribe = await subscribeToEvents(
 *   { queue: 'emails' },
 *   (event) => console.log(event)
 * );
 *
 * // Later...
 * unsubscribe();
 * ```
 */
export async function subscribeToEvents(
  options: EventSubscriberOptions,
  callback: (event: JobEvent) => void
): Promise<() => void> {
  const subscriber = new EventSubscriber(options);
  subscriber.on('event', callback);
  await subscriber.connect();
  return () => subscriber.close();
}

export default EventSubscriber;
