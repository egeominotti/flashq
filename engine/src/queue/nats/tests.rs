//! Integration tests for NATS storage backend.
//!
//! These tests require a running NATS server with JetStream enabled.
//! Run with: `cargo test --features nats -- --test-threads=1`

use super::config::{NatsConfig, PriorityBucket};
use super::connection::create_connection;
use super::storage::NatsStorage;
use crate::protocol::Job;
use std::sync::Arc;

/// Check if NATS is available for testing.
async fn is_nats_available() -> bool {
    let config = NatsConfig::default();
    let conn = create_connection(config);
    conn.connect().await.is_ok()
}

/// Create a test job.
fn test_job(id: u64, queue: &str, priority: i32) -> Job {
    Job {
        id,
        queue: queue.to_string(),
        data: Arc::new(serde_json::json!({"test": true})),
        priority,
        created_at: crate::queue::types::now_ms(),
        run_at: crate::queue::types::now_ms(),
        started_at: 0,
        attempts: 0,
        max_attempts: 3,
        backoff: 1000,
        ttl: 0,
        timeout: 30000,
        unique_key: None,
        depends_on: vec![],
        progress: 0,
        progress_msg: None,
        tags: vec![],
        lifo: false,
        remove_on_complete: false,
        remove_on_fail: false,
        last_heartbeat: 0,
        stall_timeout: 0,
        stall_count: 0,
        parent_id: None,
        children_ids: vec![],
        children_completed: 0,
        custom_id: None,
        keep_completed_age: 0,
        keep_completed_count: 0,
        completed_at: 0,
        group_id: None,
    }
}

#[cfg(test)]
mod config_tests {
    use super::*;

    #[test]
    fn test_priority_bucket_mapping() {
        assert_eq!(PriorityBucket::from_priority(10), PriorityBucket::High);
        assert_eq!(PriorityBucket::from_priority(5), PriorityBucket::High);
        assert_eq!(PriorityBucket::from_priority(4), PriorityBucket::Normal);
        assert_eq!(PriorityBucket::from_priority(0), PriorityBucket::Normal);
        assert_eq!(PriorityBucket::from_priority(-1), PriorityBucket::Low);
    }

    #[test]
    fn test_config_subject_generation() {
        let config = NatsConfig {
            prefix: "test".to_string(),
            ..NatsConfig::default()
        };

        assert_eq!(config.subject("jobs"), "test.jobs");
        assert_eq!(config.kv_bucket("results"), "test-results");
        assert_eq!(
            config.priority_stream("email", PriorityBucket::High),
            "test.email.priority.high"
        );
    }

