/**
 * Connection management for FlashQ client.
 *
 * This module provides the core connection layer that handles:
 * - TCP socket connections with auto-reconnect
 * - HTTP fallback for environments without raw socket support
 * - Binary (MessagePack) and JSON protocol support
 * - Request queueing during disconnection
 * - Compression for large payloads
 *
 * @module client/connection
 */
import * as net from 'net';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import type { ClientOptions, ApiResponse, RetryConfig } from '../types';
import { buildHeaders, buildHttpRequest } from './http/request';
import { parseHttpResponse } from './http/response';
import { ConnectionError, AuthenticationError, TimeoutError, parseServerError } from '../errors';
import { withRetry } from '../utils/retry';
import { Logger, type LogLevel } from '../utils/logger';
import { callHook, createHookContext, type ConnectionHookContext } from '../hooks';
import { encode } from '@msgpack/msgpack';
import {
  DEFAULT_HOST,
  DEFAULT_TCP_PORT,
  DEFAULT_HTTP_PORT,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_RECONNECT_DELAY,
  DEFAULT_MAX_RECONNECT_DELAY,
  DEFAULT_MAX_RECONNECT_ATTEMPTS,
  DEFAULT_MAX_QUEUED_REQUESTS,
  DEFAULT_COMPRESSION_THRESHOLD,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_RETRY_INITIAL_DELAY,
  DEFAULT_RETRY_MAX_DELAY,
  RECONNECT_JITTER_FACTOR,
} from '../constants';
import {
  type PendingRequest,
  RequestIdGenerator,
  JsonBufferHandler,
  BinaryBufferHandler,
} from './tcp';
import type { ConnectionState } from './reconnect';

// Re-export validation utilities for backward compatibility
export {
  MAX_JOB_DATA_SIZE,
  MAX_BATCH_SIZE,
  validateQueueName,
  validateJobDataSize,
  mapJobToPayload,
} from './validation';
export type { JobPayload } from './validation';

const gzip = promisify(zlib.gzip);

