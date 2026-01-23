/**
 * SDK Constants
 *
 * Centralized configuration constants to avoid magic numbers
 * and ensure consistency across the codebase.
 */

// ============== Validation Limits ==============

/** Maximum allowed job data size in bytes (1MB) */
export const MAX_JOB_DATA_SIZE = 1024 * 1024;

/** Maximum number of jobs per batch operation */
export const MAX_BATCH_SIZE = 1000;

/** Maximum queue name length */
export const MAX_QUEUE_NAME_LENGTH = 256;

// ============== Timeouts ==============

/** Default connection timeout in ms */
export const DEFAULT_CONNECTION_TIMEOUT = 5000;

/** Default server-side pull timeout in ms */
export const DEFAULT_PULL_TIMEOUT = 60000;

/** Additional client timeout buffer over server timeout */
export const CLIENT_TIMEOUT_BUFFER = 5000;

/** Default job completion wait timeout in ms */
export const DEFAULT_FINISHED_TIMEOUT = 30000;

// ============== Worker Defaults ==============

/** Default worker concurrency */
export const DEFAULT_WORKER_CONCURRENCY = 10;

/** Default worker batch size */
export const DEFAULT_WORKER_BATCH_SIZE = 100;

/** Worker pull timeout for responsive shutdown (ms) */
export const WORKER_PULL_TIMEOUT = 500;

/** Worker error retry delay (ms) */
export const WORKER_ERROR_RETRY_DELAY = 1000;

/** Default graceful shutdown timeout (ms) */
export const DEFAULT_CLOSE_TIMEOUT = 30000;

/** Worker job completion check interval (ms) */
export const WORKER_JOB_CHECK_INTERVAL = 50;

// ============== Reconnection ==============

/** Default initial reconnect delay in ms */
export const DEFAULT_RECONNECT_DELAY = 1000;

/** Default max reconnect delay in ms */
export const DEFAULT_MAX_RECONNECT_DELAY = 30000;

/** Default max reconnect attempts (0 = infinite) */
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

/** Reconnect jitter factor (0.3 = 30% of base delay) */
export const RECONNECT_JITTER_FACTOR = 0.3;

// ============== Retry ==============

/** Default retry max attempts */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 3;

/** Default retry initial delay in ms */
export const DEFAULT_RETRY_INITIAL_DELAY = 100;

/** Default retry max delay in ms */
export const DEFAULT_RETRY_MAX_DELAY = 5000;

/** Default backoff multiplier */
export const DEFAULT_BACKOFF_MULTIPLIER = 2;

/** Jitter range factor (0.25 = ±25%) */
export const RETRY_JITTER_FACTOR = 0.25;

// ============== Compression ==============

/** Default compression enabled state */
export const DEFAULT_COMPRESSION_ENABLED = false;

/** Default minimum payload size to compress in bytes */
export const DEFAULT_COMPRESSION_THRESHOLD = 1024;

// ============== Request Queue ==============

/** Default max queued requests during disconnect */
export const DEFAULT_MAX_QUEUED_REQUESTS = 100;

// ============== Job Defaults ==============

/** Default job priority */
export const DEFAULT_JOB_PRIORITY = 0;

/** Default stall detection timeout in ms */
export const DEFAULT_STALL_TIMEOUT = 30000;

// ============== Ports ==============

/** Default TCP port */
export const DEFAULT_TCP_PORT = 6789;

/** Default HTTP port */
export const DEFAULT_HTTP_PORT = 6790;

/** Default host */
export const DEFAULT_HOST = 'localhost';
