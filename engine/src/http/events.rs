//! Server-Sent Events (SSE) HTTP handlers.

use std::convert::Infallible;

use axum::{
    extract::{Path, Query, State},
    response::sse::{Event, KeepAlive, Sse},
};
use futures::stream::{Stream, StreamExt};
use serde::Deserialize;

use super::types::AppState;

/// Query parameters for job event subscription.
#[derive(Debug, Deserialize)]
pub struct JobEventsQuery {
    /// Filter by event types (comma-separated: "partial,progress,completed,failed")
    #[serde(default)]
    pub events: Option<String>,
}

/// SSE stream for all job events.
pub async fn sse_events(
    State(qm): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = qm.subscribe_events(None);
    let stream = tokio_stream::wrappers::BroadcastStream::new(rx).filter_map(
        |result: Result<crate::protocol::JobEvent, _>| async move {
            result.ok().map(|event| {
                Ok(Event::default()
                    .event(&event.event_type)
                    .json_data(&event)
                    .unwrap_or_default())
            })
        },
    );

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// SSE stream for queue-specific events.
pub async fn sse_queue_events(
    State(qm): State<AppState>,
    Path(queue): Path<String>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = qm.subscribe_events(Some(queue.clone()));
    let stream = tokio_stream::wrappers::BroadcastStream::new(rx).filter_map(
        move |result: Result<crate::protocol::JobEvent, _>| {
            let queue = queue.clone();
            async move {
                result.ok().and_then(|event| {
                    if event.queue == queue {
                        Some(Ok(Event::default()
                            .event(&event.event_type)
                            .json_data(&event)
                            .unwrap_or_default()))
                    } else {
                        None
                    }
                })
            }
        },
    );

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// SSE stream for a specific job's events (partial results, progress, completion).
/// Use this to subscribe to streaming updates from a single job.
pub async fn sse_job_events(
    State(qm): State<AppState>,
    Path(job_id): Path<u64>,
    Query(query): Query<JobEventsQuery>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Parse event filter
    let event_filter: Option<Vec<String>> = query.events.map(|e| {
        e.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    });

    let rx = qm.subscribe_events(None);
    let stream = tokio_stream::wrappers::BroadcastStream::new(rx).filter_map(
        move |result: Result<crate::protocol::JobEvent, _>| {
            let event_filter = event_filter.clone();
            async move {
                result.ok().and_then(|event| {
                    // Filter by job_id
                    if event.job_id != job_id {
                        return None;
                    }

                    // Filter by event type if specified
                    if let Some(ref filter) = event_filter {
                        if !filter.contains(&event.event_type) {
                            return None;
                        }
                    }

                    Some(Ok(Event::default()
                        .event(&event.event_type)
                        .json_data(&event)
                        .unwrap_or_default()))
                })
            }
        },
    );

    Sse::new(stream).keep_alive(KeepAlive::default())
}
