/**
 * Logger utility with configurable log levels
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5,
};

export interface LoggerOptions {
  /** Minimum log level (default: 'silent') */
  level?: LogLevel;
  /** Prefix for all log messages */
  prefix?: string;
  /** Include timestamps (default: true) */
  timestamps?: boolean;
  /** Custom log handler (default: console) */
  handler?: LogHandler;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: string;
  prefix?: string;
  requestId?: string;
}

export type LogHandler = (entry: LogEntry) => void;

const defaultHandler: LogHandler = (entry) => {
  const parts = [
    entry.timestamp,
    entry.prefix ? `[${entry.prefix}]` : '',
    entry.requestId ? `[${entry.requestId}]` : '',
    entry.level.toUpperCase(),
    entry.message,
  ].filter(Boolean);

  const line = parts.join(' ');

  switch (entry.level) {
    case 'trace':
    case 'debug':
      if (entry.data !== undefined) {
        console.debug(line, entry.data);
      } else {
        console.debug(line);
      }
      break;
    case 'info':
      if (entry.data !== undefined) {
        console.info(line, entry.data);
      } else {
        console.info(line);
      }
      break;
    case 'warn':
      if (entry.data !== undefined) {
        console.warn(line, entry.data);
      } else {
        console.warn(line);
      }
      break;
    case 'error':
      if (entry.data !== undefined) {
        console.error(line, entry.data);
      } else {
        console.error(line);
      }
      break;
  }
};

export class Logger {
  private level: number;
  private prefix?: string;
  private timestamps: boolean;
  private handler: LogHandler;
  private requestId?: string;

  constructor(options: LoggerOptions = {}) {
    this.level = LOG_LEVELS[options.level ?? 'silent'];
    this.prefix = options.prefix;
    this.timestamps = options.timestamps ?? true;
    this.handler = options.handler ?? defaultHandler;
  }

  /** Create a child logger with additional prefix */
  child(prefix: string): Logger {
    const childLogger = new Logger({
      level: this.getLevelName(),
      prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
      timestamps: this.timestamps,
      handler: this.handler,
    });
    childLogger.requestId = this.requestId;
    return childLogger;
  }

  /** Set request ID for correlation */
  setRequestId(id: string): void {
    this.requestId = id;
  }

  /** Clear request ID */
  clearRequestId(): void {
    this.requestId = undefined;
  }

  /** Get current log level name */
  getLevelName(): LogLevel {
    for (const [name, value] of Object.entries(LOG_LEVELS)) {
      if (value === this.level) return name as LogLevel;
    }
    return 'silent';
  }

  /** Set log level */
  setLevel(level: LogLevel): void {
    this.level = LOG_LEVELS[level];
  }

  /** Check if level is enabled */
  isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.level;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVELS[level] < this.level) return;

    this.handler({
      level,
      message,
      data,
      timestamp: this.timestamps ? new Date().toISOString() : '',
      prefix: this.prefix,
      requestId: this.requestId,
    });
  }

  trace(message: string, data?: unknown): void {
    this.log('trace', message, data);
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }
}

/** Global logger instance */
let globalLogger = new Logger();

export function getLogger(): Logger {
  return globalLogger;
}

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}

export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}
