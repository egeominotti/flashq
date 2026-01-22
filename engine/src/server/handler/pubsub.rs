//! Pub/Sub command handlers.

use std::sync::Arc;

use crate::protocol::{Command, Response};
use crate::queue::QueueManager;

/// Handle Pub/Sub commands
pub fn handle_pubsub_command(command: Command, queue_manager: &Arc<QueueManager>) -> Response {
    match command {
        Command::Pub { channel, message } => {
            let receivers = queue_manager.pubsub.publish(&channel, message);
            Response::pub_count(receivers)
        }
        Command::Sub { channels } => {
            let _rx = queue_manager.pubsub.subscribe(channels.clone());
            Response::pub_subscribed(channels)
        }
        Command::Psub { patterns } => {
            let _rx = queue_manager.pubsub.psubscribe(patterns.clone());
            Response::pub_subscribed(patterns)
        }
        Command::Unsub { channels } => Response::pub_subscribed(channels),
        Command::Punsub { patterns } => Response::pub_subscribed(patterns),
        Command::PubsubChannels { pattern } => {
            let channels = queue_manager.pubsub.channels(pattern.as_deref());
            Response::pub_channels(channels)
        }
        Command::PubsubNumsub { channels } => {
            let counts = queue_manager.pubsub.numsub(&channels);
            Response::pub_numsub(counts)
        }
        _ => Response::error("Not a Pub/Sub command"),
    }
}

/// Check if a command is a Pub/Sub command
#[inline]
pub fn is_pubsub_command(command: &Command) -> bool {
    matches!(
        command,
        Command::Pub { .. }
            | Command::Sub { .. }
            | Command::Psub { .. }
            | Command::Unsub { .. }
            | Command::Punsub { .. }
            | Command::PubsubChannels { .. }
            | Command::PubsubNumsub { .. }
    )
}
