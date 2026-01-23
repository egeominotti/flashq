/**
 * Connection management for FlashQ client.
 */
import * as net from 'net';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { encode, decode } from '@msgpack/msgpack';
import type { ClientOptions, ApiResponse, RetryConfig } from '../types';
import { buildHeaders, buildHttpRequest } from './http/request';
import { parseHttpResponse } from './http/response';
import {
  ConnectionError,
  AuthenticationError,
  TimeoutError,
  ValidationError,
  parseServerError,
} from '../errors';
import { withRetry } from '../utils/retry';
import { Logger, type LogLevel } from '../utils/logger';
import { callHook, createHookContext, type ConnectionHookContext } from '../hooks';

const gzip = promisify(zlib.gzip);

export const MAX_JOB_DATA_SIZE = 1024 * 1024;
export const MAX_BATCH_SIZE = 1000;
const QUEUE_NAME_REGEX = /^[a-zA-Z0-9_.-]{1,256}$/;
let requestIdCounter = 0;
const generateReqId = (): string => `r${++requestIdCounter}`;

export function validateQueueName(queue: string): void {
  if (!queue || typeof queue !== 'string') {
    throw new ValidationError('Queue name is required', 'queue');
  }
  if (!QUEUE_NAME_REGEX.test(queue)) {
    throw new ValidationError(
      `Invalid queue name: "${queue}". Must be alphanumeric, _, -, . (1-256 chars)`,
      'queue'
    );
  }
}

