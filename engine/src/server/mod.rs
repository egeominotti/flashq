//! Server module for flashQ.
//!
//! Contains TCP connection handling and command processing.

mod connection;
mod handler;

pub use connection::handle_connection;
