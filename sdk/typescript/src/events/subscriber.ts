/**
 * EventSubscriber - Real-time event subscriptions for flashQ.
 * Supports SSE (Server-Sent Events) and WebSocket connections.
 */
import { EventEmitter } from 'events';
import type {
  EventType,
  JobEvent,
  EventSubscriberOptions,
  EventSubscriberEvents,
} from './types';

export class EventSubscriber extends EventEmitter {
  private options: Required<EventSubscriberOptions>;
  private eventSource: EventSource | null = null;
  private websocket: WebSocket | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
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

  on<K extends keyof EventSubscriberEvents>(event: K, listener: EventSubscriberEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof EventSubscriberEvents>(event: K, listener: EventSubscriberEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof EventSubscriberEvents>(event: K, ...args: Parameters<EventSubscriberEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  async connect(): Promise<void> {
    this.closed = false;
    this.reconnectAttempts = 0;
    if (this.options.type === 'websocket') {
      await this.connectWebSocket();
    } else {
      await this.connectSSE();
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      for (const [eventType, handler] of this.sseHandlers) {
        this.eventSource.removeEventListener(eventType, handler);
      }
      this.sseHandlers.clear();
      this.eventSource.close();
      this.eventSource = null;
    }
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

  isConnected(): boolean {
    return this.connected;
  }

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

        this.eventSource.onerror = () => {
          const wasConnected = this.connected;
          this.connected = false;
          if (wasConnected) this.emit('disconnected');
          if (!this.closed && this.options.autoReconnect) {
            this.scheduleReconnect();
          } else if (!wasConnected) {
            reject(new Error('Failed to connect to SSE'));
          }
        };

        this.sseHandlers.clear();
        const eventTypes: EventType[] = ['pushed', 'completed', 'failed', 'progress', 'timeout'];

        for (const eventType of eventTypes) {
          const handler = (e: Event) => {
            try {
              const messageEvent = e as MessageEvent;
              const rawEvent = JSON.parse(messageEvent.data);
              const event = this.normalizeEvent(rawEvent);
              this.emit('event', event);
              this.emit(eventType, event);
            } catch { /* ignore */ }
          };
          this.sseHandlers.set(eventType, handler);
          this.eventSource.addEventListener(eventType, handler);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = this.options.host === 'localhost' ? 'ws' : 'wss';
      let url = `${protocol}://${this.options.host}:${this.options.httpPort}`;
      url += this.options.queue ? `/ws/${this.options.queue}` : '/ws';
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
          if (wasConnected) this.emit('disconnected');
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

        this.wsMessageHandler = (e: MessageEvent) => {
          try {
            const rawEvent = JSON.parse(e.data);
            const event = this.normalizeEvent(rawEvent);
            this.emit('event', event);
            this.emit(event.eventType, event);
          } catch { /* ignore */ }
        };
        this.websocket.onmessage = this.wsMessageHandler;
      } catch (error) {
        reject(error);
      }
    });
  }

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

    const delay = Math.min(
      this.options.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1) + Math.random() * 1000,
      30000
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => { /* reconnect will trigger again */ });
    }, delay);
  }
}
