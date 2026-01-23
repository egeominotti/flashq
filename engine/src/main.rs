mod grpc;
mod http;
mod protocol;
mod queue;
mod runtime;
mod server;
mod telemetry;

use mimalloc::MiMalloc;
use tracing::{error, info, warn};

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::net::{TcpListener, UnixListener};
use tokio::signal;
use tokio::sync::broadcast;

use queue::sqlite::{S3BackupConfig, S3BackupManager};
use queue::QueueManager;
use server::handle_connection;

const DEFAULT_TCP_PORT: u16 = 6789;
const DEFAULT_HTTP_PORT: u16 = 6790;
const DEFAULT_GRPC_PORT: u16 = 6791;
const UNIX_SOCKET_PATH: &str = "/tmp/flashq.sock";
const SHUTDOWN_TIMEOUT_SECS: u64 = 30;

/// Global shutdown flag for graceful shutdown
static SHUTDOWN_FLAG: AtomicBool = AtomicBool::new(false);

/// Check if shutdown has been requested
fn is_shutting_down() -> bool {
    SHUTDOWN_FLAG.load(Ordering::Relaxed)
}

/// Create a shutdown signal handler
async fn shutdown_signal(shutdown_tx: broadcast::Sender<()>) {
    let ctrl_c = async {
        match signal::ctrl_c().await {
            Ok(()) => {}
            Err(e) => {
                warn!(error = %e, "Failed to install Ctrl+C handler, continuing without it");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match signal::unix::signal(signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(e) => {
                warn!(error = %e, "Failed to install SIGTERM handler, continuing without it");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("Shutdown signal received, starting graceful shutdown...");
    SHUTDOWN_FLAG.store(true, Ordering::Relaxed);
    let _ = shutdown_tx.send(());
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize telemetry (structured logging)
    telemetry::init();

    // Print runtime information
    runtime::print_runtime_info();

    // Create shutdown channel for graceful shutdown
    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    let shutdown_tx_signal = shutdown_tx.clone();

    // Spawn shutdown signal handler
    tokio::spawn(async move {
        shutdown_signal(shutdown_tx_signal).await;
    });

    let use_unix = std::env::var("UNIX_SOCKET").is_ok();
    // HTTP is enabled by default, can be disabled with NO_HTTP=1
    let enable_http = std::env::var("NO_HTTP").is_err();
    // gRPC is enabled by default, can be disabled with NO_GRPC=1
    let enable_grpc = std::env::var("NO_GRPC").is_err();

    // Parse auth tokens from environment
    let auth_tokens: Vec<String> = std::env::var("AUTH_TOKENS")
        .unwrap_or_default()
        .split(',')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    // Create QueueManager with optional SQLite persistence
    let queue_manager = create_queue_manager(&auth_tokens);

    // Start S3 backup if configured
    start_s3_backup_task(&queue_manager).await;

    // Start HTTP server if enabled
    if enable_http {
        start_http_server(&queue_manager, &shutdown_tx).await;
    }

    // Start gRPC server if enabled
    if enable_grpc {
        start_grpc_server(&queue_manager).await;
    }

    // Run main TCP server loop
    run_tcp_server(use_unix, &queue_manager, &shutdown_tx).await?;

    // Graceful shutdown
    graceful_shutdown(&queue_manager).await;

    Ok(())
}

/// Create QueueManager based on configuration
fn create_queue_manager(auth_tokens: &[String]) -> Arc<QueueManager> {
    // Check for SQLite configuration via environment (DATA_PATH or SQLITE_PATH)
    let sqlite_path = std::env::var("DATA_PATH")
        .or_else(|_| std::env::var("SQLITE_PATH"))
        .ok();

    match (sqlite_path, auth_tokens.is_empty()) {
        (Some(path), true) => {
            info!(path = %path, "Using SQLite persistence");
            QueueManager::with_sqlite_from_env()
        }
        (Some(path), false) => {
            info!(path = %path, token_count = auth_tokens.len(), "Using SQLite with authentication");
            let mut qm = QueueManager::with_sqlite_from_env();
            if let Some(q) = Arc::get_mut(&mut qm) {
                q.set_auth_tokens(auth_tokens.to_vec());
            }
            qm
        }
        (None, true) => {
            info!("Running in-memory mode (no persistence)");
            QueueManager::new(false)
        }
        (None, false) => {
            info!(
                token_count = auth_tokens.len(),
                "Running in-memory mode with authentication"
            );
            QueueManager::with_auth_tokens(false, auth_tokens.to_vec())
        }
    }
}

/// Start HTTP server in background
async fn start_http_server(queue_manager: &Arc<QueueManager>, shutdown_tx: &broadcast::Sender<()>) {
    let http_port = std::env::var("HTTP_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_HTTP_PORT);

    if http_port == 0 {
        error!(port = http_port, "Invalid HTTP port, must be 1-65535");
        std::process::exit(1);
    }

    let qm_http = Arc::clone(queue_manager);
    let mut shutdown_rx = shutdown_tx.subscribe();

    tokio::spawn(async move {
        let router = http::create_router(qm_http);
        let listener = match tokio::net::TcpListener::bind(format!("0.0.0.0:{}", http_port)).await {
            Ok(l) => l,
            Err(e) => {
                error!(port = http_port, error = %e, "Failed to bind HTTP listener");
                return;
            }
        };
        info!(
            version = env!("CARGO_PKG_VERSION"),
            port = http_port,
            endpoint = %format!("http://0.0.0.0:{}", http_port),
            "HTTP API ready"
        );
        if let Err(e) = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.recv().await;
            })
            .await
        {
            error!(error = %e, "HTTP server error");
        }
    });
}

/// Start gRPC server in background
async fn start_grpc_server(queue_manager: &Arc<QueueManager>) {
    let grpc_port = std::env::var("GRPC_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_GRPC_PORT);

    if grpc_port == 0 {
        error!(port = grpc_port, "Invalid gRPC port, must be 1-65535");
        std::process::exit(1);
    }

    let qm_grpc = Arc::clone(queue_manager);

    tokio::spawn(async move {
        let addr_str = format!("0.0.0.0:{}", grpc_port);
        let addr = match addr_str.parse() {
            Ok(a) => a,
            Err(e) => {
                error!(addr = %addr_str, error = %e, "Invalid gRPC address format");
                return;
            }
        };
        info!(
            version = env!("CARGO_PKG_VERSION"),
            port = grpc_port,
            endpoint = %format!("grpc://0.0.0.0:{}", grpc_port),
            "gRPC API ready"
        );
        if let Err(e) = grpc::run_grpc_server(addr, qm_grpc).await {
            error!(error = %e, "gRPC server error");
        }
    });
}

/// Run main TCP server loop
async fn run_tcp_server(
    use_unix: bool,
    queue_manager: &Arc<QueueManager>,
    shutdown_tx: &broadcast::Sender<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut shutdown_rx = shutdown_tx.subscribe();

    if use_unix {
        let _ = std::fs::remove_file(UNIX_SOCKET_PATH);
        let listener = UnixListener::bind(UNIX_SOCKET_PATH)?;
        info!(
            version = env!("CARGO_PKG_VERSION"),
            socket = UNIX_SOCKET_PATH,
            endpoint = %format!("unix://{}", UNIX_SOCKET_PATH),
            "flashQ server ready"
        );

        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((socket, _)) => {
                            if is_shutting_down() {
                                break;
                            }
                            let qm = Arc::clone(queue_manager);
                            qm.increment_connections();
                            tokio::spawn(async move {
                                let (reader, writer) = socket.into_split();
                                let _ = handle_connection(reader, writer, Arc::clone(&qm)).await;
                                qm.decrement_connections();
                            });
                        }
                        Err(e) => {
                            warn!(error = %e, "Failed to accept connection");
                        }
                    }
                }
                _ = shutdown_rx.recv() => {
                    break;
                }
            }
        }
    } else {
        let port = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(DEFAULT_TCP_PORT);

        let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
        info!(
            version = env!("CARGO_PKG_VERSION"),
            port = port,
            endpoint = %format!("tcp://0.0.0.0:{}", port),
            "flashQ server ready"
        );

        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((socket, _)) => {
                            if is_shutting_down() {
                                break;
                            }
                            socket.set_nodelay(true)?;
                            let qm = Arc::clone(queue_manager);
                            qm.increment_connections();
                            tokio::spawn(async move {
                                let (reader, writer) = socket.into_split();
                                let _ = handle_connection(reader, writer, Arc::clone(&qm)).await;
                                qm.decrement_connections();
                            });
                        }
                        Err(e) => {
                            warn!(error = %e, "Failed to accept connection");
                        }
                    }
                }
                _ = shutdown_rx.recv() => {
                    break;
                }
            }
        }
    }

    Ok(())
}

