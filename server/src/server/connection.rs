//! TCP connection handling for flashQ.
//!
//! Handles both text (JSON) and binary (MessagePack) protocols.

use std::sync::Arc;

use parking_lot::RwLock;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};

use crate::protocol::{create_binary_frame, serialize_msgpack, Response, ResponseWithId};
use crate::queue::QueueManager;

use super::handler::{process_command_binary, process_command_text};

/// Connection state tracking authentication
pub struct ConnectionState {
    pub authenticated: bool,
}

/// Handle a new TCP connection (auto-detects protocol)
pub async fn handle_connection<R, W>(
    reader: R,
    writer: W,
    queue_manager: Arc<QueueManager>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut reader = BufReader::with_capacity(128 * 1024, reader);
    let mut writer = BufWriter::with_capacity(128 * 1024, writer);
    let state = Arc::new(RwLock::new(ConnectionState {
        authenticated: false,
    }));

    // Peek first byte to detect protocol
    let first_byte = {
        let buf = reader.fill_buf().await?;
        if buf.is_empty() {
            return Ok(());
        }
        buf[0]
    };

    // Route to appropriate handler based on protocol
    if first_byte == b'{' || first_byte == b'\n' || first_byte == b'\r' {
        // Text protocol (JSON, line-delimited)
        handle_text_protocol(&mut reader, &mut writer, &queue_manager, &state).await
    } else {
        // Binary protocol (MessagePack, length-prefixed)
        handle_binary_protocol(&mut reader, &mut writer, &queue_manager, &state).await
    }
}

/// Handle text protocol (JSON, newline-delimited)
pub async fn handle_text_protocol<R, W>(
    reader: &mut BufReader<R>,
    writer: &mut BufWriter<W>,
    queue_manager: &Arc<QueueManager>,
    state: &Arc<RwLock<ConnectionState>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut line = String::with_capacity(8192);

    loop {
        line.clear();
        let bytes_read = reader.read_line(&mut line).await?;

        if bytes_read == 0 {
            break;
        }

        let response = process_command_text(&mut line, queue_manager, state).await;
        let response_json = serde_json::to_string(&response)?;
        writer.write_all(response_json.as_bytes()).await?;
        writer.write_all(b"\n").await?;

        // Pipelining: only flush if no more commands waiting in buffer
        if reader.buffer().is_empty() {
            writer.flush().await?;
        }
    }

    Ok(())
}

/// Handle binary protocol (MessagePack, length-prefixed frames)
/// Frame format: [4 bytes length (big-endian u32)] [N bytes MessagePack data]
pub async fn handle_binary_protocol<R, W>(
    reader: &mut BufReader<R>,
    writer: &mut BufWriter<W>,
    queue_manager: &Arc<QueueManager>,
    state: &Arc<RwLock<ConnectionState>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut len_buf = [0u8; 4];
    let mut data_buf = Vec::with_capacity(8192);

    loop {
        // Read 4-byte length prefix
        match reader.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.into()),
        }

        let len = u32::from_be_bytes(len_buf) as usize;

        // Sanity check: max 16MB per message
        if len > 16 * 1024 * 1024 {
            let err_response = ResponseWithId::new(Response::error("Message too large"), None);
            let err_bytes = serialize_msgpack(&err_response)?;
            let frame = create_binary_frame(&err_bytes);
            writer.write_all(&frame).await?;
            writer.flush().await?;
            continue;
        }

        // Read message data
        data_buf.clear();
        data_buf.resize(len, 0);
        reader.read_exact(&mut data_buf).await?;

        // Process command
        let response = process_command_binary(&data_buf, queue_manager, state).await;

        // Serialize and send response
        let response_bytes = serialize_msgpack(&response)?;
        let frame = create_binary_frame(&response_bytes);
        writer.write_all(&frame).await?;

        // Pipelining: only flush if no more commands waiting in buffer
        if reader.buffer().is_empty() {
            writer.flush().await?;
        }
    }

    Ok(())
}
