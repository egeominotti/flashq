//! Server-Sent Events (SSE) HTTP handlers.

use std::convert::Infallible;

use axum::{
    extract::{Path, State},
    response::sse::{Event, KeepAlive, Sse},
};
use futures::stream::{Stream, StreamExt};

use super::types::AppState;

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
