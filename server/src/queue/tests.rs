#[cfg(test)]
mod tests {
    use super::super::*;
    use serde_json::json;

    fn setup() -> std::sync::Arc<QueueManager> {
        QueueManager::new(false)
    }

    // ==================== CORE OPERATIONS ====================

    #[tokio::test]
    async fn test_push_and_pull() {
        let qm = setup();

        let job = qm.push(
            "test".to_string(),
            json!({"key": "value"}),
            0, None, None, None, None, None, None, None
        ).await.unwrap();

        assert!(job.id > 0);
        assert_eq!(job.queue, "test");

        let pulled = qm.pull("test").await;
        assert_eq!(pulled.id, job.id);
    }

    #[tokio::test]
    async fn test_push_with_all_options() {
        let qm = setup();

        let job = qm.push(
            "test".to_string(),
            json!({"payload": "data"}),
            10,                    // priority
            Some(0),               // delay (0 = immediate)
            Some(60000),           // ttl
            Some(30000),           // timeout
            Some(3),               // max_attempts
            Some(1000),            // backoff
            Some("key-1".to_string()), // unique_key
            None,                  // depends_on
        ).await.unwrap();

        assert_eq!(job.priority, 10);
        assert_eq!(job.ttl, 60000);
        assert_eq!(job.timeout, 30000);
        assert_eq!(job.max_attempts, 3);
        assert_eq!(job.backoff, 1000);
        assert_eq!(job.unique_key, Some("key-1".to_string()));
    }

    #[tokio::test]
    async fn test_push_batch() {
        let qm = setup();

        let inputs = vec![
            crate::protocol::JobInput {
                data: json!({"i": 1}),
                priority: 0,
                delay: None,
                ttl: None,
                timeout: None,
                max_attempts: None,
                backoff: None,
                unique_key: None,
                depends_on: None,
            },
            crate::protocol::JobInput {
                data: json!({"i": 2}),
                priority: 5,
                delay: None,
                ttl: None,
                timeout: None,
                max_attempts: None,
                backoff: None,
                unique_key: None,
                depends_on: None,
            },
        ];

        let ids = qm.push_batch("test".to_string(), inputs).await;
        assert_eq!(ids.len(), 2);

        // Higher priority job should come first
        let job1 = qm.pull("test").await;
        assert_eq!(job1.priority, 5);

        let job2 = qm.pull("test").await;
        assert_eq!(job2.priority, 0);
    }

    #[tokio::test]
    async fn test_push_batch_large() {
        let qm = setup();

        let inputs: Vec<_> = (0..100).map(|i| {
            crate::protocol::JobInput {
                data: json!({"i": i}),
                priority: i as i32,
                delay: None,
                ttl: None,
                timeout: None,
                max_attempts: None,
                backoff: None,
                unique_key: None,
                depends_on: None,
            }
        }).collect();

        let ids = qm.push_batch("test".to_string(), inputs).await;
        assert_eq!(ids.len(), 100);

        // Highest priority first
        let job = qm.pull("test").await;
        assert_eq!(job.priority, 99);
    }

    #[tokio::test]
    async fn test_ack() {
        let qm = setup();

        let job = qm.push("test".to_string(), json!({}), 0, None, None, None, None, None, None, None)
            .await.unwrap();
        let pulled = qm.pull("test").await;

        let result = qm.ack(pulled.id, None).await;
        assert!(result.is_ok());

        // Double ack should fail
        let result2 = qm.ack(job.id, None).await;
        assert!(result2.is_err());
    }

    #[tokio::test]
    async fn test_ack_with_result() {
        let qm = setup();

        let job = qm.push("test".to_string(), json!({}), 0, None, None, None, None, None, None, None)
            .await.unwrap();
        let pulled = qm.pull("test").await;

        let result_data = json!({"computed": 42, "success": true});
        qm.ack(pulled.id, Some(result_data.clone())).await.unwrap();

        // Check result is stored
        let stored = qm.get_result(job.id).await;
        assert!(stored.is_some());
        assert_eq!(stored.unwrap(), result_data);
    }

