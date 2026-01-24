//! SQLite persistence tests.

use super::*;
use crate::protocol::Job;
use serde_json::json;
use std::sync::Arc;
use tempfile::NamedTempFile;

/// Helper to create a test SQLite storage with temp file.
fn create_test_storage() -> (SqliteStorage, NamedTempFile) {
    let temp_file = NamedTempFile::new().expect("Failed to create temp file");
    let config = SqliteConfig {
        path: temp_file.path().to_path_buf(),
        wal_mode: true,
        synchronous: 0, // OFF for test speed
        cache_size: -2000,
    };
    let storage = SqliteStorage::new(config).expect("Failed to create storage");
    storage.migrate().expect("Failed to migrate");
    (storage, temp_file)
}

/// Helper to create a test job.
fn create_test_job(id: u64, queue: &str) -> Job {
    Job {
        id,
        queue: queue.to_string(),
        data: Arc::new(json!({"test": "data", "id": id})),
        priority: 0,
        created_at: 1000,
        run_at: 1000,
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

#[test]
fn test_sqlite_storage_creation() {
    let (storage, _temp) = create_test_storage();
    assert!(storage.path.exists());
}

#[test]
fn test_sqlite_insert_and_load_job() {
    let (storage, _temp) = create_test_storage();
    let job = create_test_job(1, "test-queue");

    // Insert
    storage.insert_job(&job, "waiting").expect("Insert failed");

    // Load
    let jobs = storage.load_pending_jobs().expect("Load failed");
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].0.id, 1);
    assert_eq!(jobs[0].0.queue, "test-queue");
    assert_eq!(jobs[0].1, "waiting");
}

#[test]
fn test_sqlite_insert_batch() {
    let (storage, _temp) = create_test_storage();
    let jobs: Vec<Job> = (1..=10)
        .map(|i| create_test_job(i, "batch-queue"))
        .collect();

    storage
        .insert_jobs_batch(&jobs, "waiting")
        .expect("Batch insert failed");

    let loaded = storage.load_pending_jobs().expect("Load failed");
    assert_eq!(loaded.len(), 10);
}

#[test]
fn test_sqlite_ack_job() {
    let (storage, _temp) = create_test_storage();
    let job = create_test_job(1, "ack-queue");

    storage.insert_job(&job, "waiting").expect("Insert failed");

    // Ack with result
    storage
        .ack_job(1, Some(json!({"result": "success"})))
        .expect("Ack failed");

    // Job should be removed from pending
    let jobs = storage.load_pending_jobs().expect("Load failed");
    assert!(jobs.is_empty());
}

#[test]
fn test_sqlite_ack_batch() {
    let (storage, _temp) = create_test_storage();
    let jobs: Vec<Job> = (1..=5).map(|i| create_test_job(i, "ack-batch")).collect();

    storage
        .insert_jobs_batch(&jobs, "waiting")
        .expect("Insert failed");
    storage
        .ack_jobs_batch(&[1, 2, 3])
        .expect("Ack batch failed");

    let remaining = storage.load_pending_jobs().expect("Load failed");
    assert_eq!(remaining.len(), 2);
}

#[test]
fn test_sqlite_fail_job() {
    let (storage, _temp) = create_test_storage();
    let job = create_test_job(1, "fail-queue");

    storage.insert_job(&job, "active").expect("Insert failed");

    // Fail with retry
    storage.fail_job(1, 5000, 1).expect("Fail failed");

    let jobs = storage.load_pending_jobs().expect("Load failed");
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].0.attempts, 1);
    assert_eq!(jobs[0].1, "waiting"); // State changes to waiting for retry
}

#[test]
fn test_sqlite_move_to_dlq() {
    let (storage, _temp) = create_test_storage();
    let job = create_test_job(1, "dlq-queue");

    storage.insert_job(&job, "active").expect("Insert failed");
    storage
        .move_to_dlq(&job, Some("Max retries exceeded"))
        .expect("Move to DLQ failed");

    // Job removed from pending
    let pending = storage.load_pending_jobs().expect("Load pending failed");
    assert!(pending.is_empty());

    // Job in DLQ
    let dlq = storage.load_dlq_jobs().expect("Load DLQ failed");
    assert_eq!(dlq.len(), 1);
    assert_eq!(dlq[0].id, 1);
}

