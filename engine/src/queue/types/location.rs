//! Job location index for O(1) state lookup.

use crate::protocol::JobState;

/// Job location - avoids scanning all shards for state lookup
#[derive(Debug, Clone, Copy)]
pub enum JobLocation {
    /// Job is in a queue (waiting or delayed)
    Queue { shard_idx: usize },
    /// Job is being processed
    Processing,
    /// Job is in DLQ
    Dlq { shard_idx: usize },
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
    pub fn to_state(self, run_at: u64, now: u64) -> JobState {
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
}
