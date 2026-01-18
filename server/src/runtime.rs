//! Runtime abstraction for conditional io_uring support.
//!
//! On Linux with the `io-uring` feature enabled, provides io_uring runtime.
//! On other platforms or without the feature, uses standard tokio.
//!
//! # Usage
//!
//! Build with io_uring support (Linux only):
//! ```bash
//! cargo build --release --features io-uring
//! ```
//!
//! # Note
//!
//! Full io_uring integration requires using the tokio-uring runtime which
//! has a different execution model. The current implementation detects
//! availability and provides optimized accept loop when enabled.

use tracing::info;

/// Check if io_uring is available and enabled at compile time
#[inline]
pub fn is_io_uring_enabled() -> bool {
    cfg!(all(target_os = "linux", feature = "io-uring"))
}

/// Check if running on Linux
#[inline]
pub fn is_linux() -> bool {
    cfg!(target_os = "linux")
}

/// Print runtime information at startup
pub fn print_runtime_info() {
    // Print OS info
    #[cfg(target_os = "linux")]
    {
        info!(os = "Linux", "Operating system detected");
    }
    #[cfg(target_os = "macos")]
    {
        info!(os = "macOS", "Operating system detected");
    }
    #[cfg(target_os = "windows")]
    {
        info!(os = "Windows", "Operating system detected");
    }

    // Print runtime/IO backend info
    #[cfg(all(target_os = "linux", feature = "io-uring"))]
    {
        info!(
            runtime = "tokio + io_uring",
            "IO backend: io_uring (kernel-level async)"
        );
        info!("  Benefits: zero-copy I/O, batched syscalls, reduced context switches");
    }

    #[cfg(all(target_os = "linux", not(feature = "io-uring")))]
    {
        info!(runtime = "tokio", io_backend = "epoll", "IO backend");
        info!("  Tip: Enable io_uring with: cargo build --features io-uring");
    }

    #[cfg(target_os = "macos")]
    {
        info!(runtime = "tokio", io_backend = "kqueue", "IO backend");
        info!("  Note: io_uring is Linux-only, kqueue is optimal for macOS");
    }

    #[cfg(target_os = "windows")]
    {
        info!(runtime = "tokio", io_backend = "IOCP", "IO backend");
        info!("  Note: io_uring is Linux-only, IOCP is optimal for Windows");
    }
}

/// Get runtime description string
pub fn runtime_description() -> &'static str {
    #[cfg(all(target_os = "linux", feature = "io-uring"))]
    {
        "tokio + io_uring"
    }

    #[cfg(all(target_os = "linux", not(feature = "io-uring")))]
    {
        "tokio (epoll)"
    }

    #[cfg(target_os = "macos")]
    {
        "tokio (kqueue)"
    }

    #[cfg(target_os = "windows")]
    {
        "tokio (IOCP)"
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        "tokio"
    }
}

// ============================================================
// io_uring optimized TCP accept (Linux only, experimental)
// ============================================================

/// Run TCP accept loop with io_uring (Linux only).
///
/// This uses tokio-uring for the accept loop while keeping the
/// connection handling in regular tokio tasks.
#[cfg(all(target_os = "linux", feature = "io-uring"))]
pub mod uring {
    use std::sync::Arc;
    use tokio::sync::mpsc;
    use tracing::{info, warn};

    /// Accepted connection info
    pub struct AcceptedConn {
        pub stream: std::net::TcpStream,
        pub addr: std::net::SocketAddr,
    }

    /// Start io_uring accept loop in a separate thread.
    /// Returns a channel receiver for accepted connections.
    ///
    /// The accept loop uses io_uring for efficient accepting,
    /// while connection handling remains in the tokio runtime.
    pub fn start_accept_loop(
        addr: std::net::SocketAddr,
    ) -> std::io::Result<mpsc::UnboundedReceiver<AcceptedConn>> {
        let (tx, rx) = mpsc::unbounded_channel();

        std::thread::spawn(move || {
            if let Err(e) = tokio_uring::start(async move {
                let listener = match tokio_uring::net::TcpListener::bind(addr) {
                    Ok(l) => l,
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to bind io_uring listener");
                        return;
                    }
                };

                info!(
                    port = addr.port(),
                    "io_uring accept loop started"
                );

                loop {
                    match listener.accept().await {
                        Ok((stream, peer_addr)) => {
                            // Convert to std TcpStream for tokio compatibility
                            let std_stream = stream.into_std();
                            if let Ok(std_stream) = std_stream {
                                let conn = AcceptedConn {
                                    stream: std_stream,
                                    addr: peer_addr,
                                };
                                if tx.send(conn).is_err() {
                                    // Receiver dropped, exit loop
                                    break;
                                }
                            }
                        }
                        Err(e) => {
                            warn!(error = %e, "io_uring accept error");
                        }
                    }
                }
            }) {
                tracing::error!(error = ?e, "io_uring runtime error");
            }
        });

        Ok(rx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runtime_detection() {
        let desc = runtime_description();
        assert!(!desc.is_empty());

        #[cfg(target_os = "linux")]
        assert!(is_linux());

        #[cfg(not(target_os = "linux"))]
        assert!(!is_linux());
    }

    #[test]
    fn test_io_uring_detection() {
        let enabled = is_io_uring_enabled();

        #[cfg(all(target_os = "linux", feature = "io-uring"))]
        assert!(enabled);

        #[cfg(not(all(target_os = "linux", feature = "io-uring")))]
        assert!(!enabled);
    }
}
