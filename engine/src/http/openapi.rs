//! OpenAPI documentation for flashQ HTTP API.
//!
//! Generates Swagger/OpenAPI specification using utoipa.

use utoipa::OpenApi;

use crate::http::{cluster, cron, jobs, metrics, queues, settings, webhooks, workers};
use crate::protocol::{
    CronJob, Job, JobBrowserItem, JobEvent, JobInput, JobLogEntry, JobState, MetricsData,
    MetricsHistoryPoint, ProgressInfo, QueueInfo, QueueMetrics, WebhookConfig, WorkerInfo,
};

use super::types::{
    AckRequest, ChangePriorityRequest, CleanRequest, ConcurrencyRequest, CreateWebhookRequest,
    CronRequest, FailRequest, JobDetailResponse, MoveToDelayedRequest, ProgressRequest,
    RateLimitRequest, RetryDlqRequest, StatsResponse, WorkerHeartbeatRequest,
};

use super::settings::{
    AsyncWriterConfigRequest, CleanupSettingsRequest, DiskIoMetrics, ProcessMetrics,
    QueueDefaultsRequest, RestoreRequest, S3BackupInfo, S3BackupSettings, SaveAuthRequest,
    SaveS3SettingsRequest, ServerSettings, SqliteConfigRequest, SqliteSettings, SqliteStats,
    SystemMetrics,
};

use super::cluster::HealthResponse;
use crate::queue::monitoring::MemoryStats;

/// flashQ OpenAPI Documentation
#[derive(OpenApi)]
#[openapi(
    info(
        title = "flashQ API",
        version = "0.2.0",
        description = "High-performance job queue server",
        license(name = "MIT")
    ),
    tags(
        (name = "Jobs", description = "Job operations"),
        (name = "Queues", description = "Queue management"),
        (name = "Cron", description = "Scheduled/repeatable jobs"),
        (name = "Metrics", description = "Stats and metrics"),
        (name = "Webhooks", description = "Webhook management"),
        (name = "Workers", description = "Worker registration"),
        (name = "Events", description = "SSE/WebSocket events"),
        (name = "Settings", description = "Server configuration"),
        (name = "SQLite", description = "SQLite storage management"),
        (name = "S3", description = "S3 backup management"),
        (name = "System", description = "System metrics"),
        (name = "Health", description = "Health checks"),
        (name = "Debug", description = "Debug endpoints")
    ),
    paths(
        // Jobs
        jobs::list_jobs,
        jobs::get_job,
        jobs::ack_job,
        jobs::fail_job,
        jobs::cancel_job,
        jobs::update_progress,
        jobs::get_progress,
        jobs::get_result,
        jobs::change_priority,
        jobs::move_to_delayed,
        jobs::promote_job,
        jobs::discard_job,
        // Queues
        queues::list_queues,
        queues::push_job,
        queues::pull_jobs,
        queues::pause_queue,
        queues::resume_queue,
        queues::get_dlq,
        queues::retry_dlq,
        queues::set_rate_limit,
        queues::clear_rate_limit,
        queues::set_concurrency,
        queues::clear_concurrency,
        queues::drain_queue,
        queues::obliterate_queue,
        queues::clean_queue,
        // Cron
        cron::list_crons,
        cron::create_cron,
        cron::delete_cron,
        // Metrics
        metrics::get_stats,
        metrics::get_metrics,
        metrics::get_metrics_history,
        metrics::get_prometheus_metrics,
        // Webhooks
        webhooks::list_webhooks,
        webhooks::create_webhook,
        webhooks::delete_webhook,
        webhooks::incoming_webhook,
        // Workers
        workers::list_workers,
        workers::worker_heartbeat,
        // Settings
        settings::get_settings,
        settings::save_auth_settings,
        settings::save_queue_defaults,
        settings::save_cleanup_settings,
        settings::run_cleanup_now,
        settings::shutdown_server,
        settings::restart_server,
        settings::reset_server,
        settings::clear_all_queues,
        settings::clear_all_dlq,
        settings::clear_completed_jobs,
        settings::reset_metrics,
        // SQLite
        settings::get_sqlite_settings,
        settings::save_sqlite_settings,
        settings::get_sqlite_stats,
        settings::export_sqlite_database,
        settings::download_sqlite_database,
        settings::restore_sqlite_database,
        settings::update_async_writer_config,
        // S3
        settings::get_s3_settings,
        settings::save_s3_settings,
        settings::test_s3_connection,
        settings::trigger_s3_backup,
        settings::list_s3_backups,
        settings::restore_s3_backup,
        // System
        settings::get_system_metrics,
        // Health
        cluster::health_check,
        // Debug
        debug_memory_stats,
    ),
    components(schemas(
        // Protocol types
        Job,
        JobState,
        JobBrowserItem,
        JobLogEntry,
        JobInput,
        JobEvent,
        CronJob,
        QueueInfo,
        QueueMetrics,
        MetricsData,
        MetricsHistoryPoint,
        ProgressInfo,
        WorkerInfo,
        WebhookConfig,
        // HTTP types
        AckRequest,
        FailRequest,
        ProgressRequest,
        CronRequest,
        RateLimitRequest,
        ConcurrencyRequest,
        CleanRequest,
        ChangePriorityRequest,
        MoveToDelayedRequest,
        WorkerHeartbeatRequest,
        CreateWebhookRequest,
        RetryDlqRequest,
        JobDetailResponse,
        StatsResponse,
        // Settings types
        ServerSettings,
        SqliteSettings,
        S3BackupSettings,
        SaveAuthRequest,
        QueueDefaultsRequest,
        CleanupSettingsRequest,
        SqliteConfigRequest,
        SqliteStats,
        AsyncWriterConfigRequest,
        SaveS3SettingsRequest,
        S3BackupInfo,
        RestoreRequest,
        SystemMetrics,
        ProcessMetrics,
        DiskIoMetrics,
        HealthResponse,
        MemoryStats,
    ))
)]
pub struct ApiDoc;

/// Debug endpoint for memory statistics (for OpenAPI path registration)
#[utoipa::path(
    get,
    path = "/debug/memory",
    tag = "Debug",
    responses(
        (status = 200, description = "Memory statistics", body = MemoryStats)
    )
)]
pub async fn debug_memory_stats(
    axum::extract::State(qm): axum::extract::State<super::types::AppState>,
) -> axum::Json<MemoryStats> {
    axum::Json(qm.memory_stats())
}
