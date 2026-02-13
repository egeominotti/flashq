use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;
use tracing::{debug, error, trace, warn};

use crate::errors::{FlashQError, Result};
use crate::types::ClientOptions;

type PendingMap = Arc<DashMap<String, oneshot::Sender<Value>>>;

/// A single TCP connection to flashQ with reqId-based multiplexing.
pub struct Connection {
    opts: ClientOptions,
    writer: Arc<Mutex<Option<BufWriter<OwnedWriteHalf>>>>,
    pending: PendingMap,
    req_counter: AtomicU64,
    connected: AtomicBool,
    reader_handle: Mutex<Option<JoinHandle<()>>>,
}

impl Connection {
    pub fn new(opts: ClientOptions) -> Self {
        Self {
            opts,
            writer: Arc::new(Mutex::new(None)),
            pending: Arc::new(DashMap::new()),
            req_counter: AtomicU64::new(1),
            connected: AtomicBool::new(false),
            reader_handle: Mutex::new(None),
        }
    }

    pub async fn connect(&self) -> Result<()> {
        let addr = format!("{}:{}", self.opts.host, self.opts.port);
        debug!("connecting to {}", addr);

        let stream = tokio::time::timeout(self.opts.timeout, TcpStream::connect(&addr))
            .await
            .map_err(|_| FlashQError::Timeout(format!("connect timeout to {addr}")))?
            .map_err(|e| FlashQError::Connection(format!("failed to connect to {addr}: {e}")))?;

        stream
            .set_nodelay(true)
            .map_err(|e| FlashQError::Connection(format!("set_nodelay failed: {e}")))?;

        let (read_half, write_half) = stream.into_split();

        {
            let mut writer = self.writer.lock().await;
            *writer = Some(BufWriter::new(write_half));
        }

        let pending = self.pending.clone();
        let use_binary = self.opts.use_binary;
        let connected = Arc::new(AtomicBool::new(true));
        let connected_clone = connected.clone();

        let handle = tokio::spawn(async move {
            let reader = BufReader::new(read_half);
            if use_binary {
                read_loop_binary(reader, pending.clone(), connected_clone).await;
            } else {
                read_loop_text(reader, pending.clone(), connected_clone).await;
            }
            fail_all_pending(&pending, "connection lost");
        });

        {
            let mut rh = self.reader_handle.lock().await;
            *rh = Some(handle);
        }

        self.connected.store(true, Ordering::SeqCst);
        debug!("connected to {}", addr);
        Ok(())
    }

