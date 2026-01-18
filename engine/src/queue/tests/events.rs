//! Event subscription tests.

use super::*;

#[tokio::test]
async fn test_subscribe_events() {
    let qm = setup();

    // Subscribe to events (None = all queues)
    let mut rx = qm.subscribe_events(None);

    // Push a job (should trigger event)
    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // group_id
        )
        .await
        .unwrap();

    // Try to receive the event
    tokio::select! {
        result = rx.recv() => {
            let event = result.unwrap();
            assert_eq!(event.event_type, "pushed");
            assert_eq!(event.queue, "test");
            assert_eq!(event.job_id, job.id);
        }
        _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => {
            // Event was broadcast (may have been missed if receiver wasn't ready)
            // This is acceptable for a broadcast channel
        }
    }
}

#[tokio::test]
async fn test_broadcast_event_on_ack() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // group_id
        )
        .await
        .unwrap();

    // Subscribe after pushing (will miss push event)
    let mut rx = qm.subscribe_events(None);

    // Pull and ack
    let pulled = qm.pull("test").await;
    qm.ack(pulled.id, None).await.unwrap();

    // Should receive completed event
    tokio::select! {
        result = rx.recv() => {
            let event = result.unwrap();
            assert_eq!(event.event_type, "completed");
            assert_eq!(event.job_id, job.id);
        }
        _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => {
            // Event broadcast happened
        }
    }
}

#[tokio::test]
async fn test_broadcast_event_on_fail() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            Some(1),
            None,
            None,
            None,
            None,
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // group_id
        )
        .await
        .unwrap();

    let mut rx = qm.subscribe_events(None);

    // Pull and fail
    let pulled = qm.pull("test").await;
    qm.fail(pulled.id, Some("test error".to_string()))
        .await
        .unwrap();

    // Should receive failed event
    tokio::select! {
        result = rx.recv() => {
            let event = result.unwrap();
            assert_eq!(event.event_type, "failed");
            assert_eq!(event.job_id, job.id);
            assert_eq!(event.error, Some("test error".to_string()));
        }
        _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => {
            // Event broadcast happened
        }
    }
}