#[test]
fn test_sqlite_cancel_job() {
    let (storage, _temp) = create_test_storage();
    let job = create_test_job(1, "cancel-queue");

    storage.insert_job(&job, "waiting").expect("Insert failed");
    storage.cancel_job(1).expect("Cancel failed");

    let jobs = storage.load_pending_jobs().expect("Load failed");
    assert!(jobs.is_empty());
}

#[test]
fn test_sqlite_get_max_job_id() {
    let (storage, _temp) = create_test_storage();

    // Empty db
    let max = storage.get_max_job_id().expect("Get max failed");
    assert_eq!(max, 0);

    // With jobs
    let job1 = create_test_job(100, "max-queue");
    let job2 = create_test_job(200, "max-queue");
    storage.insert_job(&job1, "waiting").expect("Insert failed");
    storage.insert_job(&job2, "waiting").expect("Insert failed");

    let max = storage.get_max_job_id().expect("Get max failed");
    assert_eq!(max, 200);
}

#[test]
fn test_sqlite_cron_operations() {
    let (storage, _temp) = create_test_storage();

    let cron = crate::protocol::CronJob {
        name: "test-cron".to_string(),
        schedule: Some("0 * * * * *".to_string()),
        queue: "cron-queue".to_string(),
        data: json!({"cron": true}),
        next_run: 10000,
        repeat_every: None,
        priority: 0,
        executions: 0,
        limit: None,
    };

    // Save
    storage.save_cron(&cron).expect("Save cron failed");

    // Load
    let crons = storage.load_crons().expect("Load crons failed");
    assert_eq!(crons.len(), 1);
    assert_eq!(crons[0].name, "test-cron");

    // Update next_run
    storage
        .update_cron_next_run("test-cron", 20000)
        .expect("Update failed");
    let crons = storage.load_crons().expect("Load crons failed");
    assert_eq!(crons[0].next_run, 20000);

    // Delete
    let deleted = storage.delete_cron("test-cron").expect("Delete failed");
    assert!(deleted);
    let crons = storage.load_crons().expect("Load crons failed");
    assert!(crons.is_empty());
}

#[test]
fn test_sqlite_webhook_operations() {
    let (storage, _temp) = create_test_storage();

    let webhook = crate::protocol::WebhookConfig {
        id: "wh-1".to_string(),
        url: "http://example.com/webhook".to_string(),
        queue: Some("webhook-queue".to_string()),
        events: vec!["completed".to_string(), "failed".to_string()],
        secret: Some("secret123".to_string()),
        created_at: 1000,
    };

    // Save
    storage.save_webhook(&webhook).expect("Save webhook failed");

    // Load
    let webhooks = storage.load_webhooks().expect("Load webhooks failed");
    assert_eq!(webhooks.len(), 1);
    assert_eq!(webhooks[0].id, "wh-1");
    assert_eq!(webhooks[0].url, "http://example.com/webhook");

    // Delete
    let deleted = storage.delete_webhook("wh-1").expect("Delete failed");
    assert!(deleted);
    let webhooks = storage.load_webhooks().expect("Load webhooks failed");
    assert!(webhooks.is_empty());
}

#[test]
fn test_sqlite_drain_queue() {
    let (storage, _temp) = create_test_storage();

    // Insert jobs into multiple queues
    for i in 1..=5 {
        let job = create_test_job(i, "drain-queue");
        storage.insert_job(&job, "waiting").expect("Insert failed");
    }
    for i in 6..=10 {
        let job = create_test_job(i, "other-queue");
        storage.insert_job(&job, "waiting").expect("Insert failed");
    }

    // Drain only drain-queue
    let drained = storage.drain_queue("drain-queue").expect("Drain failed");
    assert_eq!(drained, 5);

    // other-queue should still have jobs
    let jobs = storage.load_pending_jobs().expect("Load failed");
    assert_eq!(jobs.len(), 5);
    assert!(jobs.iter().all(|(j, _)| j.queue == "other-queue"));
}