    /// Send a command and wait for the response.
    pub async fn send(&self, mut cmd: Value, timeout: Duration) -> Result<Value> {
        if !self.connected.load(Ordering::SeqCst) {
            return Err(FlashQError::Connection("not connected".into()));
        }

        let req_id = self.req_counter.fetch_add(1, Ordering::Relaxed).to_string();
        cmd.as_object_mut()
            .ok_or_else(|| FlashQError::Protocol("command must be a JSON object".into()))?
            .insert("reqId".to_string(), Value::String(req_id.clone()));

        let (tx, rx) = oneshot::channel();
        self.pending.insert(req_id.clone(), tx);

        let write_result = if self.opts.use_binary {
            self.send_binary(&cmd).await
        } else {
            self.send_text(&cmd).await
        };

        if let Err(e) = write_result {
            self.pending.remove(&req_id);
            self.connected.store(false, Ordering::SeqCst);
            return Err(e);
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(resp)) => Ok(resp),
            Ok(Err(_)) => Err(FlashQError::Connection("response channel closed".into())),
            Err(_) => {
                self.pending.remove(&req_id);
                Err(FlashQError::Timeout(format!(
                    "request timed out after {}ms",
                    timeout.as_millis()
                )))
            }
        }
    }

    async fn send_text(&self, cmd: &Value) -> Result<()> {
        let mut data = serde_json::to_vec(cmd)?;
        data.push(b'\n');
        let mut writer = self.writer.lock().await;
        let w = writer
            .as_mut()
            .ok_or_else(|| FlashQError::Connection("writer not available".into()))?;
        w.write_all(&data).await?;
        w.flush().await?;
        trace!("sent text: {} bytes", data.len());
        Ok(())
    }

    async fn send_binary(&self, cmd: &Value) -> Result<()> {
        let data = rmp_serde::to_vec_named(cmd)
            .map_err(|e| FlashQError::Protocol(format!("msgpack encode: {e}")))?;
        let len = (data.len() as u32).to_be_bytes();
        let mut writer = self.writer.lock().await;
        let w = writer
            .as_mut()
            .ok_or_else(|| FlashQError::Connection("writer not available".into()))?;
        w.write_all(&len).await?;
        w.write_all(&data).await?;
        w.flush().await?;
        trace!("sent binary: {} bytes", data.len());
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    pub async fn close(&self) -> Result<()> {
        self.connected.store(false, Ordering::SeqCst);
        {
            let mut writer = self.writer.lock().await;
            if let Some(mut w) = writer.take() {
                let _ = w.shutdown().await;
            }
        }
        {
            let mut rh = self.reader_handle.lock().await;
            if let Some(handle) = rh.take() {
                handle.abort();
            }
        }
        fail_all_pending(&self.pending, "connection closed");
        debug!("connection closed");
        Ok(())
    }
}

async fn read_loop_text(
    mut reader: BufReader<OwnedReadHalf>,
    pending: PendingMap,
    connected: Arc<AtomicBool>,
) {
    let mut line = String::with_capacity(8192);
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                debug!("server closed connection (EOF)");
                break;
            }
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(resp) => dispatch_response(&pending, resp),
                    Err(e) => warn!("failed to parse response: {e}"),
                }
            }
            Err(e) => {
                error!("read error: {e}");
                break;
            }
        }
    }
    connected.store(false, Ordering::SeqCst);
}

async fn read_loop_binary(
    mut reader: BufReader<OwnedReadHalf>,
    pending: PendingMap,
    connected: Arc<AtomicBool>,
) {
    let mut len_buf = [0u8; 4];
    loop {
        if let Err(e) = reader.read_exact(&mut len_buf).await {
            if e.kind() != std::io::ErrorKind::UnexpectedEof {
                error!("binary read error: {e}");
            }
            break;
        }
        let len = u32::from_be_bytes(len_buf) as usize;
        if len > 16 * 1024 * 1024 {
            error!("frame too large: {len} bytes, closing connection");
            break;
        }
        let mut data = vec![0u8; len];
        if let Err(e) = reader.read_exact(&mut data).await {
            error!("binary payload read error: {e}");
            break;
        }
        match rmp_serde::from_slice::<Value>(&data) {
            Ok(resp) => dispatch_response(&pending, resp),
            Err(e) => warn!("failed to decode msgpack response: {e}"),
        }
    }
    connected.store(false, Ordering::SeqCst);
}

fn dispatch_response(pending: &DashMap<String, oneshot::Sender<Value>>, resp: Value) {
    let req_id = resp
        .get("reqId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if let Some(id) = req_id {
        if let Some((_, sender)) = pending.remove(&id) {
            let _ = sender.send(resp);
        } else {
            trace!("no pending request for reqId: {id}");
        }
    } else {
        trace!("response without reqId: {:?}", resp);
    }
}

fn fail_all_pending(pending: &DashMap<String, oneshot::Sender<Value>>, reason: &str) {
    let keys: Vec<String> = pending.iter().map(|r| r.key().clone()).collect();
    for key in keys {
        if let Some((_, sender)) = pending.remove(&key) {
            let err_resp = serde_json::json!({
                "ok": false,
                "error": reason,
                "reqId": key,
            });
            let _ = sender.send(err_resp);
        }
    }
}
