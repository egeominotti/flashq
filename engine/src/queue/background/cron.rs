//! Cron job execution and validation.

use chrono::{DateTime, Utc};
use croner::Cron;

use super::super::manager::QueueManager;
impl QueueManager {
    pub(crate) async fn run_cron_jobs(&self) {
        let now = Self::now_ms();
        let mut to_run = Vec::new();
        let mut next_run_updates = Vec::new();
        let mut to_remove = Vec::new();

        {
            let mut crons = self.cron_jobs.write();
            for cron in crons.values_mut() {
                if cron.next_run <= now {
                    if let Some(limit) = cron.limit {
                        if cron.executions >= limit {
                            to_remove.push(cron.name.clone());
                            continue;
                        }
                    }

                    to_run.push((cron.queue.clone(), cron.data.clone(), cron.priority));
                    cron.executions += 1;

                    let new_next_run = if let Some(interval) = cron.repeat_every {
                        now + interval
                    } else if let Some(ref schedule) = cron.schedule {
                        Self::parse_next_cron_run(schedule, now)
                    } else {
                        now + 60_000
                    };
                    cron.next_run = new_next_run;
                    next_run_updates.push((cron.name.clone(), new_next_run));
                }
            }

            for name in &to_remove {
                crons.remove(name);
            }
        }

        for (name, next_run) in next_run_updates {
            self.persist_cron_next_run(&name, next_run);
        }

        for name in to_remove {
            self.persist_cron_delete(&name);
        }

        for (queue, data, priority) in to_run {
            let input = crate::protocol::JobInput::new(data).with_priority(priority);
            let _ = self.push(queue, input).await;
        }
    }

    pub(crate) fn parse_next_cron_run(schedule: &str, now: u64) -> u64 {
        if let Some(interval_str) = schedule.strip_prefix("*/") {
            if let Ok(secs) = interval_str.parse::<u64>() {
                return now + secs * 1000;
            }
        }

        if let Ok(cron) = Cron::new(schedule).with_seconds_optional().parse() {
            let now_secs = (now / 1000) as i64;
            if let Some(now_dt) = DateTime::<Utc>::from_timestamp(now_secs, 0) {
                if let Ok(next) = cron.find_next_occurrence(&now_dt, false) {
                    return (next.timestamp() as u64) * 1000;
                }
            }
        }

        now + 60_000
    }

    const MAX_CRON_SCHEDULE_LENGTH: usize = 256;

    pub(crate) fn validate_cron(schedule: &str) -> Result<(), String> {
        if schedule.len() > Self::MAX_CRON_SCHEDULE_LENGTH {
            return Err(format!(
                "Cron schedule too long ({} chars, max {} chars)",
                schedule.len(),
                Self::MAX_CRON_SCHEDULE_LENGTH
            ));
        }

        if let Some(interval_str) = schedule.strip_prefix("*/") {
            return interval_str
                .parse::<u64>()
                .map(|_| ())
                .map_err(|_| format!("Invalid interval format: {}", schedule));
        }

        Cron::new(schedule)
            .with_seconds_optional()
            .parse()
            .map(|_| ())
            .map_err(|e| format!("Invalid cron expression '{}': {}", schedule, e))
    }
}