#[test]
fn test_sqlite_change_priority() {
    let (storage, _temp) = create_test_storage();
    let job = create_test_job(1, "priority-queue");

    storage.insert_job(&job, "waiting").expect("Insert failed");
    storage
        .change_priority(1, 100)
        .expect("Change priority failed");

    let jobs = storage.load_pending_jobs().expect("Load failed");
    assert_eq!(jobs[0].0.priority, 100);
}

#[test]
fn test_sqlite_recovery_multiple_states() {
    let (storage, _temp) = create_test_storage();

    // Insert jobs in different states
    let job1 = create_test_job(1, "recovery");
    let job2 = create_test_job(2, "recovery");
    let job3 = create_test_job(3, "recovery");
    let job4 = create_test_job(4, "recovery");

    storage.insert_job(&job1, "waiting").expect("Insert failed");
    storage.insert_job(&job2, "delayed").expect("Insert failed");
    storage.insert_job(&job3, "active").expect("Insert failed");
    storage
        .insert_job(&job4, "waiting_children")
        .expect("Insert failed");

    // All should be recovered
    let jobs = storage.load_pending_jobs().expect("Load failed");
    assert_eq!(jobs.len(), 4);

    let states: Vec<&str> = jobs.iter().map(|(_, s)| s.as_str()).collect();
    assert!(states.contains(&"waiting"));
    assert!(states.contains(&"delayed"));
    assert!(states.contains(&"active"));
    assert!(states.contains(&"waiting_children"));
}

#[test]
fn test_sqlite_job_with_complex_data() {
    let (storage, _temp) = create_test_storage();

    let mut job = create_test_job(1, "complex");
    job.data = Arc::new(json!({
        "nested": {"deep": {"value": 123}},
        "array": [1, 2, 3, "mixed"],
        "unicode": "日本語テスト 🚀",
    }));
    job.tags = vec!["tag1".to_string(), "tag2".to_string()];
    job.depends_on = vec![10, 20, 30];
    job.custom_id = Some("custom-123".to_string());
    job.unique_key = Some("unique-key".to_string());

    storage.insert_job(&job, "waiting").expect("Insert failed");

    let jobs = storage.load_pending_jobs().expect("Load failed");
    assert_eq!(jobs.len(), 1);
    let loaded = &jobs[0].0;
    assert_eq!(loaded.tags.len(), 2);
    assert_eq!(loaded.depends_on.len(), 3);
    assert_eq!(loaded.custom_id, Some("custom-123".to_string()));
    assert_eq!(loaded.unique_key, Some("unique-key".to_string()));
}

#[test]
fn test_sqlite_purge_dlq() {
    let (storage, _temp) = create_test_storage();

    // Add jobs to DLQ
    let job1 = create_test_job(1, "purge-queue");
    let job2 = create_test_job(2, "purge-queue");
    let job3 = create_test_job(3, "other-queue");

    storage
        .move_to_dlq(&job1, Some("error"))
        .expect("Move failed");
    storage
        .move_to_dlq(&job2, Some("error"))
        .expect("Move failed");
    storage
        .move_to_dlq(&job3, Some("error"))
        .expect("Move failed");

    // Purge only purge-queue
    let purged = storage.purge_dlq("purge-queue").expect("Purge failed");
    assert_eq!(purged, 2);

    let dlq = storage.load_dlq_jobs().expect("Load DLQ failed");
    assert_eq!(dlq.len(), 1);
    assert_eq!(dlq[0].queue, "other-queue");
}

// ==================== SNAPSHOT TESTS ====================

use super::snapshot::{restore_from_snapshot, SnapshotConfig, SnapshotManager};
use tempfile::TempDir;

/// Helper to create a test SnapshotManager with temp directory.
fn create_test_snapshot_manager() -> (SnapshotManager, TempDir) {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let config = SnapshotConfig {
        interval_secs: 1,
        min_changes: 1,
        keep_count: 3,
        snapshot_dir: temp_dir.path().to_path_buf(),
    };
    let manager = SnapshotManager::new(config);
    (manager, temp_dir)
}

