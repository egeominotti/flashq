//! Stats and metrics HTTP handlers.

use axum::{
    extract::State,
    response::{IntoResponse, Json},
};

use crate::protocol::{MetricsData, MetricsHistoryPoint};

use super::types::{ApiResponse, AppState, StatsResponse};

/// Get queue statistics.
///
/// Returns aggregate job counts across all queues. Lightweight endpoint
/// for quick health checks and dashboard summaries.
#[utoipa::path(
    get,
    path = "/stats",
    tag = "Metrics",
    summary = "Get aggregate job counts",
    description = "Returns total job counts by state across all queues: queued (waiting), processing (active), delayed, dlq (failed), completed. Fast O(1) lookup from cached counters. Use for dashboard summaries and health monitoring.",
    responses(
        (status = 200, description = "Aggregate job counts by state", body = StatsResponse)
    )
)]
pub async fn get_stats(State(qm): State<AppState>) -> Json<ApiResponse<StatsResponse>> {
    let (queued, processing, delayed, dlq, completed) = qm.stats().await;
    ApiResponse::success(StatsResponse {
        queued,
        processing,
        delayed,
        dlq,
        completed,
    })
}

/// Get detailed metrics.
///
/// Returns comprehensive metrics including throughput, latency, error rates,
/// and per-queue breakdowns. Use for detailed monitoring and alerting.
#[utoipa::path(
    get,
    path = "/metrics",
    tag = "Metrics",
    summary = "Get comprehensive metrics",
    description = "Returns detailed metrics: total pushed/completed/failed, jobs per second throughput, average processing latency (ms), per-queue breakdowns with pending/processing/dlq counts. Updated every 5 seconds. Use for monitoring dashboards and alerting systems.",
    responses(
        (status = 200, description = "Detailed metrics with throughput and per-queue data", body = MetricsData)
    )
)]
pub async fn get_metrics(State(qm): State<AppState>) -> Json<ApiResponse<MetricsData>> {
    let metrics = qm.get_metrics().await;
    ApiResponse::success(metrics)
}

/// Get metrics history.
///
/// Returns historical metrics data points for graphing trends over time.
/// Data is collected every 5 seconds and retained for the session.
#[utoipa::path(
    get,
    path = "/metrics/history",
    tag = "Metrics",
    summary = "Get historical metrics data",
    description = "Returns time-series metrics for graphing. Each point includes: timestamp, throughput, latency, and job counts. Collected every 5 seconds, retained in memory for the session. Use for trend charts, graphs, and historical analysis in dashboards.",
    responses(
        (status = 200, description = "Time-series metrics for charting", body = Vec<MetricsHistoryPoint>)
    )
)]
pub async fn get_metrics_history(
    State(qm): State<AppState>,
) -> Json<ApiResponse<Vec<MetricsHistoryPoint>>> {
    let history = qm.get_metrics_history();
    ApiResponse::success(history)
}

/// Get Prometheus-formatted metrics.
///
/// Returns metrics in Prometheus text exposition format for scraping.
/// Includes job counters, gauges, throughput, latency, and per-queue metrics.
#[utoipa::path(
    get,
    path = "/metrics/prometheus",
    tag = "Metrics",
    summary = "Get Prometheus-format metrics",
    description = "Returns metrics in Prometheus exposition format for scraping by Prometheus/Grafana. Includes: flashq_jobs_pushed_total, flashq_jobs_completed_total, flashq_jobs_failed_total (counters), flashq_jobs_current by state (gauge), flashq_throughput_per_second, flashq_latency_ms, flashq_queue_jobs by queue/state, flashq_workers_active.",
    responses(
        (status = 200, description = "Prometheus text format metrics", content_type = "text/plain")
    )
)]
pub async fn get_prometheus_metrics(State(qm): State<AppState>) -> impl IntoResponse {
    let metrics = qm.get_metrics().await;
    let (queued, processing, delayed, dlq, completed) = qm.stats().await;

    let mut output = String::with_capacity(2048);

    // Global metrics
    output.push_str("# HELP flashq_jobs_total Total number of jobs\n");
    output.push_str("# TYPE flashq_jobs_total counter\n");
    output.push_str(&format!(
        "flashq_jobs_pushed_total {}\n",
        metrics.total_pushed
    ));
    output.push_str(&format!(
        "flashq_jobs_completed_total {}\n",
        metrics.total_completed
    ));
    output.push_str(&format!(
        "flashq_jobs_failed_total {}\n",
        metrics.total_failed
    ));

    output.push_str("# HELP flashq_jobs_current Current number of jobs by state\n");
    output.push_str("# TYPE flashq_jobs_current gauge\n");
    output.push_str(&format!(
        "flashq_jobs_current{{state=\"queued\"}} {}\n",
        queued
    ));
    output.push_str(&format!(
        "flashq_jobs_current{{state=\"processing\"}} {}\n",
        processing
    ));
    output.push_str(&format!(
        "flashq_jobs_current{{state=\"delayed\"}} {}\n",
        delayed
    ));
    output.push_str(&format!("flashq_jobs_current{{state=\"dlq\"}} {}\n", dlq));
    output.push_str(&format!(
        "flashq_jobs_current{{state=\"completed\"}} {}\n",
        completed
    ));

    output.push_str("# HELP flashq_throughput_per_second Jobs processed per second\n");
    output.push_str("# TYPE flashq_throughput_per_second gauge\n");
    output.push_str(&format!(
        "flashq_throughput_per_second {:.2}\n",
        metrics.jobs_per_second
    ));

    output.push_str("# HELP flashq_latency_ms Average job latency in milliseconds\n");
    output.push_str("# TYPE flashq_latency_ms gauge\n");
    output.push_str(&format!(
        "flashq_latency_ms {:.2}\n",
        metrics.avg_latency_ms
    ));

    // Per-queue metrics
    output.push_str("# HELP flashq_queue_jobs Queue job counts\n");
    output.push_str("# TYPE flashq_queue_jobs gauge\n");
    for q in &metrics.queues {
        // Sanitize queue name for Prometheus labels (escape backslashes and quotes)
        let safe_name = q.name.replace('\\', "\\\\").replace('"', "\\\"");
        output.push_str(&format!(
            "flashq_queue_jobs{{queue=\"{}\",state=\"pending\"}} {}\n",
            safe_name, q.pending
        ));
        output.push_str(&format!(
            "flashq_queue_jobs{{queue=\"{}\",state=\"processing\"}} {}\n",
            safe_name, q.processing
        ));
        output.push_str(&format!(
            "flashq_queue_jobs{{queue=\"{}\",state=\"dlq\"}} {}\n",
            safe_name, q.dlq
        ));
    }

    // Workers
    let workers = qm.list_workers().await;
    output.push_str("# HELP flashq_workers_active Number of active workers\n");
    output.push_str("# TYPE flashq_workers_active gauge\n");
    output.push_str(&format!("flashq_workers_active {}\n", workers.len()));

    (
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        output,
    )
}
