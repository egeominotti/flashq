//! NATS JetStream connection management.
//!
//! Handles client connection, reconnection, and JetStream context.

use async_nats::jetstream::{self, Context as JetStreamContext};
use async_nats::Client;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use super::config::NatsConfig;

/// NATS connection state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

/// NATS connection manager.
pub struct NatsConnection {
    config: NatsConfig,
    client: RwLock<Option<Client>>,
    jetstream: RwLock<Option<JetStreamContext>>,
    state: RwLock<ConnectionState>,
    node_id: String,
}

impl NatsConnection {
    /// Create a new NATS connection manager.
    pub fn new(config: NatsConfig) -> Self {
        let node_id = config.node_id();
        Self {
            config,
            client: RwLock::new(None),
            jetstream: RwLock::new(None),
            state: RwLock::new(ConnectionState::Disconnected),
            node_id,
        }
    }

    /// Connect to NATS server.
    pub async fn connect(&self) -> Result<(), NatsError> {
        *self.state.write().await = ConnectionState::Connecting;

        let mut options = async_nats::ConnectOptions::new()
            .connection_timeout(self.config.connect_timeout)
            .request_timeout(Some(self.config.request_timeout))
            .client_capacity(self.config.reconnect_buffer_size)
            .name(&self.node_id);

        // Configure authentication
        if let Some(ref creds) = self.config.credentials_file {
            options = options.credentials_file(creds).await.map_err(|e| {
                NatsError::ConnectionFailed(format!("Failed to load credentials: {}", e))
            })?;
        } else if let (Some(ref user), Some(ref pass)) =
            (&self.config.username, &self.config.password)
        {
            options = options.user_and_password(user.clone(), pass.clone());
        }

        // Add reconnect handler
        options = options.event_callback(|event| async move {
            match event {
                async_nats::Event::Connected => {
                    info!("NATS connected");
                }
                async_nats::Event::Disconnected => {
                    warn!("NATS disconnected");
                }
                async_nats::Event::LameDuckMode => {
                    warn!("NATS server entering lame duck mode");
                }
                async_nats::Event::SlowConsumer(_) => {
                    warn!("NATS slow consumer detected");
                }
                async_nats::Event::ServerError(err) => {
                    error!("NATS server error: {:?}", err);
                }
                async_nats::Event::ClientError(err) => {
                    error!("NATS client error: {:?}", err);
                }
                async_nats::Event::Draining => {
                    warn!("NATS connection draining");
                }
                async_nats::Event::Closed => {
                    info!("NATS connection closed");
                }
            }
        });

        let client = async_nats::connect_with_options(&self.config.url, options)
            .await
            .map_err(|e| NatsError::ConnectionFailed(e.to_string()))?;

        let jetstream = jetstream::new(client.clone());

        *self.client.write().await = Some(client);
        *self.jetstream.write().await = Some(jetstream);
        *self.state.write().await = ConnectionState::Connected;

        info!(
            node_id = %self.node_id,
            url = %self.config.url,
            "NATS JetStream connected"
        );

        Ok(())
    }

    /// Get NATS client reference.
    pub async fn client(&self) -> Result<Client, NatsError> {
        self.client
            .read()
            .await
            .clone()
            .ok_or(NatsError::NotConnected)
    }

    /// Get JetStream context.
    pub async fn jetstream(&self) -> Result<JetStreamContext, NatsError> {
        self.jetstream
            .read()
            .await
            .clone()
            .ok_or(NatsError::NotConnected)
    }

    /// Get current connection state.
    pub async fn state(&self) -> ConnectionState {
        *self.state.read().await
    }

    /// Check if connected.
    pub async fn is_connected(&self) -> bool {
        *self.state.read().await == ConnectionState::Connected
    }

    /// Get node ID.
    #[inline]
    pub fn node_id(&self) -> &str {
        &self.node_id
    }

    /// Get configuration reference.
    #[inline]
    pub fn config(&self) -> &NatsConfig {
        &self.config
    }

    /// Disconnect from NATS.
    pub async fn disconnect(&self) {
        if let Some(client) = self.client.write().await.take() {
            client.drain().await.ok();
        }
        *self.jetstream.write().await = None;
        *self.state.write().await = ConnectionState::Disconnected;
        info!(node_id = %self.node_id, "NATS disconnected");
    }
}

/// Shared NATS connection handle.
pub type NatsConnectionHandle = Arc<NatsConnection>;

/// Create a shared NATS connection handle.
pub fn create_connection(config: NatsConfig) -> NatsConnectionHandle {
    Arc::new(NatsConnection::new(config))
}

/// NATS error types.
#[derive(Debug, Clone)]
pub enum NatsError {
    /// Failed to connect to NATS server
    ConnectionFailed(String),
    /// Not connected to NATS
    NotConnected,
    /// JetStream operation failed
    JetStreamError(String),
    /// KV operation failed
    KvError(String),
    /// Stream not found
    StreamNotFound(String),
    /// Consumer not found
    ConsumerNotFound(String),
    /// Message publish failed
    PublishFailed(String),
    /// Message fetch failed
    FetchFailed(String),
    /// Serialization/deserialization failed
    SerializationError(String),
    /// Invalid configuration
    ConfigError(String),
    /// Timeout
    Timeout,
    /// Leader election failed
    LeaderElectionFailed(String),
}

impl std::fmt::Display for NatsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConnectionFailed(msg) => write!(f, "NATS connection failed: {}", msg),
            Self::NotConnected => write!(f, "Not connected to NATS"),
            Self::JetStreamError(msg) => write!(f, "JetStream error: {}", msg),
            Self::KvError(msg) => write!(f, "KV error: {}", msg),
            Self::StreamNotFound(name) => write!(f, "Stream not found: {}", name),
            Self::ConsumerNotFound(name) => write!(f, "Consumer not found: {}", name),
            Self::PublishFailed(msg) => write!(f, "Publish failed: {}", msg),
            Self::FetchFailed(msg) => write!(f, "Fetch failed: {}", msg),
            Self::SerializationError(msg) => write!(f, "Serialization error: {}", msg),
            Self::ConfigError(msg) => write!(f, "Configuration error: {}", msg),
            Self::Timeout => write!(f, "NATS operation timeout"),
            Self::LeaderElectionFailed(msg) => write!(f, "Leader election failed: {}", msg),
        }
    }
}

impl std::error::Error for NatsError {}

impl From<async_nats::Error> for NatsError {
    fn from(err: async_nats::Error) -> Self {
        Self::JetStreamError(err.to_string())
    }
}