#[test]
fn test_snapshot_config_default() {
    let config = SnapshotConfig::default();
    assert_eq!(config.interval_secs, 60);
    assert_eq!(config.min_changes, 100);
    assert_eq!(config.keep_count, 5);
}

#[test]
fn test_snapshot_manager_creation() {
    let (manager, _temp) = create_test_snapshot_manager();
    // Initially should not need snapshot (no changes)
    assert!(!manager.should_snapshot());
}

#[test]
fn test_snapshot_manager_record_change() {
    let (manager, _temp) = create_test_snapshot_manager();

    // Record changes
    manager.record_change();
    manager.record_change();
    manager.record_change();

    // Should still not snapshot (time not elapsed)
    assert!(!manager.should_snapshot());
}

#[test]
fn test_snapshot_manager_should_snapshot_after_time_and_changes() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let config = SnapshotConfig {
        interval_secs: 0, // Immediate
        min_changes: 1,
        keep_count: 3,
        snapshot_dir: temp_dir.path().to_path_buf(),
    };
    let manager = SnapshotManager::new(config);

    // Record a change
    manager.record_change();

    // Now should need snapshot (time=0, changes>=1)
    assert!(manager.should_snapshot());
}

#[test]
fn test_snapshot_manager_mark_done_resets() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let config = SnapshotConfig {
        interval_secs: 0,
        min_changes: 1,
        keep_count: 3,
        snapshot_dir: temp_dir.path().to_path_buf(),
    };
    let manager = SnapshotManager::new(config);

    manager.record_change();
    assert!(manager.should_snapshot());

    // Mark done
    manager.mark_snapshot_done();

    // Should no longer need snapshot (changes reset to 0)
    assert!(!manager.should_snapshot());
}

#[test]
fn test_snapshot_filename_format() {
    let (manager, _temp) = create_test_snapshot_manager();
    let filename = manager.snapshot_filename();

    // Should be in the snapshot directory
    assert!(filename.starts_with(_temp.path()));

    // Should have .db extension
    assert!(filename.extension().map(|e| e == "db").unwrap_or(false));

    // Should contain "flashq_"
    let name = filename.file_name().unwrap().to_string_lossy();
    assert!(name.starts_with("flashq_"));
}

#[test]
fn test_snapshot_list_empty() {
    let (manager, _temp) = create_test_snapshot_manager();
    let snapshots = manager.list_snapshots();
    assert!(snapshots.is_empty());
}

#[test]
fn test_snapshot_create_backup_and_list() {
    let (storage, _temp_db) = create_test_storage();
    let (manager, temp_snap) = create_test_snapshot_manager();

    // Insert some data
    let job = create_test_job(1, "backup-test");
    storage.insert_job(&job, "waiting").expect("Insert failed");

    // Create backup
    let backup_path = temp_snap.path().join("test_backup.db");
    storage.create_backup(&backup_path).expect("Backup failed");

    // Verify backup exists
    assert!(backup_path.exists());

    // List should find it
    let snapshots = manager.list_snapshots();
    assert_eq!(snapshots.len(), 1);
}

#[test]
fn test_snapshot_cleanup_old() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let config = SnapshotConfig {
        interval_secs: 0,
        min_changes: 0,
        keep_count: 2, // Keep only 2
        snapshot_dir: temp_dir.path().to_path_buf(),
    };
    let manager = SnapshotManager::new(config);

    // Create 4 snapshot files
    for i in 1..=4 {
        let path = temp_dir
            .path()
            .join(format!("flashq_2024010{}_120000.db", i));
        std::fs::write(&path, b"test").expect("Write failed");
        // Add slight delay to ensure different modification times
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    // Verify 4 files exist
    let initial = manager.list_snapshots();
    assert_eq!(initial.len(), 4);

    // Cleanup
    manager.cleanup_old_snapshots();

    // Should only have 2 left (most recent)
    let remaining = manager.list_snapshots();
    assert_eq!(remaining.len(), 2);
}

