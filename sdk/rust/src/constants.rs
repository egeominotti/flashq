use std::time::Duration;

pub const DEFAULT_HOST: &str = "localhost";
pub const DEFAULT_PORT: u16 = 6789;
pub const DEFAULT_HTTP_PORT: u16 = 6790;
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);
pub const DEFAULT_POOL_SIZE: usize = 4;

pub const DEFAULT_PULL_TIMEOUT_MS: u64 = 30_000;
pub const CLIENT_TIMEOUT_BUFFER_MS: u64 = 5_000;

pub const MAX_QUEUE_NAME_LENGTH: usize = 256;
pub const MAX_BATCH_SIZE: usize = 1000;
pub const MAX_JOB_DATA_SIZE: usize = 10 * 1024 * 1024; // 10MB

pub const DEFAULT_RECONNECT_DELAY: Duration = Duration::from_secs(1);
pub const DEFAULT_MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);
pub const DEFAULT_MAX_RECONNECT_ATTEMPTS: u32 = 10;

pub const DEFAULT_WORKER_CONCURRENCY: usize = 1;
pub const DEFAULT_WORKER_BATCH_SIZE: usize = 100;
pub const DEFAULT_WORKER_CLOSE_TIMEOUT: Duration = Duration::from_secs(30);

pub const QUEUE_NAME_PATTERN: &str = r"^[a-zA-Z0-9_.\-]+$";
