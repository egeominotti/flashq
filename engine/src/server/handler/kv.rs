//! Key-Value storage command handlers.

use std::sync::Arc;

use crate::protocol::{Command, Response};
use crate::queue::QueueManager;

use super::ok_or_error;

/// Handle KV storage commands
pub fn handle_kv_command(command: Command, queue_manager: &Arc<QueueManager>) -> Response {
    match command {
        Command::KvSet { key, value, ttl } => ok_or_error!(queue_manager.kv_set(key, value, ttl)),
        Command::KvGet { key } => {
            let value = queue_manager.kv_get(&key);
            Response::kv_value(value)
        }
        Command::KvDel { key } => {
            let deleted = queue_manager.kv_del(&key);
            Response::kv_exists(deleted)
        }
        Command::KvMget { keys } => {
            let values = queue_manager.kv_mget(&keys);
            Response::kv_values(values)
        }
        Command::KvMset { entries } => {
            let entries_vec: Vec<_> = entries
                .into_iter()
                .map(|e| (e.key, e.value, e.ttl))
                .collect();
            match queue_manager.kv_mset(entries_vec) {
                Ok(count) => Response::count(count),
                Err(e) => Response::error(e),
            }
        }
        Command::KvExists { key } => {
            let exists = queue_manager.kv_exists(&key);
            Response::kv_exists(exists)
        }
        Command::KvExpire { key, ttl } => {
            let success = queue_manager.kv_expire(&key, ttl);
            Response::kv_exists(success)
        }
        Command::KvTtl { key } => {
            let ttl = queue_manager.kv_ttl(&key);
            Response::kv_ttl(ttl)
        }
        Command::KvKeys { pattern } => {
            let keys = queue_manager.kv_keys(pattern.as_deref());
            Response::kv_keys(keys)
        }
        Command::KvIncr { key, by } => match queue_manager.kv_incr(&key, by) {
            Ok(value) => Response::kv_incr(value),
            Err(e) => Response::error(e),
        },
        _ => Response::error("Not a KV command"),
    }
}

/// Check if a command is a KV command
#[inline]
pub fn is_kv_command(command: &Command) -> bool {
    matches!(
        command,
        Command::KvSet { .. }
            | Command::KvGet { .. }
            | Command::KvDel { .. }
            | Command::KvMget { .. }
            | Command::KvMset { .. }
            | Command::KvExists { .. }
            | Command::KvExpire { .. }
            | Command::KvTtl { .. }
            | Command::KvKeys { .. }
            | Command::KvIncr { .. }
    )
}
