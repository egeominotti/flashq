//! Command processing - handles all protocol commands.

use std::sync::Arc;

use crate::protocol::{Command, JobInput, JobState, Response};
use crate::queue::QueueManager;

use super::kv::{handle_kv_command, is_kv_command};
use super::ok_or_error;
use super::pubsub::{handle_pubsub_command, is_pubsub_command};

/// Process a single command and return the response
pub async fn process_command(command: Command, queue_manager: &Arc<QueueManager>) -> Response {
    // Handle KV commands
    if is_kv_command(&command) {
        return handle_kv_command(command, queue_manager);
    }

    // Handle Pub/Sub commands
    if is_pubsub_command(&command) {
        return handle_pubsub_command(command, queue_manager);
    }

    match command {
        // === Core Commands ===
        Command::Push {
            queue,
            data,
            priority,
            delay,
            ttl,
            timeout,
            max_attempts,
            backoff,
            unique_key,
            depends_on,
            tags,
            lifo,
            remove_on_complete,
            remove_on_fail,
            stall_timeout,
            debounce_id,
            debounce_ttl,
            job_id,
            keep_completed_age,
            keep_completed_count,
            group_id,
        } => {
            let input = JobInput {
                data,
                priority,
                delay,
                ttl,
                timeout,
                max_attempts,
                backoff,
                unique_key,
                depends_on,
                tags,
                lifo,
                remove_on_complete,
                remove_on_fail,
                stall_timeout,
                debounce_id,
                debounce_ttl,
                job_id,
                keep_completed_age,
                keep_completed_count,
                group_id,
            };
            match queue_manager.push(queue, input).await {
                Ok(job) => Response::ok_with_id(job.id),
                Err(e) => Response::error(e),
            }
        }
        Command::Pushb { queue, jobs } => {
            let ids = queue_manager.push_batch(queue, jobs).await;
            Response::batch(ids)
        }
        Command::Pull { queue, timeout } => {
            let timeout_ms = timeout.unwrap_or(60_000);
            match tokio::time::timeout(
                tokio::time::Duration::from_millis(timeout_ms),
                queue_manager.pull(&queue),
            )
            .await
            {
                Ok(job) => Response::job(job),
                Err(_) => Response::null_job(),
            }
        }
        Command::Pullb {
            queue,
            count,
            timeout,
        } => {
            let timeout_ms = timeout.unwrap_or(60_000);
            match tokio::time::timeout(
                tokio::time::Duration::from_millis(timeout_ms),
                queue_manager.pull_batch(&queue, count),
            )
            .await
            {
                Ok(jobs) => Response::jobs(jobs),
                Err(_) => Response::jobs(vec![]),
            }
        }
        Command::Ack { id, result } => ok_or_error!(queue_manager.ack(id, result).await),
        Command::Ackb { ids } => Response::batch(vec![queue_manager.ack_batch(&ids).await as u64]),
        Command::Fail { id, error } => ok_or_error!(queue_manager.fail(id, error).await),
        Command::GetResult { id } => Response::result(id, queue_manager.get_result(id).await),
        Command::GetJob { id } => {
            let (job, state) = queue_manager.get_job(id);
            Response::job_with_state(job, state)
        }
        Command::GetState { id } => Response::state(id, queue_manager.get_state(id)),
        Command::WaitJob { id, timeout } => match queue_manager.wait_for_job(id, timeout).await {
            Ok(result) => Response::JobResult {
                ok: true,
                result,
                error: None,
            },
            Err(e) => Response::JobResult {
                ok: false,
                result: None,
                error: Some(e),
            },
        },
        Command::GetJobByCustomId { job_id } => match queue_manager.get_job_by_custom_id(&job_id) {
            Some((job, state)) => Response::JobWithState {
                ok: true,
                job: Some(job),
                state,
            },
            None => Response::JobWithState {
                ok: true,
                job: None,
                state: JobState::Unknown,
            },
        },

        // === Job Management Commands ===
        Command::Cancel { id } => ok_or_error!(queue_manager.cancel(id).await),
        Command::Progress {
            id,
            progress,
            message,
        } => ok_or_error!(queue_manager.update_progress(id, progress, message).await),
        Command::GetProgress { id } => match queue_manager.get_progress(id).await {
            Ok((progress, message)) => Response::progress(id, progress, message),
            Err(e) => Response::error(e),
        },
        Command::Dlq { queue, count } => Response::jobs(queue_manager.get_dlq(&queue, count).await),
        Command::RetryDlq { queue, id } => {
            Response::batch(vec![queue_manager.retry_dlq(&queue, id).await as u64])
        }
        Command::PurgeDlq { queue } => Response::count(queue_manager.purge_dlq(&queue).await),
        Command::GetJobsBatch { ids } => {
            Response::jobs_batch(queue_manager.get_jobs_batch(&ids).await)
        }
        Command::Subscribe { queue, events } => {
            let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
            queue_manager.subscribe(queue, events, tx);
            Response::ok()
        }
        Command::Unsubscribe { queue } => {
            queue_manager.unsubscribe(&queue);
            Response::ok()
        }
        Command::Metrics => {
            let metrics = queue_manager.get_metrics().await;
            Response::metrics(metrics)
        }
        Command::Stats => {
            let (queued, processing, delayed, dlq, completed) = queue_manager.stats().await;
            Response::stats(queued, processing, delayed, dlq, completed)
        }

        // === Cron Jobs ===
        Command::Cron {
            name,
            queue,
            data,
            schedule,
            repeat_every,
            priority,
            limit,
        } => ok_or_error!(
            queue_manager
                .add_cron_with_repeat(name, queue, data, schedule, repeat_every, priority, limit)
                .await
        ),
        Command::CronDelete { name } => {
            if queue_manager.delete_cron(&name).await {
                Response::ok()
            } else {
                Response::error("Cron job not found")
            }
        }
        Command::CronList => {
            let crons = queue_manager.list_crons().await;
            Response::cron_list(crons)
        }

        // === Rate Limiting & Queue Control ===
        Command::RateLimit { queue, limit } => {
            queue_manager.set_rate_limit(queue, limit).await;
            Response::ok()
        }
        Command::RateLimitClear { queue } => {
            queue_manager.clear_rate_limit(&queue).await;
            Response::ok()
        }
        Command::Pause { queue } => {
            queue_manager.pause(&queue).await;
            Response::ok()
        }
        Command::Resume { queue } => {
            queue_manager.resume(&queue).await;
            Response::ok()
        }
        Command::SetConcurrency { queue, limit } => {
            queue_manager.set_concurrency(queue, limit).await;
            Response::ok()
        }
        Command::ClearConcurrency { queue } => {
            queue_manager.clear_concurrency(&queue).await;
            Response::ok()
        }
        Command::ListQueues => {
            let queues = queue_manager.list_queues().await;
            Response::queues(queues)
        }

        // === Job Logs & Heartbeat ===
        Command::Log { id, message, level } => {
            ok_or_error!(queue_manager.add_job_log(id, message, level))
        }
        Command::GetLogs { id } => {
            let logs = queue_manager.get_job_logs(id);
            Response::logs(id, logs)
        }
        Command::Heartbeat { id } => ok_or_error!(queue_manager.heartbeat(id)),

        // === Flows ===
        Command::Flow {
            queue,
            data,
            children,
            priority,
        } => match queue_manager
            .push_flow(queue, data, children, priority)
            .await
        {
            Ok((parent_id, children_ids)) => Response::flow(parent_id, children_ids),
            Err(e) => Response::error(e),
        },
        Command::GetChildren { parent_id } => match queue_manager.get_children(parent_id) {
            Some((children, completed, total)) => {
                Response::children(parent_id, children, completed, total)
            }
            None => Response::error(format!("Parent job {} not found", parent_id)),
        },

        // === BullMQ Advanced ===
        Command::GetJobs {
            queue,
            state,
            limit,
            offset,
        } => {
            let state_filter = state.as_deref().and_then(JobState::from_str);
            let (jobs, total) = queue_manager.get_jobs(
                queue.as_deref(),
                state_filter,
                limit.unwrap_or(100),
                offset.unwrap_or(0),
            );
            Response::jobs_with_total(jobs, total)
        }
        Command::Clean {
            queue,
            grace,
            state,
            limit,
        } => {
            let state_enum = match state.to_lowercase().as_str() {
                "waiting" => JobState::Waiting,
                "delayed" => JobState::Delayed,
                "completed" => JobState::Completed,
                "failed" => JobState::Failed,
                _ => {
                    return Response::error(
                        "Invalid state. Use: waiting, delayed, completed, failed",
                    )
                }
            };
            let count = queue_manager.clean(&queue, grace, state_enum, limit).await;
            Response::count(count)
        }
        Command::Drain { queue } => {
            let count = queue_manager.drain(&queue).await;
            Response::count(count)
        }
        Command::Obliterate { queue } => {
            let count = queue_manager.obliterate(&queue).await;
            Response::count(count)
        }
        Command::ChangePriority { id, priority } => {
            ok_or_error!(queue_manager.change_priority(id, priority).await)
        }
        Command::MoveToDelayed { id, delay } => {
            ok_or_error!(queue_manager.move_to_delayed(id, delay).await)
        }
        Command::Promote { id } => ok_or_error!(queue_manager.promote(id).await),
        Command::UpdateJob { id, data } => {
            ok_or_error!(queue_manager.update_job_data(id, data).await)
        }
        Command::Discard { id } => ok_or_error!(queue_manager.discard(id).await),
        Command::IsPaused { queue } => {
            let paused = queue_manager.is_paused(&queue);
            Response::paused(paused)
        }
        Command::Count { queue } => {
            let count = queue_manager.count(&queue);
            Response::count(count)
        }
        Command::GetJobCounts { queue } => {
            let (waiting, active, delayed, completed, failed) =
                queue_manager.get_job_counts(&queue);
            Response::job_counts(waiting, active, delayed, completed, failed)
        }

        // Auth already handled in process_request
        Command::Auth { .. } => Response::ok(),

        // KV and PubSub handled above
        _ => Response::error("Unknown command"),
    }
}