#[test]
fn test_snapshot_restore() {
    let (storage1, _temp1) = create_test_storage();
    let temp_backup = TempDir::new().expect("Failed to create temp dir");

    // Insert data into first storage
    let job1 = create_test_job(1, "restore-test");
    let job2 = create_test_job(2, "restore-test");
    storage1
        .insert_job(&job1, "waiting")
        .expect("Insert failed");
    storage1.insert_job(&job2, "active").expect("Insert failed");

    // Create backup
    let backup_path = temp_backup.path().join("backup.db");
    storage1.create_backup(&backup_path).expect("Backup failed");

    // Create second storage and restore
    let temp_file2 = NamedTempFile::new().expect("Failed to create temp file");
    let mut conn2 = rusqlite::Connection::open(temp_file2.path()).expect("Open failed");

    restore_from_snapshot(&mut conn2, &backup_path).expect("Restore failed");

    // Verify data was restored
    let count: i64 = conn2
        .query_row("SELECT COUNT(*) FROM jobs", [], |row| row.get(0))
        .expect("Query failed");
    assert_eq!(count, 2);
}

#[test]
fn test_snapshot_restore_nonexistent_file() {
    let temp_file = NamedTempFile::new().expect("Failed to create temp file");
    let mut conn = rusqlite::Connection::open(temp_file.path()).expect("Open failed");

    let nonexistent = std::path::Path::new("/nonexistent/path/to/snapshot.db");
    let result = restore_from_snapshot(&mut conn, nonexistent);

    assert!(result.is_err());
}

#[test]
fn test_snapshot_backup_preserves_all_data() {
    let (storage, _temp_db) = create_test_storage();
    let temp_backup = TempDir::new().expect("Failed to create temp dir");

    // Insert various data types
    let mut job = create_test_job(1, "full-test");
    job.tags = vec!["tag1".to_string(), "tag2".to_string()];
    job.depends_on = vec![100, 200];
    job.custom_id = Some("custom-backup".to_string());
    job.priority = 99;

    storage.insert_job(&job, "waiting").expect("Insert failed");

    // Add a cron job
    let cron = crate::protocol::CronJob {
        name: "backup-cron".to_string(),
        schedule: Some("* * * * *".to_string()),
        queue: "cron-q".to_string(),
        data: json!({"test": true}),
        next_run: 12345,
        repeat_every: None,
        priority: 5,
        executions: 0,
        limit: None,
    };
    storage.save_cron(&cron).expect("Save cron failed");

    // Create backup
    let backup_path = temp_backup.path().join("full_backup.db");
    storage.create_backup(&backup_path).expect("Backup failed");

    // Open backup and verify
    let backup_conn = rusqlite::Connection::open(&backup_path).expect("Open backup failed");

    // Check job data
    let (id, queue, priority): (i64, String, i32) = backup_conn
        .query_row(
            "SELECT id, queue, priority FROM jobs WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("Query job failed");
    assert_eq!(id, 1);
    assert_eq!(queue, "full-test");
    assert_eq!(priority, 99);

    // Check cron data
    let cron_count: i64 = backup_conn
        .query_row("SELECT COUNT(*) FROM cron_jobs", [], |row| row.get(0))
        .expect("Query cron failed");
    assert_eq!(cron_count, 1);
}

#[test]
fn test_snapshot_manager_latest_snapshot() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let config = SnapshotConfig {
        interval_secs: 0,
        min_changes: 0,
        keep_count: 10,
        snapshot_dir: temp_dir.path().to_path_buf(),
    };
    let manager = SnapshotManager::new(config);

    // No snapshots initially
    assert!(manager.latest_snapshot().is_none());

    // Create snapshots with delays
    let path1 = temp_dir.path().join("flashq_20240101_120000.db");
    std::fs::write(&path1, b"old").expect("Write failed");
    std::thread::sleep(std::time::Duration::from_millis(20));

    let path2 = temp_dir.path().join("flashq_20240102_120000.db");
    std::fs::write(&path2, b"new").expect("Write failed");

    // Latest should be the second one (by modification time)
    let latest = manager.latest_snapshot();
    assert!(latest.is_some());
    assert!(latest.unwrap().to_string_lossy().contains("20240102"));
}
