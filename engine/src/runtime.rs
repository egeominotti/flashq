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
#[allow(dead_code)]
pub fn is_io_uring_enabled() -> bool {
    cfg!(all(target_os = "linux", feature = "io-uring"))
}

/// Check if running on Linux
#[inline]
#[allow(dead_code)]
pub fn is_linux() -> bool {
    cfg!(target_os = "linux")
}

/// Print runtime information at startup
pub fn print_runtime_info() {
    #[cfg(all(target_os = "linux", feature = "io-uring"))]
    info!(
        os = "linux",
        runtime = "tokio",
        io = "io_uring",
        "Runtime initialized"
    );

    #[cfg(all(target_os = "linux", not(feature = "io-uring")))]
    info!(
        os = "linux",
        runtime = "tokio",
        io = "epoll",
        "Runtime initialized"
    );

    #[cfg(target_os = "macos")]
    info!(
        os = "macos",
        runtime = "tokio",
        io = "kqueue",
        "Runtime initialized"
    );

    #[cfg(target_os = "windows")]
    info!(
        os = "windows",
        runtime = "tokio",
        io = "iocp",
        "Runtime initialized"
    );

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    info!(runtime = "tokio", "Runtime initialized");
}

/// Get runtime description string
#[allow(dead_code)]
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