export function validateJobDataSize(data: unknown): void {
  const size = JSON.stringify(data).length;
  if (size > MAX_JOB_DATA_SIZE) {
    throw new ValidationError(
      `Job data size (${size} bytes) exceeds max (${MAX_JOB_DATA_SIZE} bytes)`,
      'data'
    );
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedRequest {
  command: Record<string, unknown>;
  customTimeout?: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

const DEFAULT_RETRY_CONFIG: Required<Omit<RetryConfig, 'onRetry'>> = {
  enabled: false,
  maxRetries: 3,
  initialDelay: 100,
  maxDelay: 5000,
};

/** Client options with required fields except hooks */
type ResolvedClientOptions = Required<Omit<ClientOptions, 'hooks'>> & {
  hooks?: ClientOptions['hooks'];
};

export class FlashQConnection extends EventEmitter {
  protected _options: ResolvedClientOptions;
  protected logger: Logger;
  private socket: net.Socket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private authenticated = false;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private bufferChunks: string[] = [];
  private bufferRemainder = '';
  private binaryBuffer: Buffer = Buffer.alloc(0);
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private retryConfig: Required<Omit<RetryConfig, 'onRetry'>> & {
    onRetry?: RetryConfig['onRetry'];
  };
  private queueOnDisconnect: boolean;
  private maxQueuedRequests: number;
  private requestQueue: QueuedRequest[] = [];
  private trackRequestIds: boolean;
  private compression: boolean;
  private compressionThreshold: number;

  constructor(options: ClientOptions = {}) {
    super();

    // Determine log level: logLevel takes precedence, then debug flag
    const logLevel: LogLevel = options.logLevel ?? (options.debug ? 'debug' : 'silent');

    this.logger = new Logger({
      level: logLevel,
      prefix: 'flashQ',
    });

    this._options = {
      host: options.host ?? 'localhost',
      port: options.port ?? 6789,
      httpPort: options.httpPort ?? 6790,
      socketPath: options.socketPath ?? '',
      token: options.token ?? '',
      timeout: options.timeout ?? 5000,
      useHttp: options.useHttp ?? false,
      useBinary: options.useBinary ?? false,
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      reconnectDelay: options.reconnectDelay ?? 1000,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      debug: options.debug ?? false,
      logLevel: logLevel,
      retry: options.retry ?? false,
      queueOnDisconnect: options.queueOnDisconnect ?? false,
      maxQueuedRequests: options.maxQueuedRequests ?? 100,
      trackRequestIds: options.trackRequestIds ?? false,
      compression: options.compression ?? false,
      compressionThreshold: options.compressionThreshold ?? 1024,
      hooks: options.hooks,
    };

    // Parse retry config
    if (options.retry === true) {
      this.retryConfig = { ...DEFAULT_RETRY_CONFIG, enabled: true };
    } else if (options.retry && typeof options.retry === 'object') {
      this.retryConfig = {
        enabled: options.retry.enabled ?? true,
        maxRetries: options.retry.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
        initialDelay: options.retry.initialDelay ?? DEFAULT_RETRY_CONFIG.initialDelay,
        maxDelay: options.retry.maxDelay ?? DEFAULT_RETRY_CONFIG.maxDelay,
        onRetry: options.retry.onRetry,
      };
    } else {
      this.retryConfig = { ...DEFAULT_RETRY_CONFIG };
    }

    this.queueOnDisconnect = options.queueOnDisconnect ?? false;
    this.maxQueuedRequests = options.maxQueuedRequests ?? 100;
    this.trackRequestIds = options.trackRequestIds ?? false;
    this.compression = options.compression ?? false;
    this.compressionThreshold = options.compressionThreshold ?? 1024;

    if (this._options.useHttp) this.connectionState = 'connected';
  }

  /** @deprecated Use logger.debug() instead */
  protected debug(message: string, data?: unknown): void {
    this.logger.debug(message, data);
  }

  /** Call connection hook */
  private callConnectionHook(
    event: 'connect' | 'disconnect' | 'reconnecting' | 'reconnected' | 'error',
    error?: Error,
    attempt?: number
  ): void {
    const hooks = this._options.hooks;
    if (!hooks?.onConnection) return;
    const ctx = createHookContext<ConnectionHookContext>({
      host: this._options.host,
      port: this._options.port,
      event,
      error,
      attempt,
    });
    callHook(hooks.onConnection, ctx);
  }

  get options(): ResolvedClientOptions {
    return this._options;
  }

  async connect(): Promise<void> {
    if (this._options.useHttp) {
      this.connectionState = 'connected';
      return;
    }
    if (this.connectionState === 'connected') return;
    if (this.connectionState === 'connecting') {
      return new Promise((resolve, reject) => {
        const onConnect = () => {
          this.removeListener('error', onError);
          resolve();
        };
        const onError = (err: Error) => {
          this.removeListener('connect', onConnect);
          reject(err);
        };
        this.once('connect', onConnect);
        this.once('error', onError);
      });
    }
    this.connectionState = 'connecting';
    this.manualClose = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.connectionState = 'disconnected';
        reject(new ConnectionError('Connection timeout', 'CONNECTION_TIMEOUT'));
      }, this._options.timeout);

      const opts = this._options.socketPath
        ? { path: this._options.socketPath }
        : { host: this._options.host, port: this._options.port };

      this.socket = net.createConnection(opts, async () => {
        clearTimeout(timeout);
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.setupSocketHandlers();
        this.logger.info('Connected to server', opts);
        if (this._options.token) {
          try {
            await this.auth(this._options.token);
            this.authenticated = true;
            this.logger.info('Authenticated successfully');
          } catch (err) {
            this.logger.error('Authentication failed', err);
            this.socket?.destroy();
            this.connectionState = 'disconnected';
            reject(err);
            return;
          }
        }
        this.emit('connect');
        this.callConnectionHook('connect');
        resolve();
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        if (this.connectionState === 'connecting') {
          this.connectionState = 'disconnected';
          reject(err);
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.manualClose || !this._options.autoReconnect) return;
    if (
      this._options.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this._options.maxReconnectAttempts
    ) {
      this.emit(
        'reconnect_failed',
        new ConnectionError('Max reconnection attempts reached', 'RECONNECTION_FAILED')
      );
      return;
    }
    this.connectionState = 'reconnecting';
    this.reconnectAttempts++;
    const baseDelay = Math.min(
      this._options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this._options.maxReconnectDelay
    );
    const delay = baseDelay + Math.random() * 0.3 * baseDelay;
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });
    this.callConnectionHook('reconnecting', undefined, this.reconnectAttempts);
    this.reconnectTimer = setTimeout(async () => {
      try {
        this.connectionState = 'disconnected';
        await this.connect();
        this.emit('reconnected');
        this.callConnectionHook('reconnected');
        // Process queued requests after successful reconnection
        if (this.queueOnDisconnect) {
          await this.processRequestQueue();
        }
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return;
    this.socket.on('data', (data) => {
      if (this._options.useBinary) {
        this.binaryBuffer = Buffer.concat([this.binaryBuffer, data]);
        this.processBinaryBuffer();
      } else {
        this.bufferChunks.push(data.toString());
        this.processBuffer();
      }
    });
    this.socket.on('close', () => {
      const wasConnected = this.connectionState === 'connected';
      this.connectionState = 'disconnected';
      this.authenticated = false;
      this.emit('disconnect');
      this.callConnectionHook('disconnect');
      if (wasConnected && !this.manualClose && this._options.autoReconnect) {
        this.scheduleReconnect();
      }
    });
    this.socket.on('error', (err) => {
      this.emit('error', err);
      this.callConnectionHook('error', err);
    });
  }

  private processBuffer(): void {
    // Join chunks only when processing (more efficient than += on each chunk)
    const fullBuffer = this.bufferRemainder + this.bufferChunks.join('');
    this.bufferChunks.length = 0; // Clear array without reallocating
    const lines = fullBuffer.split('\n');
    this.bufferRemainder = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.handleResponse(JSON.parse(line));
      } catch (err) {
        this.debug('Failed to parse JSON response', {
          line,
          error: err instanceof Error ? err.message : err,
        });
        this.emit('parse_error', err, line);
      }
    }
  }

  private processBinaryBuffer(): void {
    while (this.binaryBuffer.length >= 4) {
      const len = this.binaryBuffer.readUInt32BE(0);
      if (this.binaryBuffer.length < 4 + len) break;
      const frameData = this.binaryBuffer.subarray(4, 4 + len);
      this.binaryBuffer = this.binaryBuffer.subarray(4 + len);
      try {
        this.handleResponse(decode(frameData) as Record<string, unknown>);
      } catch (err) {
        this.debug('Failed to decode binary response', {
          error: err instanceof Error ? err.message : err,
        });
        this.emit('parse_error', err, frameData);
      }
    }
  }

  private handleResponse(response: Record<string, unknown>): void {
    if (!response.reqId) {
      this.logger.warn('Received response without reqId', response);
      return;
    }
    const pending = this.pendingRequests.get(response.reqId as string);
    if (!pending) {
      this.logger.warn('Received response for unknown request', { reqId: response.reqId });
      return;
    }
    this.pendingRequests.delete(response.reqId as string);
    clearTimeout(pending.timer);
    if (response.ok === false && response.error) {
      this.logger.debug('Request failed', { reqId: response.reqId, error: response.error });
      pending.reject(
        parseServerError(response.error as string, response.code as string | undefined)
      );
    } else {
      this.logger.trace('Request succeeded', { reqId: response.reqId });
      pending.resolve(response);
    }
  }

  async close(): Promise<void> {
    this.manualClose = true;
    this.connectionState = 'closed';
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Reject pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new ConnectionError('Connection closed', 'CONNECTION_CLOSED'));
    }
    this.pendingRequests.clear();
    // Reject queued requests
    for (const req of this.requestQueue) {
      req.reject(new ConnectionError('Connection closed', 'CONNECTION_CLOSED'));
    }
    this.requestQueue = [];
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /** Get number of queued requests */
  getQueuedRequestCount(): number {
    return this.requestQueue.length;
  }

  isConnected(): boolean {
    return this.connectionState === 'connected';
  }
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  async ping(): Promise<boolean> {
    try {
      const response = await this.send<{ ok: boolean; pong?: boolean }>({ cmd: 'PING' });
      return response.ok || response.pong === true;
    } catch {
      return false;
    }
  }

  async auth(token: string): Promise<void> {
    const response = await this.send<{ ok: boolean }>({ cmd: 'AUTH', token });
    if (!response.ok) throw new AuthenticationError();
    this._options.token = token;
    this.authenticated = true;
  }

  async send<T>(command: Record<string, unknown>, customTimeout?: number): Promise<T> {
    // If retry is enabled, wrap the actual send with retry logic
    if (this.retryConfig.enabled) {
      return withRetry(() => this.doSend<T>(command, customTimeout), {
        maxRetries: this.retryConfig.maxRetries,
        initialDelay: this.retryConfig.initialDelay,
        maxDelay: this.retryConfig.maxDelay,
        onRetry: (error, attempt, delay) => {
          this.debug('Retrying request', {
            cmd: command.cmd,
            attempt,
            delay,
            error: error.message,
          });
          this.retryConfig.onRetry?.(error, attempt, delay);
        },
      });
    }
    return this.doSend<T>(command, customTimeout);
  }

  private async doSend<T>(command: Record<string, unknown>, customTimeout?: number): Promise<T> {
    // Queue request if disconnected and queueOnDisconnect is enabled
    if (this.queueOnDisconnect && this.connectionState === 'reconnecting') {
      return this.queueRequest<T>(command, customTimeout);
    }

    if (this.connectionState === 'reconnecting') {
      await this.waitForReconnection();
    }
    if (this.connectionState !== 'connected') await this.connect();
    return this._options.useHttp
      ? this.sendHttp<T>(command, customTimeout)
      : this.sendTcp<T>(command, customTimeout);
  }

  private async waitForReconnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('reconnected', onReconnect);
        this.removeListener('reconnect_failed', onFailed);
        reject(new ConnectionError('Reconnection timeout', 'RECONNECTION_FAILED'));
      }, this._options.timeout);
      const onReconnect = () => {
        clearTimeout(timeout);
        this.removeListener('reconnect_failed', onFailed);
        resolve();
      };
      const onFailed = (err: Error) => {
        clearTimeout(timeout);
        this.removeListener('reconnected', onReconnect);
        reject(err);
      };
      this.once('reconnected', onReconnect);
      this.once('reconnect_failed', onFailed);
    });
  }

  private queueRequest<T>(command: Record<string, unknown>, customTimeout?: number): Promise<T> {
    if (this.requestQueue.length >= this.maxQueuedRequests) {
      return Promise.reject(
        new ConnectionError(`Request queue full (max: ${this.maxQueuedRequests})`, 'QUEUE_FULL')
      );
    }
    this.debug('Queueing request', { cmd: command.cmd, queueSize: this.requestQueue.length + 1 });
    return new Promise<T>((resolve, reject) => {
      this.requestQueue.push({
        command,
        customTimeout,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
  }

  private async processRequestQueue(): Promise<void> {
    if (this.requestQueue.length === 0) return;
    this.debug('Processing queued requests', { count: this.requestQueue.length });
    const queue = [...this.requestQueue];
    this.requestQueue = [];
    for (const req of queue) {
      try {
        const result = await this.doSend(req.command, req.customTimeout);
        req.resolve(result);
      } catch (error) {
        req.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async sendTcp<T>(command: Record<string, unknown>, customTimeout?: number): Promise<T> {
    if (!this.socket || this.connectionState !== 'connected') {
      throw new ConnectionError('Not connected', 'NOT_CONNECTED');
    }

    const reqId = generateReqId();
    const timeoutMs = customTimeout ?? this._options.timeout;

    // Set request ID for logger correlation if tracking is enabled
    if (this.trackRequestIds) {
      this.logger.setRequestId(reqId);
    }

    this.logger.trace('Preparing request', { reqId, cmd: command.cmd });

    // Apply compression if enabled and payload is large enough
    let payload = command;
    let compressed = false;
    if (this.compression && !this._options.useBinary) {
      const jsonStr = JSON.stringify(command);
      if (jsonStr.length >= this.compressionThreshold) {
        try {
          const compressedData = await gzip(Buffer.from(jsonStr));
          payload = { ...command, _compressed: compressedData.toString('base64') };
          compressed = true;
          this.logger.trace('Payload compressed', {
            reqId,
            original: jsonStr.length,
            compressed: compressedData.length,
          });
        } catch (err) {
          this.logger.warn('Compression failed, sending uncompressed', { reqId, error: err });
        }
      }
    }

    return new Promise((resolve, reject) => {
      this.logger.debug('Sending command', {
        reqId,
        cmd: command.cmd,
        timeout: timeoutMs,
        compressed,
      });

      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        if (this.trackRequestIds) this.logger.clearRequestId();
        this.logger.warn('Request timeout', { reqId, cmd: command.cmd, timeout: timeoutMs });
        reject(new TimeoutError(`Request timeout for ${command.cmd}`, timeoutMs));
      }, timeoutMs);

      this.pendingRequests.set(reqId, {
        resolve: (value) => {
          if (this.trackRequestIds) this.logger.clearRequestId();
          resolve(value as T);
        },
        reject: (err) => {
          if (this.trackRequestIds) this.logger.clearRequestId();
          reject(err);
        },
        timer,
      });

      if (this._options.useBinary) {
        const encoded = encode({ ...payload, reqId });
        const frame = Buffer.alloc(4 + encoded.length);
        frame.writeUInt32BE(encoded.length, 0);
        frame.set(encoded, 4);
        this.socket!.write(frame);
      } else {
        this.socket!.write(JSON.stringify({ ...payload, reqId }) + '\n');
      }

      this.logger.trace('Command sent', { reqId });
    });
  }

  private async sendHttp<T>(command: Record<string, unknown>, customTimeout?: number): Promise<T> {
    const { cmd, ...params } = command;
    const baseUrl = `http://${this._options.host}:${this._options.httpPort}`;
    const timeout = customTimeout ?? this._options.timeout;
    const headers = buildHeaders(this._options.token);
    const req = buildHttpRequest(baseUrl, cmd as string, params);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers,
        body: req.body,
        signal: controller.signal,
      });
      const json = (await res.json()) as ApiResponse;
      return parseHttpResponse(cmd as string, json) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError('HTTP request timeout', timeout);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