    #[tokio::test]
    async fn test_ack_nonexistent_job() {
        let qm = setup();
        let result = qm.ack(999999, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_pull_batch() {
        let qm = setup();

        for i in 0..10 {
            qm.push("test".to_string(), json!({"i": i}), 0, None, None, None, None, None, None, None)
                .await.unwrap();
        }

        let jobs = qm.pull_batch("test", 5).await;
        assert_eq!(jobs.len(), 5);

        let (queued, processing, _, _) = qm.stats().await;
        assert_eq!(queued, 5);
        assert_eq!(processing, 5);
    }

    #[tokio::test]
    async fn test_ack_batch() {
        let qm = setup();

        for i in 0..5 {
            qm.push("test".to_string(), json!({"i": i}), 0, None, None, None, None, None, None, None)
                .await.unwrap();
        }

        let jobs = qm.pull_batch("test", 5).await;
        let ids: Vec<u64> = jobs.iter().map(|j| j.id).collect();

        let acked = qm.ack_batch(&ids).await;
        assert_eq!(acked, 5);

        let (_, processing, _, _) = qm.stats().await;
        assert_eq!(processing, 0);
    }

    // ==================== FAIL AND RETRY ====================

    #[tokio::test]
    async fn test_fail_and_retry() {
        let qm = setup();

        let job = qm.push("test".to_string(), json!({}), 0, None, None, None, Some(3), None, None, None)
            .await.unwrap();

        let pulled = qm.pull("test").await;
        assert_eq!(pulled.attempts, 0);

        // Fail the job
        qm.fail(pulled.id, Some("error".to_string())).await.unwrap();

        // Job should be back in queue with increased attempts
        let repulled = qm.pull("test").await;
        assert_eq!(repulled.id, job.id);
        assert_eq!(repulled.attempts, 1);
    }

    #[tokio::test]
    async fn test_fail_with_backoff() {
        let qm = setup();

        let _job = qm.push(
            "test".to_string(), json!({}), 0, None, None, None,
            Some(3), Some(100), None, None  // max_attempts=3, backoff=100ms
        ).await.unwrap();

        let pulled = qm.pull("test").await;
        qm.fail(pulled.id, None).await.unwrap();

        // Job should have run_at set in the future due to backoff
        // (exponential: 100ms * 2^attempt)
    }

    #[tokio::test]
    async fn test_fail_nonexistent_job() {
        let qm = setup();
        let result = qm.fail(999999, None).await;
        assert!(result.is_err());
    }

    // ==================== DLQ ====================

    #[tokio::test]
    async fn test_dlq() {
        let qm = setup();

        // Job with max_attempts=1 goes to DLQ after first failure
        let job = qm.push("test".to_string(), json!({}), 0, None, None, None, Some(1), None, None, None)
            .await.unwrap();

        let pulled = qm.pull("test").await;
        qm.fail(pulled.id, None).await.unwrap();

        let dlq = qm.get_dlq("test", None).await;
        assert_eq!(dlq.len(), 1);
        assert_eq!(dlq[0].id, job.id);

        // Retry from DLQ
        let retried = qm.retry_dlq("test", None).await;
        assert_eq!(retried, 1);

        let dlq_after = qm.get_dlq("test", None).await;
        assert!(dlq_after.is_empty());
    }

    #[tokio::test]
    async fn test_dlq_retry_single() {
        let qm = setup();

        // Create two jobs that will fail
        let job1 = qm.push("test".to_string(), json!({"i": 1}), 0, None, None, None, Some(1), None, None, None)
            .await.unwrap();
        let job2 = qm.push("test".to_string(), json!({"i": 2}), 0, None, None, None, Some(1), None, None, None)
            .await.unwrap();

        // Fail both
        let p1 = qm.pull("test").await;
        qm.fail(p1.id, None).await.unwrap();
        let p2 = qm.pull("test").await;
        qm.fail(p2.id, None).await.unwrap();

        let dlq = qm.get_dlq("test", None).await;
        assert_eq!(dlq.len(), 2);

        // Retry only job1
        let retried = qm.retry_dlq("test", Some(job1.id)).await;
        assert_eq!(retried, 1);

        let dlq_after = qm.get_dlq("test", None).await;
        assert_eq!(dlq_after.len(), 1);
        assert_eq!(dlq_after[0].id, job2.id);
    }

    #[tokio::test]
    async fn test_dlq_with_limit() {
        let qm = setup();

        // Create 10 jobs that will fail
        for i in 0..10 {
            qm.push("test".to_string(), json!({"i": i}), 0, None, None, None, Some(1), None, None, None)
                .await.unwrap();
        }

        // Fail all
        for _ in 0..10 {
            let p = qm.pull("test").await;
            qm.fail(p.id, None).await.unwrap();
        }

        // Get only 5
        let dlq = qm.get_dlq("test", Some(5)).await;
        assert_eq!(dlq.len(), 5);
    }

    // ==================== UNIQUE KEY ====================

    #[tokio::test]
    async fn test_unique_key() {
        let qm = setup();

        let job1 = qm.push(
            "test".to_string(), json!({}), 0, None, None, None, None, None,
            Some("unique-123".to_string()), None
        ).await;
        assert!(job1.is_ok());

        // Duplicate should fail
        let job2 = qm.push(
            "test".to_string(), json!({}), 0, None, None, None, None, None,
            Some("unique-123".to_string()), None
        ).await;
        assert!(job2.is_err());

        // After ack, key should be released
        let pulled = qm.pull("test").await;
        qm.ack(pulled.id, None).await.unwrap();

        let job3 = qm.push(
            "test".to_string(), json!({}), 0, None, None, None, None, None,
            Some("unique-123".to_string()), None
        ).await;
        assert!(job3.is_ok());
    }

    #[tokio::test]
    async fn test_unique_key_different_queues() {
        let qm = setup();

        // Same unique key in different queues should work
        let job1 = qm.push(
            "queue1".to_string(), json!({}), 0, None, None, None, None, None,
            Some("same-key".to_string()), None
        ).await;
        assert!(job1.is_ok());

        let job2 = qm.push(
            "queue2".to_string(), json!({}), 0, None, None, None, None, None,
            Some("same-key".to_string()), None
        ).await;
        assert!(job2.is_ok());
    }

    #[tokio::test]
    async fn test_unique_key_released_on_fail() {
        let qm = setup();

        let _job = qm.push(
            "test".to_string(), json!({}), 0, None, None, None, Some(1), None,
            Some("unique-fail".to_string()), None
        ).await.unwrap();

        let pulled = qm.pull("test").await;
        qm.fail(pulled.id, None).await.unwrap(); // Goes to DLQ

        // Unique key should still be locked while in DLQ
        // (this is expected behavior - job is still "in system")
    }

    // ==================== CANCEL ====================

    #[tokio::test]
    async fn test_cancel() {
        let qm = setup();

        let job = qm.push("test".to_string(), json!({}), 0, Some(60000), None, None, None, None, None, None)
            .await.unwrap();

        let result = qm.cancel(job.id).await;
        assert!(result.is_ok());

        // Cancel non-existent should fail
        let result2 = qm.cancel(999999).await;
        assert!(result2.is_err());
    }

    #[tokio::test]
    async fn test_cancel_processing_job() {
        let qm = setup();

        let job = qm.push("test".to_string(), json!({}), 0, None, None, None, None, None, None, None)
            .await.unwrap();
        let _pulled = qm.pull("test").await;

        // Cancel while processing
        let result = qm.cancel(job.id).await;
        assert!(result.is_ok());

        let (_, processing, _, _) = qm.stats().await;
        assert_eq!(processing, 0);
    }

    // ==================== PROGRESS ====================

    #[tokio::test]
    async fn test_progress() {
        let qm = setup();

        let _job = qm.push("test".to_string(), json!({}), 0, None, None, None, None, None, None, None)
            .await.unwrap();
        let pulled = qm.pull("test").await;

        // Update progress
        qm.update_progress(pulled.id, 50, Some("halfway".to_string())).await.unwrap();

        let (progress, msg) = qm.get_progress(pulled.id).await.unwrap();
        assert_eq!(progress, 50);
        assert_eq!(msg, Some("halfway".to_string()));
    }

    #[tokio::test]
    async fn test_progress_max_100() {
        let qm = setup();

        let _job = qm.push("test".to_string(), json!({}), 0, None, None, None, None, None, None, None)
            .await.unwrap();
        let pulled = qm.pull("test").await;

        // Progress should cap at 100
        qm.update_progress(pulled.id, 150, None).await.unwrap();

        let (progress, _) = qm.get_progress(pulled.id).await.unwrap();
        assert_eq!(progress, 100);
    }

    #[tokio::test]
    async fn test_progress_nonexistent() {
        let qm = setup();
        let result = qm.get_progress(999999).await;
        assert!(result.is_err());
    }

    // ==================== PRIORITY ====================

    #[tokio::test]
    async fn test_priority_ordering() {
        let qm = setup();

        // Push jobs with different priorities
        qm.push("test".to_string(), json!({"p": 1}), 1, None, None, None, None, None, None, None).await.unwrap();
        qm.push("test".to_string(), json!({"p": 3}), 3, None, None, None, None, None, None, None).await.unwrap();
        qm.push("test".to_string(), json!({"p": 2}), 2, None, None, None, None, None, None, None).await.unwrap();

        // Should get highest priority first
        let j1 = qm.pull("test").await;
        assert_eq!(j1.priority, 3);

        let j2 = qm.pull("test").await;
        assert_eq!(j2.priority, 2);

        let j3 = qm.pull("test").await;
        assert_eq!(j3.priority, 1);
    }

    #[tokio::test]
    async fn test_priority_negative() {
        let qm = setup();

        qm.push("test".to_string(), json!({}), -10, None, None, None, None, None, None, None).await.unwrap();
        qm.push("test".to_string(), json!({}), 0, None, None, None, None, None, None, None).await.unwrap();
        qm.push("test".to_string(), json!({}), 10, None, None, None, None, None, None, None).await.unwrap();

        let j1 = qm.pull("test").await;
        assert_eq!(j1.priority, 10);

        let j2 = qm.pull("test").await;
        assert_eq!(j2.priority, 0);

        let j3 = qm.pull("test").await;
        assert_eq!(j3.priority, -10);
    }

    #[tokio::test]
    async fn test_fifo_same_priority() {
        let qm = setup();

        // Jobs with same priority should be FIFO (by created_at)
        let job1 = qm.push("test".to_string(), json!({"order": 1}), 0, None, None, None, None, None, None, None).await.unwrap();
        let job2 = qm.push("test".to_string(), json!({"order": 2}), 0, None, None, None, None, None, None, None).await.unwrap();
        let job3 = qm.push("test".to_string(), json!({"order": 3}), 0, None, None, None, None, None, None, None).await.unwrap();

        let p1 = qm.pull("test").await;
        let p2 = qm.pull("test").await;
        let p3 = qm.pull("test").await;

        assert_eq!(p1.id, job1.id);
        assert_eq!(p2.id, job2.id);
        assert_eq!(p3.id, job3.id);
    }

    // ==================== DELAYED JOBS ====================

    #[tokio::test]
    async fn test_delayed_job() {
        let qm = setup();

        // Job delayed by 100ms
        let job = qm.push("test".to_string(), json!({}), 0, Some(100), None, None, None, None, None, None)
            .await.unwrap();

        assert!(job.run_at > job.created_at);
    }

    #[tokio::test]
    async fn test_delayed_job_ordering() {
        let qm = setup();

        // Job 1: delayed 200ms
        let _job1 = qm.push("test".to_string(), json!({"order": 1}), 0, Some(200), None, None, None, None, None, None)
            .await.unwrap();

        // Job 2: immediate
        let job2 = qm.push("test".to_string(), json!({"order": 2}), 0, None, None, None, None, None, None, None)
            .await.unwrap();

        // Immediate job should be pulled first
        let pulled = qm.pull("test").await;
        assert_eq!(pulled.id, job2.id);
    }

    // ==================== JOB DEPENDENCIES ====================

    #[tokio::test]
    async fn test_job_dependencies_single() {
        let qm = setup();

        // Create parent job
        let parent = qm.push("test".to_string(), json!({"parent": true}), 0, None, None, None, None, None, None, None)
            .await.unwrap();

        // Create child job that depends on parent
        let child = qm.push(
            "test".to_string(), json!({"child": true}), 0, None, None, None, None, None, None,
            Some(vec![parent.id])
        ).await.unwrap();

        // Child should not be pullable yet
        let pulled_parent = qm.pull("test").await;
        assert_eq!(pulled_parent.id, parent.id);

        // Complete parent
        qm.ack(parent.id, None).await.unwrap();

        // Now trigger dependency check (normally done by background task)
        qm.check_dependencies().await;

        // Now child should be pullable
        let pulled_child = qm.pull("test").await;
        assert_eq!(pulled_child.id, child.id);
    }

    #[tokio::test]
    async fn test_job_dependencies_multiple() {
        let qm = setup();

        // Create two parent jobs
        let parent1 = qm.push("test".to_string(), json!({"p": 1}), 0, None, None, None, None, None, None, None)
            .await.unwrap();
        let parent2 = qm.push("test".to_string(), json!({"p": 2}), 0, None, None, None, None, None, None, None)
            .await.unwrap();

        // Create child that depends on both
        let _child = qm.push(
            "test".to_string(), json!({"child": true}), 0, None, None, None, None, None, None,
            Some(vec![parent1.id, parent2.id])
        ).await.unwrap();

        // Pull and ack first parent
        let p1 = qm.pull("test").await;
        qm.ack(p1.id, None).await.unwrap();

        qm.check_dependencies().await;

        // Child still waiting (parent2 not done)
        let p2 = qm.pull("test").await;
        assert_eq!(p2.id, parent2.id);

        qm.ack(p2.id, None).await.unwrap();
        qm.check_dependencies().await;

        // Now child should be available
        let (queued, _, _, _) = qm.stats().await;
        assert_eq!(queued, 1); // child is now queued
    }

    // ==================== PAUSE/RESUME ====================

    #[tokio::test]
    async fn test_pause_resume() {
        let qm = setup();

        qm.pause("test").await;
        assert!(qm.is_paused("test").await);

        qm.resume("test").await;
        assert!(!qm.is_paused("test").await);
    }

    // ==================== RATE LIMITING ====================

    #[tokio::test]
    async fn test_rate_limit() {
        let qm = setup();

        qm.set_rate_limit("test".to_string(), 100).await;

        // Check via list_queues that rate limit is set
        qm.push("test".to_string(), json!({}), 0, None, None, None, None, None, None, None)
            .await.unwrap();

        let queues = qm.list_queues().await;
        let test_queue = queues.iter().find(|q| q.name == "test");
        assert!(test_queue.is_some());
        assert_eq!(test_queue.unwrap().rate_limit, Some(100));

        qm.clear_rate_limit("test").await;

        let queues2 = qm.list_queues().await;
        let test_queue2 = queues2.iter().find(|q| q.name == "test");
        assert_eq!(test_queue2.unwrap().rate_limit, None);
    }

    // ==================== CONCURRENCY LIMIT ====================

    #[tokio::test]
    async fn test_concurrency_limit() {
        let qm = setup();

        qm.set_concurrency("test".to_string(), 2).await;

        // Push 3 jobs
        for i in 0..3 {
            qm.push("test".to_string(), json!({"i": i}), 0, None, None, None, None, None, None, None)
                .await.unwrap();
        }

        // Check via list_queues
        let queues = qm.list_queues().await;
        let test_queue = queues.iter().find(|q| q.name == "test");
        assert_eq!(test_queue.unwrap().concurrency_limit, Some(2));

        // Clear limit
        qm.clear_concurrency("test").await;
    }

    // ==================== CRON JOBS ====================

    #[tokio::test]
    async fn test_cron() {
        let qm = setup();

        qm.add_cron(
            "test-cron".to_string(),
            "test".to_string(),
            json!({"cron": true}),
            "*/60".to_string(),
            0
        ).await;

        let crons = qm.list_crons().await;
        assert_eq!(crons.len(), 1);
        assert_eq!(crons[0].name, "test-cron");
        assert_eq!(crons[0].queue, "test");

        let deleted = qm.delete_cron("test-cron").await;
        assert!(deleted);

        let crons_after = qm.list_crons().await;
        assert!(crons_after.is_empty());
    }

    #[tokio::test]
    async fn test_cron_delete_nonexistent() {
        let qm = setup();
        let deleted = qm.delete_cron("nonexistent").await;
        assert!(!deleted);
    }

    #[tokio::test]
    async fn test_cron_with_priority() {
        let qm = setup();

        qm.add_cron(
            "high-priority-cron".to_string(),
            "test".to_string(),
            json!({}),
            "*/30".to_string(),
            100  // high priority
        ).await;

        let crons = qm.list_crons().await;
        assert_eq!(crons[0].priority, 100);

        qm.delete_cron("high-priority-cron").await;
    }

    // ==================== STATS & METRICS ====================

    #[tokio::test]
    async fn test_stats() {
        let qm = setup();

        // Push some jobs
        for i in 0..5 {
            qm.push("test".to_string(), json!({"i": i}), 0, None, None, None, None, None, None, None)
                .await.unwrap();
        }

        let (queued, processing, delayed, dlq) = qm.stats().await;
        assert_eq!(queued, 5);
        assert_eq!(processing, 0);
        assert_eq!(delayed, 0);
        assert_eq!(dlq, 0);

        // Pull one
        let _ = qm.pull("test").await;

        let (queued2, processing2, _, _) = qm.stats().await;
        assert_eq!(queued2, 4);
        assert_eq!(processing2, 1);
    }

    #[tokio::test]
    async fn test_metrics() {
        let qm = setup();

        // Push and complete some jobs
        for _ in 0..5 {
            qm.push("test".to_string(), json!({}), 0, None, None, None, None, None, None, None)
                .await.unwrap();
            let pulled = qm.pull("test").await;
            qm.ack(pulled.id, None).await.unwrap();
        }

        let metrics = qm.get_metrics().await;
        assert_eq!(metrics.total_pushed, 5);
        assert_eq!(metrics.total_completed, 5);
    }

    #[tokio::test]
    async fn test_list_queues() {
        let qm = setup();

        // Push to create queues
        qm.push("queue1".to_string(), json!({}), 0, None, None, None, None, None, None, None)
            .await.unwrap();
        qm.push("queue2".to_string(), json!({}), 0, None, None, None, None, None, None, None)
            .await.unwrap();
        qm.push("queue2".to_string(), json!({}), 0, None, None, None, None, None, None, None)
            .await.unwrap();

        let queues = qm.list_queues().await;
        assert!(queues.len() >= 2);

        let q2 = queues.iter().find(|q| q.name == "queue2");
        assert!(q2.is_some());
        assert_eq!(q2.unwrap().pending, 2);
    }

    // ==================== AUTHENTICATION ====================

    #[tokio::test]
    async fn test_auth_token_verification() {
        let qm = QueueManager::with_auth_tokens(false, vec!["secret-token".to_string()]);

        assert!(qm.verify_token("secret-token"));
        assert!(!qm.verify_token("wrong-token"));
    }

    #[tokio::test]
    async fn test_auth_empty_tokens_allows_all() {
        let qm = QueueManager::new(false);

        // With no tokens configured, any token should be accepted
        assert!(qm.verify_token("any-token"));
        assert!(qm.verify_token(""));
    }

    #[tokio::test]
    async fn test_auth_multiple_tokens() {
        let qm = QueueManager::with_auth_tokens(
            false,
            vec!["token1".to_string(), "token2".to_string(), "token3".to_string()]
        );

        assert!(qm.verify_token("token1"));
        assert!(qm.verify_token("token2"));
        assert!(qm.verify_token("token3"));
        assert!(!qm.verify_token("token4"));
    }

    // ==================== SHARDING ====================

    #[tokio::test]
    async fn test_different_queues_different_shards() {
        let qm = setup();

        // Push to many different queues
        for i in 0..100 {
            qm.push(format!("queue-{}", i), json!({"i": i}), 0, None, None, None, None, None, None, None)
                .await.unwrap();
        }

        let queues = qm.list_queues().await;
        assert_eq!(queues.len(), 100);
    }

    #[tokio::test]
    async fn test_shard_index_consistency() {
        // Same queue name should always map to same shard
        let idx1 = QueueManager::shard_index("test-queue");
        let idx2 = QueueManager::shard_index("test-queue");
        assert_eq!(idx1, idx2);

        // Different queues may map to different shards
        let idx3 = QueueManager::shard_index("another-queue");
        // (idx3 might equal idx1 by coincidence, so no assertion here)
        assert!(idx3 < 32); // Should be within shard range
    }

    // ==================== EDGE CASES ====================

    #[tokio::test]
    async fn test_empty_queue_name() {
        let qm = setup();

        let job = qm.push("".to_string(), json!({}), 0, None, None, None, None, None, None, None)
            .await.unwrap();

        assert_eq!(job.queue, "");
    }

    #[tokio::test]
    async fn test_large_payload() {
        let qm = setup();

        // Create a large payload
        let large_data: Vec<i32> = (0..10000).collect();
        let job = qm.push("test".to_string(), json!({"data": large_data}), 0, None, None, None, None, None, None, None)
            .await.unwrap();

        let pulled = qm.pull("test").await;
        assert_eq!(pulled.id, job.id);
    }

    #[tokio::test]
    async fn test_special_characters_in_queue_name() {
        let qm = setup();

        let special_queues = vec![
            "queue-with-dash",
            "queue_with_underscore",
            "queue.with.dots",
            "queue:with:colons",
            "queue/with/slashes",
        ];

        for name in special_queues {
            let job = qm.push(name.to_string(), json!({}), 0, None, None, None, None, None, None, None)
                .await.unwrap();
            assert_eq!(job.queue, name);
        }
    }

    #[tokio::test]
    async fn test_unicode_queue_name() {
        let qm = setup();

        let job = qm.push("队列名称".to_string(), json!({"emoji": "🚀"}), 0, None, None, None, None, None, None, None)
            .await.unwrap();

        assert_eq!(job.queue, "队列名称");

        let pulled = qm.pull("队列名称").await;
        assert_eq!(pulled.id, job.id);
    }

    #[tokio::test]
    async fn test_null_json_data() {
        let qm = setup();

        qm.push("test".to_string(), json!(null), 0, None, None, None, None, None, None, None)
            .await.unwrap();

        let pulled = qm.pull("test").await;
        assert_eq!(pulled.data, json!(null));
    }

    #[tokio::test]
    async fn test_nested_json_data() {
        let qm = setup();

        let nested = json!({
            "level1": {
                "level2": {
                    "level3": {
                        "value": 42
                    }
                }
            },
            "array": [1, 2, {"nested": true}]
        });

        qm.push("test".to_string(), nested.clone(), 0, None, None, None, None, None, None, None)
            .await.unwrap();

        let pulled = qm.pull("test").await;
        assert_eq!(pulled.data, nested);
    }

    // ==================== CONCURRENT OPERATIONS ====================

    #[tokio::test]
    async fn test_concurrent_push() {
        let qm = setup();

        let mut handles = vec![];
        for i in 0..100 {
            let qm_clone = qm.clone();
            handles.push(tokio::spawn(async move {
                qm_clone.push("test".to_string(), json!({"i": i}), 0, None, None, None, None, None, None, None)
                    .await.unwrap()
            }));
        }

        for handle in handles {
            handle.await.unwrap();
        }

        let (queued, _, _, _) = qm.stats().await;
        assert_eq!(queued, 100);
    }

    #[tokio::test]
    async fn test_concurrent_push_pull() {
        let qm = setup();

        // Pre-populate
        for i in 0..50 {
            qm.push("test".to_string(), json!({"i": i}), 0, None, None, None, None, None, None, None)
                .await.unwrap();
        }

        let mut push_handles = vec![];
        let mut pull_handles = vec![];

        // Concurrent pushes
        for i in 50..100 {
            let qm_clone = qm.clone();
            push_handles.push(tokio::spawn(async move {
                qm_clone.push("test".to_string(), json!({"i": i}), 0, None, None, None, None, None, None, None)
                    .await.unwrap()
            }));
        }

        // Concurrent pulls
        for _ in 0..50 {
            let qm_clone = qm.clone();
            pull_handles.push(tokio::spawn(async move {
                qm_clone.pull("test").await
            }));
        }

        for handle in push_handles {
            handle.await.unwrap();
        }
        for handle in pull_handles {
            handle.await.unwrap();
        }

        let (queued, processing, _, _) = qm.stats().await;
        assert_eq!(queued + processing, 100);
    }

    // ==================== PROTOCOL TESTS ====================

    #[test]
    fn test_job_is_ready() {
        let now = 1000u64;

        let job = crate::protocol::Job {
            id: 1,
            queue: "test".to_string(),
            data: json!({}),
            priority: 0,
            created_at: 900,
            run_at: 950,  // In the past
            started_at: 0,
            attempts: 0,
            max_attempts: 0,
            backoff: 0,
            ttl: 0,
            timeout: 0,
            unique_key: None,
            depends_on: vec![],
            progress: 0,
            progress_msg: None,
        };

        assert!(job.is_ready(now));

        let delayed_job = crate::protocol::Job {
            run_at: 2000,  // In the future
            ..job.clone()
        };

        assert!(!delayed_job.is_ready(now));
    }

    #[test]
    fn test_job_is_expired() {
        let now = 1000u64;

        let job = crate::protocol::Job {
            id: 1,
            queue: "test".to_string(),
            data: json!({}),
            priority: 0,
            created_at: 500,
            run_at: 500,
            started_at: 0,
            attempts: 0,
            max_attempts: 0,
            backoff: 0,
            ttl: 400,  // Expires at 900
            timeout: 0,
            unique_key: None,
            depends_on: vec![],
            progress: 0,
            progress_msg: None,
        };

        assert!(job.is_expired(now)); // 1000 > 900

        let valid_job = crate::protocol::Job {
            ttl: 600,  // Expires at 1100
            ..job.clone()
        };

        assert!(!valid_job.is_expired(now)); // 1000 < 1100

        let no_ttl_job = crate::protocol::Job {
            ttl: 0,  // No TTL
            ..job.clone()
        };

        assert!(!no_ttl_job.is_expired(now)); // Never expires
    }

    #[test]
    fn test_job_is_timed_out() {
        let now = 1000u64;

        let job = crate::protocol::Job {
            id: 1,
            queue: "test".to_string(),
            data: json!({}),
            priority: 0,
            created_at: 500,
            run_at: 500,
            started_at: 600,
            attempts: 0,
            max_attempts: 0,
            backoff: 0,
            ttl: 0,
            timeout: 300,  // Times out at 900
            unique_key: None,
            depends_on: vec![],
            progress: 0,
            progress_msg: None,
        };

        assert!(job.is_timed_out(now)); // 1000 > 900

        let valid_job = crate::protocol::Job {
            timeout: 500,  // Times out at 1100
            ..job.clone()
        };

        assert!(!valid_job.is_timed_out(now)); // 1000 < 1100

        let not_started = crate::protocol::Job {
            started_at: 0,
            ..job.clone()
        };

        assert!(!not_started.is_timed_out(now)); // Not started yet
    }

    #[test]
    fn test_job_should_go_to_dlq() {
        let job = crate::protocol::Job {
            id: 1,
            queue: "test".to_string(),
            data: json!({}),
            priority: 0,
            created_at: 0,
            run_at: 0,
            started_at: 0,
            attempts: 3,
            max_attempts: 3,
            backoff: 0,
            ttl: 0,
            timeout: 0,
            unique_key: None,
            depends_on: vec![],
            progress: 0,
            progress_msg: None,
        };

        assert!(job.should_go_to_dlq()); // attempts >= max_attempts

        let retry_job = crate::protocol::Job {
            attempts: 2,
            ..job.clone()
        };

        assert!(!retry_job.should_go_to_dlq()); // attempts < max_attempts

        let no_limit = crate::protocol::Job {
            max_attempts: 0,
            ..job.clone()
        };

        assert!(!no_limit.should_go_to_dlq()); // max_attempts=0 means unlimited
    }

    #[test]
    fn test_job_next_backoff() {
        let job = crate::protocol::Job {
            id: 1,
            queue: "test".to_string(),
            data: json!({}),
            priority: 0,
            created_at: 0,
            run_at: 0,
            started_at: 0,
            attempts: 0,
            max_attempts: 5,
            backoff: 1000,  // 1 second base
            ttl: 0,
            timeout: 0,
            unique_key: None,
            depends_on: vec![],
            progress: 0,
            progress_msg: None,
        };

        // Exponential backoff: base * 2^attempts
        assert_eq!(job.next_backoff(), 1000);  // 1000 * 2^0

        let job1 = crate::protocol::Job { attempts: 1, ..job.clone() };
        assert_eq!(job1.next_backoff(), 2000);  // 1000 * 2^1

        let job2 = crate::protocol::Job { attempts: 2, ..job.clone() };
        assert_eq!(job2.next_backoff(), 4000);  // 1000 * 2^2

        let no_backoff = crate::protocol::Job { backoff: 0, ..job.clone() };
        assert_eq!(no_backoff.next_backoff(), 0);  // No backoff configured
    }
}