    #[test]
    fn test_config_from_env() {
        // Set env vars
        std::env::set_var("NATS_URL", "nats://test:4222");
        std::env::set_var("NATS_PREFIX", "myapp");

        let config = NatsConfig::from_env();
        assert_eq!(config.url, "nats://test:4222");
        assert_eq!(config.prefix, "myapp");

        // Cleanup
        std::env::remove_var("NATS_URL");
        std::env::remove_var("NATS_PREFIX");
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_job_creation() {
        let job = test_job(123, "test-queue", 5);
        assert_eq!(job.id, 123);
        assert_eq!(job.queue, "test-queue");
        assert_eq!(job.priority, 5);
    }

    #[test]
    fn test_priority_bucket_order() {
        let buckets = PriorityBucket::all();
        assert_eq!(buckets.len(), 3);
        assert_eq!(buckets[0], PriorityBucket::High);
        assert_eq!(buckets[1], PriorityBucket::Normal);
        assert_eq!(buckets[2], PriorityBucket::Low);
    }
}

// Integration tests (require NATS server)
#[cfg(test)]
mod integration_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "Requires NATS server"]
    async fn test_storage_connect() {
        if !is_nats_available().await {
            eprintln!("NATS not available, skipping test");
            return;
        }

        let storage = NatsStorage::from_env();
        let result = storage.connect().await;
        assert!(result.is_ok(), "Failed to connect: {:?}", result.err());

        assert!(storage.is_connected().await);
        storage.shutdown().await;
    }

    #[tokio::test]
    #[ignore = "Requires NATS server"]
    async fn test_push_and_retrieve_job() {
        if !is_nats_available().await {
            return;
        }

        let storage = NatsStorage::from_env();
        storage.connect().await.unwrap();

        let job = test_job(1001, "integration-test", 5);

        // Push job
        storage.insert_job(&job, "waiting").await.unwrap();

        // Retrieve from KV
        let kv = storage.kv().await.unwrap();
        let retrieved = kv.get_job(job.id).await.unwrap();

        assert!(retrieved.is_some());
        let retrieved_job = retrieved.unwrap();
        assert_eq!(retrieved_job.id, job.id);
        assert_eq!(retrieved_job.queue, job.queue);
        assert_eq!(retrieved_job.priority, job.priority);

        // Cleanup
        storage.delete_job(job.id).await.unwrap();
        storage.shutdown().await;
    }

    #[tokio::test]
    #[ignore = "Requires NATS server"]
    async fn test_custom_id_mapping() {
        if !is_nats_available().await {
            return;
        }

        let storage = NatsStorage::from_env();
        storage.connect().await.unwrap();

        let mut job = test_job(1002, "integration-test", 0);
        job.custom_id = Some("my-custom-id-123".to_string());

        // Push job
        storage.insert_job(&job, "waiting").await.unwrap();

        // Lookup by custom ID
        let kv = storage.kv().await.unwrap();
        let job_id = kv.get_job_by_custom_id("my-custom-id-123").await.unwrap();

        assert!(job_id.is_some());
        assert_eq!(job_id.unwrap(), job.id);

        // Cleanup
        storage.delete_job(job.id).await.unwrap();
        kv.delete_custom_id("my-custom-id-123").await.unwrap();
        storage.shutdown().await;
    }

    #[tokio::test]
    #[ignore = "Requires NATS server"]
    async fn test_cron_operations() {
        if !is_nats_available().await {
            return;
        }

        let storage = NatsStorage::from_env();
        storage.connect().await.unwrap();

        let cron = crate::protocol::CronJob {
            name: "test-cron".to_string(),
            queue: "cron-queue".to_string(),
            data: serde_json::json!({"cron": true}),
            schedule: Some("* * * * * *".to_string()),
            repeat_every: None,
            priority: 0,
            next_run: 0,
            executions: 0,
            limit: None,
        };

        // Save cron
        storage.save_cron(&cron).await.unwrap();

        // List crons
        let crons = storage.load_crons().await.unwrap();
        assert!(crons.iter().any(|c| c.name == "test-cron"));

        // Delete cron
        storage.delete_cron("test-cron").await.unwrap();

        // Verify deleted
        let crons = storage.load_crons().await.unwrap();
        assert!(!crons.iter().any(|c| c.name == "test-cron"));

        storage.shutdown().await;
    }

    #[tokio::test]
    #[ignore = "Requires NATS server"]
    async fn test_job_progress() {
        if !is_nats_available().await {
            return;
        }

        let storage = NatsStorage::from_env();
        storage.connect().await.unwrap();

        let job = test_job(1003, "progress-test", 0);
        storage.insert_job(&job, "waiting").await.unwrap();

        // Update progress
        let kv = storage.kv().await.unwrap();
        kv.put_progress(job.id, 50, Some("Halfway done"))
            .await
            .unwrap();

        // Get progress
        let progress = kv.get_progress(job.id).await.unwrap();
        assert!(progress.is_some());
        let (pct, msg) = progress.unwrap();
        assert_eq!(pct, 50);
        assert_eq!(msg, Some("Halfway done".to_string()));

        // Cleanup
        storage.delete_job(job.id).await.unwrap();
        storage.shutdown().await;
    }

    #[tokio::test]
    #[ignore = "Requires NATS server"]
    async fn test_leader_election() {
        if !is_nats_available().await {
            return;
        }

        let storage = NatsStorage::from_env();
        storage.connect().await.unwrap();

        // Wait a bit for leader election
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

        // Should become leader (only instance)
        assert!(storage.is_leader().await);

        let leader = storage.leader().await.unwrap();
        let current_leader = leader.get_leader().await.unwrap();
        assert!(current_leader.is_some());
        assert_eq!(current_leader.unwrap(), storage.node_id());

        storage.shutdown().await;
    }
}
