/**
 * Connection management for FlashQ client.
 */
import * as net from 'net';
import { EventEmitter } from 'events';
import { encode, decode } from '@msgpack/msgpack';
import type { ClientOptions, ApiResponse } from '../types';
import { buildHeaders, buildHttpRequest } from './http/request';
import { parseHttpResponse } from './http/response';

export const MAX_JOB_DATA_SIZE = 1024 * 1024;
export const MAX_BATCH_SIZE = 1000;
const QUEUE_NAME_REGEX = /^[a-zA-Z0-9_.-]{1,256}$/;
let requestIdCounter = 0;
const generateReqId = (): string => `r${++requestIdCounter}`;

export function validateQueueName(queue: string): void {
  if (!queue || typeof queue !== 'string') throw new Error('Queue name is required');
  if (!QUEUE_NAME_REGEX.test(queue)) {
    throw new Error(`Invalid queue name: "${queue}". Must be alphanumeric, _, -, . (1-256 chars)`);
  }
}

export function validateJobDataSize(data: unknown): void {
  const size = JSON.stringify(data).length;
  if (size > MAX_JOB_DATA_SIZE) {
    throw new Error(`Job data size (${size} bytes) exceeds max (${MAX_JOB_DATA_SIZE} bytes)`);
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export class FlashQConnection extends EventEmitter {
  protected _options: Required<ClientOptions>;
  private socket: net.Socket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private authenticated = false;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private buffer = '';
  private binaryBuffer: Buffer = Buffer.alloc(0);
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;

  constructor(options: ClientOptions = {}) {
    super();
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
    };
    if (this._options.useHttp) this.connectionState = 'connected';
  }

  get options(): Required<ClientOptions> { return this._options; }

  async connect(): Promise<void> {
    if (this._options.useHttp) { this.connectionState = 'connected'; return; }
    if (this.connectionState === 'connected') return;
    if (this.connectionState === 'connecting') {
      return new Promise((resolve, reject) => {
        const onConnect = () => { this.removeListener('error', onError); resolve(); };
        const onError = (err: Error) => { this.removeListener('connect', onConnect); reject(err); };
        this.once('connect', onConnect);
        this.once('error', onError);
      });
    }
    this.connectionState = 'connecting';
    this.manualClose = false;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.connectionState = 'disconnected';
        reject(new Error('Connection timeout'));
      }, this._options.timeout);

      const opts = this._options.socketPath
        ? { path: this._options.socketPath }
        : { host: this._options.host, port: this._options.port };

      this.socket = net.createConnection(opts, async () => {
        clearTimeout(timeout);
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.setupSocketHandlers();
        if (this._options.token) {
          try {
            await this.auth(this._options.token);
            this.authenticated = true;
          } catch (err) {
            this.socket?.destroy();
            this.connectionState = 'disconnected';
            reject(err);
            return;
          }
        }
        this.emit('connect');
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
    if (this._options.maxReconnectAttempts > 0 &&
        this.reconnectAttempts >= this._options.maxReconnectAttempts) {
      this.emit('reconnect_failed', new Error('Max reconnection attempts reached'));
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
    this.reconnectTimer = setTimeout(async () => {
      try {
        this.connectionState = 'disconnected';
        await this.connect();
        this.emit('reconnected');
      } catch { this.scheduleReconnect(); }
    }, delay);
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return;
    this.socket.on('data', (data) => {
      if (this._options.useBinary) {
        this.binaryBuffer = Buffer.concat([this.binaryBuffer, data]);
        this.processBinaryBuffer();
      } else {
        this.buffer += data.toString();
        this.processBuffer();
      }
    });
    this.socket.on('close', () => {
      const wasConnected = this.connectionState === 'connected';
      this.connectionState = 'disconnected';
      this.authenticated = false;
      this.emit('disconnect');
      if (wasConnected && !this.manualClose && this._options.autoReconnect) {
        this.scheduleReconnect();
      }
    });
    this.socket.on('error', (err) => this.emit('error', err));
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { this.handleResponse(JSON.parse(line)); } catch { /* ignore */ }
    }
  }

  private processBinaryBuffer(): void {
    while (this.binaryBuffer.length >= 4) {
      const len = this.binaryBuffer.readUInt32BE(0);
      if (this.binaryBuffer.length < 4 + len) break;
      const frameData = this.binaryBuffer.subarray(4, 4 + len);
      this.binaryBuffer = this.binaryBuffer.subarray(4 + len);
      try { this.handleResponse(decode(frameData) as Record<string, unknown>); } catch { /* ignore */ }
    }
  }

  private handleResponse(response: Record<string, unknown>): void {
    if (!response.reqId) return;
    const pending = this.pendingRequests.get(response.reqId as string);
    if (!pending) return;
    this.pendingRequests.delete(response.reqId as string);
    clearTimeout(pending.timer);
    if (response.ok === false && response.error) pending.reject(new Error(response.error as string));
    else pending.resolve(response);
  }

  async close(): Promise<void> {
    this.manualClose = true;
    this.connectionState = 'closed';
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
    if (this.socket) { this.socket.destroy(); this.socket = null; }
  }

  isConnected(): boolean { return this.connectionState === 'connected'; }
  getConnectionState(): ConnectionState { return this.connectionState; }

  async ping(): Promise<boolean> {
    try {
      const response = await this.send<{ ok: boolean; pong?: boolean }>({ cmd: 'PING' });
      return response.ok || response.pong === true;
    } catch { return false; }
  }

  async auth(token: string): Promise<void> {
    const response = await this.send<{ ok: boolean }>({ cmd: 'AUTH', token });
    if (!response.ok) throw new Error('Authentication failed');
    this._options.token = token;
    this.authenticated = true;
  }

  async send<T>(command: Record<string, unknown>, customTimeout?: number): Promise<T> {
    if (this.connectionState === 'reconnecting') {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.removeListener('reconnected', onReconnect);
          this.removeListener('reconnect_failed', onFailed);
          reject(new Error('Reconnection timeout'));
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
    if (this.connectionState !== 'connected') await this.connect();
    return this._options.useHttp ? this.sendHttp<T>(command, customTimeout) : this.sendTcp<T>(command, customTimeout);
  }

  private async sendTcp<T>(command: Record<string, unknown>, customTimeout?: number): Promise<T> {
    if (!this.socket || this.connectionState !== 'connected') throw new Error('Not connected');
    return new Promise((resolve, reject) => {
      const reqId = generateReqId();
      const timeoutMs = customTimeout ?? this._options.timeout;
      const timer = setTimeout(() => { this.pendingRequests.delete(reqId); reject(new Error('Request timeout')); }, timeoutMs);
      this.pendingRequests.set(reqId, { resolve: (value) => resolve(value as T), reject, timer });
      if (this._options.useBinary) {
        const encoded = encode({ ...command, reqId });
        const frame = Buffer.alloc(4 + encoded.length);
        frame.writeUInt32BE(encoded.length, 0);
        frame.set(encoded, 4);
        this.socket!.write(frame);
      } else {
        this.socket!.write(JSON.stringify({ ...command, reqId }) + '\n');
      }
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
      const res = await fetch(req.url, { method: req.method, headers, body: req.body, signal: controller.signal });
      const json = (await res.json()) as ApiResponse;
      return parseHttpResponse(cmd as string, json) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('HTTP request timeout');
      throw error;
    } finally { clearTimeout(timeoutId); }
  }
}