/** Request queued during disconnection */
interface QueuedRequest {
  command: Record<string, unknown>;
  customTimeout?: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Default retry configuration */
const DEFAULT_RETRY_CONFIG: Required<Omit<RetryConfig, 'onRetry'>> = {
  enabled: false,
  maxRetries: DEFAULT_RETRY_MAX_ATTEMPTS,
  initialDelay: DEFAULT_RETRY_INITIAL_DELAY,
  maxDelay: DEFAULT_RETRY_MAX_DELAY,
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
  private jsonBuffer = new JsonBufferHandler();
  private binaryBuffer = new BinaryBufferHandler();
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
  private requestIdGenerator = new RequestIdGenerator();

  constructor(options: ClientOptions = {}) {
    super();

    // Determine log level: logLevel takes precedence, then debug flag
    const logLevel: LogLevel = options.logLevel ?? (options.debug ? 'debug' : 'silent');

    this.logger = new Logger({
      level: logLevel,
      prefix: 'flashQ',
    });

    this._options = {
      host: options.host ?? DEFAULT_HOST,
      port: options.port ?? DEFAULT_TCP_PORT,
      httpPort: options.httpPort ?? DEFAULT_HTTP_PORT,
      socketPath: options.socketPath ?? '',
      token: options.token ?? '',
      timeout: options.timeout ?? DEFAULT_CONNECTION_TIMEOUT,
      useHttp: options.useHttp ?? false,
      useBinary: options.useBinary ?? false,
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
      reconnectDelay: options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY,
      maxReconnectDelay: options.maxReconnectDelay ?? DEFAULT_MAX_RECONNECT_DELAY,
      debug: options.debug ?? false,
      logLevel: logLevel,
      retry: options.retry ?? false,
      queueOnDisconnect: options.queueOnDisconnect ?? false,
      maxQueuedRequests: options.maxQueuedRequests ?? DEFAULT_MAX_QUEUED_REQUESTS,
      trackRequestIds: options.trackRequestIds ?? false,
      compression: options.compression ?? false,
      compressionThreshold: options.compressionThreshold ?? DEFAULT_COMPRESSION_THRESHOLD,
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

  /**
   * Invokes the connection hook if configured.
   *
   * Creates a ConnectionHookContext and calls the onConnection hook
   * with the appropriate event type. Hook errors are caught and logged
   * to prevent breaking the main flow.
   *
   * @param event - The connection event type
   * @param error - Error object for error events
   * @param attempt - Reconnection attempt number
   */
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

  /**
   * Schedules a reconnection attempt with exponential backoff.
   *
   * Calculates delay using: min(initialDelay * 2^attempt, maxDelay) + jitter
   * Jitter is 0-30% of base delay to prevent thundering herd.
   *
   * Emits 'reconnecting' before attempt and 'reconnected' on success.
   * On failure, recursively schedules next attempt until max reached.
   */
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
    const delay = baseDelay + Math.random() * RECONNECT_JITTER_FACTOR * baseDelay;
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

  /**
   * Sets up event handlers on the TCP socket.
   *
   * Handlers:
   * - 'data': Routes to JSON or binary buffer processor based on protocol
   * - 'close': Triggers disconnect event and schedules reconnection
   * - 'error': Emits error event and calls connection hook
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;
    this.socket.on('data', (data) => {
      if (this._options.useBinary) {
        this.binaryBuffer.append(data);
        this.processBinaryBuffer();
      } else {
        this.jsonBuffer.append(data);
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

  /**
   * Processes the JSON text buffer to extract complete responses.
   *
   * Delegates to JsonBufferHandler for line extraction, then parses
   * each complete line as JSON and passes to handleResponse.
   */
  private processBuffer(): void {
    const lines = this.jsonBuffer.extractLines();
    for (const line of lines) {
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

  /**
   * Processes the binary buffer to extract MessagePack frames.
   *
   * Delegates to BinaryBufferHandler for frame extraction and decoding,
   * then passes each decoded object to handleResponse.
   */
  private processBinaryBuffer(): void {
    try {
      const frames = this.binaryBuffer.extractFrames();
      for (const frame of frames) {
        this.handleResponse(frame);
      }
    } catch (err) {
      this.debug('Failed to decode binary response', {
        error: err instanceof Error ? err.message : err,
      });
      this.emit('parse_error', err);
    }
  }

  /**
   * Handles a parsed response from the server.
   *
   * Matches response.reqId to pending request, clears timeout,
   * and resolves/rejects the promise. Server errors are parsed
   * into typed FlashQError subclasses.
   *
   * @param response - Parsed response object with reqId
   */
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
    // Reset buffers
    this.jsonBuffer.reset();
    this.binaryBuffer.reset();
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

  /**
   * Internal send implementation without retry wrapper.
   *
   * Routes to queueRequest if disconnecting with queue enabled,
   * waits for reconnection if in progress, then delegates to
   * sendTcp or sendHttp based on protocol configuration.
   *
   * @param command - Command object to send
   * @param customTimeout - Optional timeout override
   * @returns Promise resolving to response
   */
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

  /**
   * Waits for an in-progress reconnection to complete.
   *
   * Listens for 'reconnected' or 'reconnect_failed' events.
   * Times out after options.timeout milliseconds.
   *
   * @returns Promise that resolves when reconnected
   * @throws ConnectionError on timeout or reconnection failure
   */
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

  /**
   * Queues a request for later execution after reconnection.
   *
   * Used when queueOnDisconnect is enabled and connection is lost.
   * Requests are stored and replayed in order when reconnected.
   *
   * @param command - Command to queue
   * @param customTimeout - Optional timeout for when request is eventually sent
   * @returns Promise that resolves when request completes after reconnection
   * @throws ConnectionError if queue is full
   */
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

  /**
   * Processes all queued requests after successful reconnection.
   *
   * Sends each queued request in order, resolving or rejecting
   * the original promises. Clears the queue before processing
   * to handle any new requests that may be queued during replay.
   */
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

  /**
   * Sends a command over the TCP socket.
   *
   * Handles request ID generation, optional compression,
   * timeout management, and protocol serialization (JSON or MessagePack).
   *
   * @param command - Command object to send
   * @param customTimeout - Optional timeout override in milliseconds
   * @returns Promise resolving to typed response
   * @throws ConnectionError if not connected
   * @throws TimeoutError if request times out
   */
  private async sendTcp<T>(command: Record<string, unknown>, customTimeout?: number): Promise<T> {
    if (!this.socket || this.connectionState !== 'connected') {
      throw new ConnectionError('Not connected', 'NOT_CONNECTED');
    }

    const reqId = this.requestIdGenerator.generate();
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

  /**
   * Sends a command via HTTP REST API.
   *
   * Converts the command to appropriate HTTP method and URL,
   * handles authentication headers, and parses the JSON response.
   *
   * @param command - Command object to convert to HTTP request
   * @param customTimeout - Optional timeout override in milliseconds
   * @returns Promise resolving to typed response
   * @throws TimeoutError if request times out
   */
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
