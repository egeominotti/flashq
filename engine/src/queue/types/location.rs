//! Job location index for O(1) state lookup.

use compact_str::CompactString;

use crate::protocol::JobState;

/// Job location - avoids scanning all shards for state lookup.
/// Includes queue_name for O(1) direct lookup instead of O(n) queue iteration.
#[derive(Debug, Clone)]
pub enum JobLocation {
    /// Job is in a queue (waiting or delayed) - includes queue name for O(1) lookup
    Queue {
        shard_idx: usize,
        queue_name: CompactString,
    },
    /// Job is being processed
    Processing,
    /// Job is in DLQ - includes queue name for O(1) lookup
    Dlq {
        shard_idx: usize,
        queue_name: CompactString,
    },
    /// Job is waiting for dependencies
    WaitingDeps { shard_idx: usize },
    /// Parent job waiting for children to complete (Flows)
    WaitingChildren { shard_idx: usize },
    /// Job completed (may have result stored)
    Completed,
}

impl JobLocation {
    /// Convert location to JobState, checking delayed status if needed
    #[inline]
    pub fn to_state(&self, run_at: u64, now: u64) -> JobState {
        match self {
            JobLocation::Queue { .. } => {
                if run_at > now {
                    JobState::Delayed
                } else {
                    JobState::Waiting
                }
            }
            JobLocation::Processing => JobState::Active,
            JobLocation::Dlq { .. } => JobState::Failed,
            JobLocation::WaitingDeps { .. } => JobState::WaitingChildren,
            JobLocation::WaitingChildren { .. } => JobState::WaitingParent,
            JobLocation::Completed => JobState::Completed,
        }
    }

    /// Get the shard index if this location has one
    #[inline]
    #[allow(dead_code)]
    pub fn shard_idx(&self) -> Option<usize> {
        match self {
            JobLocation::Queue { shard_idx, .. } => Some(*shard_idx),
            JobLocation::Dlq { shard_idx, .. } => Some(*shard_idx),
            JobLocation::WaitingDeps { shard_idx } => Some(*shard_idx),
            JobLocation::WaitingChildren { shard_idx } => Some(*shard_idx),
            JobLocation::Processing | JobLocation::Completed => None,
        }
    }
}
