//! Timeout and dependency checking.

use super::super::manager::QueueManager;
use super::super::types::{intern, JobLocation};

impl QueueManager {
    pub(crate) async fn check_timed_out_jobs(&self) {
        let now = Self::now_ms();
        let mut timed_out = Vec::new();

        self.processing_iter(|job| {
            if job.is_timed_out(now) {
                timed_out.push(job.id);
            }
        });

        for job_id in timed_out {
            if let Some(mut job) = self.processing_remove(job_id) {
                let idx = Self::shard_index(&job.queue);
                let queue_arc = intern(&job.queue);
                {
                    let mut shard = self.shards[idx].write();
                    let state = shard.get_state(&queue_arc);
                    if let Some(ref mut conc) = state.concurrency {
                        conc.release();
                    }
                }

                job.attempts += 1;

                if job.should_go_to_dlq() {
                    self.notify_subscribers("timeout", &job.queue, &job);
                    self.index_job(job_id, JobLocation::Dlq { shard_idx: idx });
                    self.persist_dlq(&job, Some("Job timed out"));
                    self.metrics.record_timeout();
                    self.metrics.record_dlq();
                    self.shards[idx]
                        .write()
                        .dlq
                        .entry(queue_arc)
                        .or_default()
                        .push_back(job);
                } else {
                    let backoff = job.next_backoff();
                    let new_run_at = if backoff > 0 {
                        now + backoff
                    } else {
                        job.run_at
                    };
                    job.run_at = new_run_at;
                    job.started_at = 0;
                    job.progress_msg = Some("Job timed out".to_string());

                    self.index_job(job_id, JobLocation::Queue { shard_idx: idx });
                    self.persist_fail(job_id, new_run_at, job.attempts);
                    self.metrics.record_retry();
                    self.shards[idx]
                        .write()
                        .queues
                        .entry(queue_arc)
                        .or_default()
                        .push(job);
                    self.notify_shard(idx);
                }
            }
        }
    }

    pub(crate) async fn check_dependencies(&self) {
        // CRITICAL: Read completed_jobs FIRST to avoid lock ordering deadlock.
        let completed: std::collections::HashSet<u64> =
            self.completed_jobs.read().iter().copied().collect();

        if completed.is_empty() {
            return;
        }

        for (idx, shard) in self.shards.iter().enumerate() {
            let mut shard_w = shard.write();

            let ready_ids: Vec<u64> = shard_w
                .waiting_deps
                .iter()
                .filter(|(_, job)| job.depends_on.iter().all(|dep| completed.contains(dep)))
                .map(|(&id, _)| id)
                .collect();

            if ready_ids.is_empty() {
                continue;
            }

            for job_id in ready_ids {
                if let Some(job) = shard_w.waiting_deps.remove(&job_id) {
                    let queue_arc = intern(&job.queue);
                    shard_w.queues.entry(queue_arc).or_default().push(job);
                }
            }
            drop(shard_w);
            self.notify_shard(idx);
        }
    }
}
