//! Stats and metrics HTTP handlers.

use axum::{
    extract::State,
    response::{IntoResponse, Json},
};

use crate::protocol::{MetricsData, MetricsHistoryPoint};

use super::types::{ApiResponse, AppState, StatsResponse};

/// Get queue statistics.
pub async fn get_stats(State(qm): State<AppState>) -> Json<ApiResponse<StatsResponse>> {
    let (queued, processing, delayed, dlq) = qm.stats().await;
    ApiResponse::success(StatsResponse {
        queued,
        processing,
        delayed,
        dlq,
    })
}

/// Get detailed metrics.
pub async fn get_metrics(State(qm): State<AppState>) -> Json<ApiResponse<MetricsData>> {
    let metrics = qm.get_metrics().await;
    ApiResponse::success(metrics)
}

/// Get metrics history.
pub async fn get_metrics_history(
    State(qm): State<AppState>,
) -> Json<ApiResponse<Vec<MetricsHistoryPoint>>> {
    let history = qm.get_metrics_history();
    ApiResponse::success(history)
}

/// Get Prometheus-formatted metrics.
pub async fn get_prometheus_metrics(State(qm): State<AppState>) -> impl IntoResponse {
    let metrics = qm.get_metrics().await;
    let (queued, processing, delayed, dlq) = qm.stats().await;

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