/// Start S3 backup task if configured
async fn start_s3_backup_task(queue_manager: &Arc<QueueManager>) {
    // Check if S3 backup is enabled
    let enabled = std::env::var("S3_BACKUP_ENABLED")
        .map(|v| v == "1" || v.to_lowercase() == "true")
        .unwrap_or(false);

    if !enabled {
        return;
    }

    // Get S3 configuration from environment
    let config = match S3BackupConfig::from_env() {
        Some(c) => c,
        None => {
            warn!("S3_BACKUP_ENABLED is set but missing required S3 configuration");
            return;
        }
    };

    // Get database path
    let db_path = match std::env::var("DATA_PATH").or_else(|_| std::env::var("SQLITE_PATH")) {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => {
            warn!("S3 backup requires DATA_PATH to be set");
            return;
        }
    };

    // Create S3 backup manager
    let backup_manager = match S3BackupManager::new(config.clone()).await {
        Ok(m) => Arc::new(m),
        Err(e) => {
            error!(error = %e, "Failed to create S3 backup manager");
            return;
        }
    };

    info!(
        bucket = %config.bucket,
        interval_secs = config.interval_secs,
        "S3 backup enabled"
    );

    // Clone for the background task
    let qm = Arc::clone(queue_manager);

    // Start background backup task
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(tokio::time::Duration::from_secs(config.interval_secs));

        loop {
            interval.tick().await;

            if qm.is_shutdown() {
                info!("S3 backup task stopping due to shutdown");
                break;
            }

            // Check if backup is needed
            if backup_manager.should_backup() {
                match backup_manager.backup(&db_path).await {
                    Ok(()) => {}
                    Err(e) => {
                        error!(error = %e, "S3 backup failed");
                    }
                }
            }
        }
    });
}

/// Graceful shutdown: wait for active jobs to complete
async fn graceful_shutdown(queue_manager: &Arc<QueueManager>) {
    queue_manager.shutdown();

    info!("Stopping new connections, waiting for active jobs to complete...");
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(SHUTDOWN_TIMEOUT_SECS);

    loop {
        let processing = queue_manager.processing_count();
        if processing == 0 {
            info!("All active jobs completed");
            break;
        }

        if start.elapsed() >= timeout {
            warn!(
                remaining_jobs = processing,
                timeout_secs = SHUTDOWN_TIMEOUT_SECS,
                "Shutdown timeout reached, forcing exit"
            );
            break;
        }

        info!(
            processing_jobs = processing,
            elapsed_secs = start.elapsed().as_secs(),
            "Waiting for active jobs to complete..."
        );
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    info!("Shutdown complete");
}
