//! Webhook operations.
//!
//! Webhook management, firing, circuit breaker, and HMAC signing.

use std::sync::Arc;

use serde_json::Value;
use tracing::{error, warn};

use super::manager::QueueManager;
use super::storage::Storage;
use super::types::{now_ms, CircuitState, Webhook};
use crate::protocol::WebhookConfig;

impl QueueManager {
    /// List all webhooks.
    pub async fn list_webhooks(&self) -> Vec<WebhookConfig> {
        let webhooks = self.webhooks.read();
        webhooks
            .values()
            .map(|w| WebhookConfig {
                id: w.id.clone(),
                url: w.url.clone(),
                events: w.events.clone(),
                queue: w.queue.clone(),
                secret: w.secret.clone(),
                created_at: w.created_at,
            })
            .collect()
    }

    /// Add a webhook.
    /// Validates URL to prevent SSRF attacks (blocks internal/private IPs).
    pub async fn add_webhook(
        &self,
        url: String,
        events: Vec<String>,
        queue: Option<String>,
        secret: Option<String>,
    ) -> Result<String, String> {
        // Validate webhook URL to prevent SSRF
        validate_webhook_url(&url)?;

        let id = format!("wh_{}", crate::protocol::next_id());
        let webhook = Webhook::new(
            id.clone(),
            url.clone(),
            events.clone(),
            queue.clone(),
            secret.clone(),
        );
        self.webhooks.write().insert(id.clone(), webhook);

        // Persist to storage
        if let Some(ref storage) = self.storage {
            let config = WebhookConfig {
                id: id.clone(),
                url,
                events,
                queue,
                secret,
                created_at: now_ms(),
            };
            let _ = storage.save_webhook(&config);
        }

        Ok(id)
    }

    /// Delete a webhook.
    /// Also removes the associated circuit breaker entry to prevent memory leak.
    pub async fn delete_webhook(&self, id: &str) -> bool {
        // Get the webhook URL before removing (for circuit cleanup)
        let url = self.webhooks.read().get(id).map(|w| w.url.clone());

        let removed = self.webhooks.write().remove(id).is_some();

        // Clean up circuit breaker entry for this webhook
        if let Some(url) = url {
            self.webhook_circuits.write().remove(&url);
        }

        // Delete from storage
        if removed {
            if let Some(ref storage) = self.storage {
                let _ = storage.delete_webhook(id);
            }
        }

        removed
    }

    /// Fire webhooks for an event.
    /// Uses circuit breaker to prevent cascading failures.
    pub(crate) fn fire_webhooks(
        &self,
        event_type: &str,
        queue: &str,
        job_id: u64,
        data: Option<&Value>,
        error: Option<&str>,
    ) {
        let webhooks = self.webhooks.read();
        let now = now_ms();
        let config = &self.circuit_breaker_config;

        for webhook in webhooks.values() {
            // Check event type matches
            if !webhook.events.iter().any(|e| e == event_type || e == "*") {
                continue;
            }
            // Check queue filter
            if let Some(ref wq) = webhook.queue {
                if wq != queue {
                    continue;
                }
            }

            let url = webhook.url.clone();

            // Check circuit breaker before sending
            {
                let mut circuits = self.webhook_circuits.write();
                let circuit = circuits.entry(url.clone()).or_default();

                // Try to transition from open to half-open if recovery timeout passed
                circuit.try_half_open(now, config.recovery_timeout_ms);

                if !circuit.should_allow(now, config.recovery_timeout_ms) {
                    warn!(
                        url = %url,
                        state = ?circuit.state,
                        failures = circuit.failures,
                        "Webhook circuit open, skipping request"
                    );
                    continue;
                }
            }

            let secret = webhook.secret.clone();
            let payload = serde_json::json!({
                "event": event_type,
                "queue": queue,
                "job_id": job_id,
                "timestamp": now,
                "data": data,
                "error": error,
            });

            // Fire webhook in background using shared client (non-blocking)
            let client = self.http_client.clone();
            let webhook_url = url.clone();
            let failure_threshold = config.failure_threshold;
            let circuits = Arc::clone(&self.webhook_circuits);

            tokio::spawn(async move {
                let mut req = client.post(&url).json(&payload);

                if let Some(secret) = secret {
                    // Add HMAC signature header
                    let body = serde_json::to_string(&payload).unwrap_or_default();
                    let signature = hmac_sha256(&secret, &body);
                    req = req.header("X-FlashQ-Signature", signature);
                }

                let success = match req.send().await {
                    Ok(response) => {
                        if response.status().is_success() {
                            true
                        } else {
                            warn!(
                                url = %webhook_url,
                                status = %response.status(),
                                "Webhook request failed"
                            );
                            false
                        }
                    }
                    Err(e) => {
                        error!(url = %webhook_url, error = %e, "Webhook request error");
                        false
                    }
                };

                // Update circuit breaker state
                let now = now_ms();
                let mut circuits = circuits.write();
                if let Some(circuit) = circuits.get_mut(&webhook_url) {
                    if success {
                        circuit.record_success();
                    } else {
                        circuit.record_failure(now, failure_threshold);
                        if circuit.state == CircuitState::Open {
                            warn!(
                                url = %webhook_url,
                                failures = circuit.failures,
                                "Webhook circuit opened after consecutive failures"
                            );
                        }
                    }
                }
            });
        }
    }
}

