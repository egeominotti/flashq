use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tracing::{debug, warn};

use crate::connection::Connection;
use crate::errors::{FlashQError, Result};
use crate::types::ClientOptions;

/// Connection pool with round-robin selection and auto-reconnect.
pub struct ConnectionPool {
    connections: Vec<Arc<Connection>>,
    index: AtomicUsize,
    opts: ClientOptions,
    connected: AtomicBool,
    health_handle: Mutex<Option<JoinHandle<()>>>,
    reconnects: AtomicU64,
    failures: AtomicU64,
}

impl ConnectionPool {
    pub fn new(opts: ClientOptions) -> Self {
        let pool_size = opts.pool_size.max(1);
        let connections = (0..pool_size)
            .map(|_| Arc::new(Connection::new(opts.clone())))
            .collect();

        Self {
            connections,
            index: AtomicUsize::new(0),
            opts,
            connected: AtomicBool::new(false),
            health_handle: Mutex::new(None),
            reconnects: AtomicU64::new(0),
            failures: AtomicU64::new(0),
        }
    }

    pub async fn connect(&self) -> Result<()> {
        let mut first_error: Option<FlashQError> = None;

        for (i, conn) in self.connections.iter().enumerate() {
            match conn.connect().await {
                Ok(()) => {
                    if let Some(ref token) = self.opts.token {
                        let cmd = serde_json::json!({"cmd": "AUTH", "token": token});
                        match conn.send(cmd, self.opts.timeout).await {
                            Ok(resp) => {
                                let ok = resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                                if !ok {
                                    let err = resp
                                        .get("error")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("auth failed");
                                    return Err(FlashQError::Authentication(err.to_string()));
                                }
                            }
                            Err(e) => {
                                return Err(FlashQError::Authentication(format!(
                                    "auth failed: {e}"
                                )));
                            }
                        }
                    }
                    debug!("pool connection {i} established");
                }
                Err(e) => {
                    warn!("pool connection {i} failed: {e}");
                    if first_error.is_none() {
                        first_error = Some(e);
                    }
                }
            }
        }

        let healthy = self.healthy_count();
        if healthy == 0 {
            return Err(first_error
                .unwrap_or_else(|| FlashQError::Connection("all connections failed".into())));
        }

        self.connected.store(true, Ordering::SeqCst);
        debug!(
            "pool connected: {healthy}/{} connections",
            self.connections.len()
        );

        if self.opts.auto_reconnect {
            self.start_health_checker().await;
        }

        Ok(())
    }

    /// Send a command to the server via a healthy connection (round-robin).
    pub async fn send(&self, cmd: Value, timeout: Duration) -> Result<Value> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(FlashQError::Connection("pool not connected".into()));
        }

        let count = self.connections.len();
        let start = self.index.fetch_add(1, Ordering::Relaxed) % count;

        // Try starting from round-robin index, then wrap around
        for i in 0..count {
            let idx = (start + i) % count;
            let conn = &self.connections[idx];
            if !conn.is_connected() {
                continue;
            }
            match conn.send(cmd.clone(), timeout).await {
                Ok(resp) => return Ok(resp),
                Err(e) => {
                    self.failures.fetch_add(1, Ordering::Relaxed);
                    if i < count - 1 {
                        warn!("connection {idx} failed, trying next: {e}");
                        continue;
                    }
                    return Err(e);
                }
            }
        }

        Err(FlashQError::Connection("no healthy connections".into()))
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst) && self.healthy_count() > 0
    }

    pub fn healthy_count(&self) -> usize {
        self.connections.iter().filter(|c| c.is_connected()).count()
    }

    pub fn stats(&self) -> (u64, u64, usize) {
        (
            self.reconnects.load(Ordering::Relaxed),
            self.failures.load(Ordering::Relaxed),
            self.healthy_count(),
        )
    }

    pub async fn close(&self) -> Result<()> {
        self.connected.store(false, Ordering::SeqCst);

        {
            let mut handle = self.health_handle.lock().await;
            if let Some(h) = handle.take() {
                h.abort();
            }
        }

        for conn in &self.connections {
            let _ = conn.close().await;
        }

        debug!("pool closed");
        Ok(())
    }

    async fn start_health_checker(&self) {
        let connections: Vec<Arc<Connection>> = self.connections.to_vec();
        let opts = self.opts.clone();
        let reconnects = &self.reconnects as *const AtomicU64 as usize;

        let handle = tokio::spawn(async move {
            let reconnects = unsafe { &*(reconnects as *const AtomicU64) };
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;

                for (i, conn) in connections.iter().enumerate() {
                    if conn.is_connected() {
                        continue;
                    }

                    debug!("reconnecting pool connection {i}...");
                    let mut delay = opts.reconnect_delay;

                    for attempt in 0..opts.max_reconnect_attempts {
                        match conn.connect().await {
                            Ok(()) => {
                                if let Some(ref token) = opts.token {
                                    let cmd = serde_json::json!({"cmd": "AUTH", "token": token});
                                    if let Err(e) = conn.send(cmd, opts.timeout).await {
                                        warn!("reconnect auth failed for conn {i}: {e}");
                                        let _ = conn.close().await;
                                        continue;
                                    }
                                }
                                reconnects.fetch_add(1, Ordering::Relaxed);
                                debug!("reconnected pool connection {i}");
                                break;
                            }
                            Err(e) => {
                                warn!(
                                    "reconnect attempt {}/{} for conn {i} failed: {e}",
                                    attempt + 1,
                                    opts.max_reconnect_attempts
                                );
                                tokio::time::sleep(delay).await;
                                delay = (delay * 2).min(opts.max_reconnect_delay);
                            }
                        }
                    }
                }
            }
        });

        let mut h = self.health_handle.lock().await;
        *h = Some(handle);
    }
}

impl Drop for ConnectionPool {
    fn drop(&mut self) {
        self.connected.store(false, Ordering::SeqCst);
    }
}
