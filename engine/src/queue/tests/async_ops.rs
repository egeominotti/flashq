//! Async operations tests: wait_for_job (finished promise).

use super::*;

#[tokio::test]
async fn test_wait_for_job_completed() {
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
            None,  // group_id
        )
        .await
        .unwrap();

    // Spawn task to wait for job
    let qm_clone = qm.clone();
    let job_id = job.id;
    let waiter = tokio::spawn(async move { qm_clone.wait_for_job(job_id, Some(5000)).await });

    // Small delay to ensure waiter is registered
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

    // Pull and complete the job with result
    let pulled = qm.pull("test").await;
    let result = json!({"computed": 42});
    qm.ack(pulled.id, Some(result.clone())).await.unwrap();

    // Waiter should receive result
    let wait_result = waiter.await.unwrap();
    assert!(wait_result.is_ok());
    assert_eq!(wait_result.unwrap(), Some(result));
}

#[tokio::test]
async fn test_wait_for_job_already_completed() {
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
            None,  // group_id
        )
        .await
        .unwrap();

    // Complete the job first
    let pulled = qm.pull("test").await;
    let result = json!({"done": true});
    qm.ack(pulled.id, Some(result.clone())).await.unwrap();

    // Wait should return immediately with result
    let wait_result = qm.wait_for_job(job.id, Some(1000)).await;
    assert!(wait_result.is_ok());
    assert_eq!(wait_result.unwrap(), Some(result));
}

#[tokio::test]
async fn test_wait_for_job_timeout() {
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
            None,  // group_id
        )
        .await
        .unwrap();

    // Don't complete the job, just wait with short timeout
    let result = qm.wait_for_job(job.id, Some(50)).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Timeout"));
}

#[tokio::test]
async fn test_wait_for_job_not_found() {
    let qm = setup();

    let result = qm.wait_for_job(999999, Some(100)).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[tokio::test]
async fn test_wait_for_job_failed() {
    let qm = setup();

    let job = qm
        .push(
            "test".to_string(),
            json!({}),
            0,
            None,
            None,
            None,
            Some(1), // max_attempts=1, goes to DLQ on fail
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
            None,  // group_id
        )
        .await
        .unwrap();

    // Fail the job
    let pulled = qm.pull("test").await;
    qm.fail(pulled.id, Some("error".to_string())).await.unwrap();

    // Wait should return error for failed job
    let result = qm.wait_for_job(job.id, Some(100)).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("failed"));
}

#[tokio::test]
async fn test_wait_for_job_multiple_waiters() {
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
            None,  // group_id
        )
        .await
        .unwrap();

    // Spawn multiple waiters
    let mut handles = vec![];
    for _ in 0..5 {
        let qm_clone = qm.clone();
        let job_id = job.id;
        handles.push(tokio::spawn(async move {
            qm_clone.wait_for_job(job_id, Some(5000)).await
        }));
    }

    // Small delay
    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

    // Complete the job
    let pulled = qm.pull("test").await;
    let result = json!({"value": 123});
    qm.ack(pulled.id, Some(result.clone())).await.unwrap();

    // All waiters should receive the result
    for handle in handles {
        let wait_result = handle.await.unwrap();
        assert!(wait_result.is_ok());
        assert_eq!(wait_result.unwrap(), Some(result.clone()));
    }
}