/// Validate webhook URL to prevent SSRF attacks.
/// Blocks internal/private IPs and localhost.
fn validate_webhook_url(url: &str) -> Result<(), String> {
    use std::net::IpAddr;

    // Parse the URL
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;

    // Only allow http and https schemes
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(format!(
                "Invalid scheme '{}': only http/https allowed",
                scheme
            ))
        }
    }

    // Get the host
    let host = parsed
        .host_str()
        .ok_or_else(|| "URL must have a host".to_string())?;

    // Block localhost variants
    let host_lower = host.to_lowercase();
    if host_lower == "localhost"
        || host_lower == "127.0.0.1"
        || host_lower == "::1"
        || host_lower == "[::1]"
        || host_lower == "0.0.0.0"
        || host_lower.ends_with(".localhost")
        || host_lower.ends_with(".local")
    {
        return Err("Localhost URLs are not allowed for webhooks".to_string());
    }

    // Try to parse as IP address and check for private ranges
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(&ip) {
            return Err(format!(
                "Private/internal IP addresses are not allowed: {}",
                ip
            ));
        }
    }

    // Also check if it's an IPv6 in brackets
    if host.starts_with('[') && host.ends_with(']') {
        let inner = &host[1..host.len() - 1];
        if let Ok(ip) = inner.parse::<IpAddr>() {
            if is_private_ip(&ip) {
                return Err(format!(
                    "Private/internal IP addresses are not allowed: {}",
                    ip
                ));
            }
        }
    }

    // Block internal domain patterns commonly used in cloud environments
    if host_lower.ends_with(".internal")
        || host_lower.ends_with(".lan")
        || host_lower.contains(".svc.cluster.local")
        || host_lower.starts_with("metadata.")
        || host_lower.contains("169.254.")
        || host_lower == "metadata.google.internal"
    {
        return Err(format!(
            "Internal/cloud metadata URLs are not allowed: {}",
            host
        ));
    }

    Ok(())
}

/// Check if an IP address is private/internal (RFC1918, link-local, loopback, etc.)
fn is_private_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ipv4) => {
            // Loopback (127.0.0.0/8)
            if ipv4.is_loopback() {
                return true;
            }
            // Private (RFC1918)
            if ipv4.is_private() {
                return true;
            }
            // Link-local (169.254.0.0/16 - AWS metadata, etc.)
            if ipv4.is_link_local() {
                return true;
            }
            // Broadcast
            if ipv4.is_broadcast() {
                return true;
            }
            // Unspecified (0.0.0.0)
            if ipv4.is_unspecified() {
                return true;
            }
            // Documentation (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24)
            if ipv4.is_documentation() {
                return true;
            }
            // Shared address space (100.64.0.0/10) - often used internally
            let octets = ipv4.octets();
            if octets[0] == 100 && (octets[1] >= 64 && octets[1] <= 127) {
                return true;
            }
            false
        }
        std::net::IpAddr::V6(ipv6) => {
            // Loopback (::1)
            if ipv6.is_loopback() {
                return true;
            }
            // Unspecified (::)
            if ipv6.is_unspecified() {
                return true;
            }
            // IPv4-mapped addresses (::ffff:x.x.x.x) - check the embedded IPv4
            if let Some(ipv4) = ipv6.to_ipv4_mapped() {
                return is_private_ip(&std::net::IpAddr::V4(ipv4));
            }
            // Unique local (fc00::/7)
            let segments = ipv6.segments();
            if (segments[0] & 0xfe00) == 0xfc00 {
                return true;
            }
            // Link-local (fe80::/10)
            if (segments[0] & 0xffc0) == 0xfe80 {
                return true;
            }
            false
        }
    }
}

/// HMAC-SHA256 for webhook signatures using proper crypto libraries.
fn hmac_sha256(key: &str, message: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    let mut mac =
        HmacSha256::new_from_slice(key.as_bytes()).expect("HMAC can take key of any size");
    mac.update(message.as_bytes());

    let result = mac.finalize();
    let bytes = result.into_bytes();

    // Convert to hex string
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
