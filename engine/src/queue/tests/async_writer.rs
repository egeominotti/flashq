//! Tests for AsyncWriter - non-blocking SQLite persistence.

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use crate::protocol::Job;
use crate::queue::sqlite::{AsyncWriter, AsyncWriterConfig, WriteOp};

/// Create a test Job.
fn create_test_job(id: u64, queue: &str) -> Job {
    Job {
        id,
        queue: queue.into(),
        data: std::sync::Arc::new(serde_json::json!({"test": true})),
        priority: 0,
        created_at: 0,
        run_at: 0,
        started_at: 0,
        attempts: 0,
        max_attempts: 3,
        backoff: 1000,
        ttl: 0,
        timeout: 30000,
        unique_key: None,
        depends_on: Vec::new(),
        progress: 0,
        progress_msg: None,
        tags: Vec::new(),
        lifo: false,
        remove_on_complete: false,
        remove_on_fail: false,
        last_heartbeat: 0,
        stall_timeout: 0,
        stall_count: 0,
        parent_id: None,
        children_ids: Vec::new(),
        children_completed: 0,
        custom_id: None,
        keep_completed_age: 0,
        keep_completed_count: 0,
        completed_at: 0,
        group_id: None,
    }
}

#[test]
fn test_async_writer_config_default() {
    let config = AsyncWriterConfig::default();
    assert_eq!(config.batch_interval_ms, 50);
    assert_eq!(config.max_batch_size, 1000);
    assert_eq!(config.queue_capacity, 100_000);
}

#[test]
fn test_async_writer_creation() {
    let config = AsyncWriterConfig {
        batch_interval_ms: 10,
        max_batch_size: 100,
        queue_capacity: 1000,
    };
    // Use a non-existent path - we won't start the writer
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_async_writer.db"), config);
    assert_eq!(writer.queue_len(), 0);
    assert_eq!(writer.get_batch_interval_ms(), 10);
    assert_eq!(writer.get_max_batch_size(), 100);
}

#[test]
fn test_async_writer_queue_op() {
    let config = AsyncWriterConfig::default();
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_queue_op.db"), config);

    let job = create_test_job(1, "test-queue");
    writer.queue_op(WriteOp::InsertJob {
        job: Box::new(job),
        state: "waiting".to_string(),
    });

    assert_eq!(writer.queue_len(), 1);
}

#[test]
fn test_async_writer_queue_multiple_ops() {
    let config = AsyncWriterConfig::default();
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_multiple_ops.db"), config);

    for i in 0..10 {
        let job = create_test_job(i, "test-queue");
        writer.queue_op(WriteOp::InsertJob {
            job: Box::new(job),
            state: "waiting".to_string(),
        });
    }

    assert_eq!(writer.queue_len(), 10);
}

#[test]
fn test_async_writer_queue_ops_batch() {
    let config = AsyncWriterConfig::default();
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_batch.db"), config);

    let jobs: Vec<Job> = (0..5).map(|i| create_test_job(i, "batch-queue")).collect();
    writer.queue_op(WriteOp::InsertJobsBatch {
        jobs,
        state: "waiting".to_string(),
    });

    assert_eq!(writer.queue_len(), 1); // One batched operation
}

#[test]
fn test_async_writer_stats() {
    let config = AsyncWriterConfig::default();
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_stats.db"), config);

    // Queue some operations
    for i in 0..5 {
        let job = create_test_job(i, "test-queue");
        writer.queue_op(WriteOp::InsertJob {
            job: Box::new(job),
            state: "waiting".to_string(),
        });
    }

    let stats = writer.stats();
    assert_eq!(stats.ops_queued.load(Ordering::Relaxed), 5);
}

#[test]
fn test_async_writer_set_batch_interval() {
    let config = AsyncWriterConfig {
        batch_interval_ms: 10,
        max_batch_size: 100,
        queue_capacity: 1000,
    };
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_interval.db"), config);

    assert_eq!(writer.get_batch_interval_ms(), 10);

    writer.set_batch_interval_ms(100);
    assert_eq!(writer.get_batch_interval_ms(), 100);

    writer.set_batch_interval_ms(25);
    assert_eq!(writer.get_batch_interval_ms(), 25);
}

#[test]
fn test_async_writer_set_max_batch_size() {
    let config = AsyncWriterConfig {
        batch_interval_ms: 50,
        max_batch_size: 100,
        queue_capacity: 1000,
    };
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_batch_size.db"), config);

    assert_eq!(writer.get_max_batch_size(), 100);

    writer.set_max_batch_size(500);
    assert_eq!(writer.get_max_batch_size(), 500);

    writer.set_max_batch_size(50);
    assert_eq!(writer.get_max_batch_size(), 50);
}

#[test]
fn test_async_writer_config_getter() {
    let config = AsyncWriterConfig {
        batch_interval_ms: 10,
        max_batch_size: 100,
        queue_capacity: 1000,
    };
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_config.db"), config);

    let retrieved_config = writer.config();
    assert_eq!(retrieved_config.batch_interval_ms, 10);
    assert_eq!(retrieved_config.max_batch_size, 100);
    assert_eq!(retrieved_config.queue_capacity, 1000);
}

#[test]
fn test_async_writer_high_water_mark() {
    let config = AsyncWriterConfig::default();
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_high_water.db"), config);

    // Queue many operations
    for i in 0..50 {
        let job = create_test_job(i, "test-queue");
        writer.queue_op(WriteOp::InsertJob {
            job: Box::new(job),
            state: "waiting".to_string(),
        });
    }

    let stats = writer.stats();
    assert!(stats.queue_high_water.load(Ordering::Relaxed) >= 50);
}

#[test]
fn test_write_op_variants() {
    let config = AsyncWriterConfig::default();
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_variants.db"), config);
    let job = create_test_job(1, "test");

    // Test InsertJob
    writer.queue_op(WriteOp::InsertJob {
        job: Box::new(job.clone()),
        state: "waiting".to_string(),
    });

    // Test AckJob
    writer.queue_op(WriteOp::AckJob {
        job_id: 1,
        result: Some(serde_json::json!({"done": true})),
    });

    // Test AckJobsBatch
    writer.queue_op(WriteOp::AckJobsBatch { ids: vec![2, 3, 4] });

    // Test FailJob
    writer.queue_op(WriteOp::FailJob {
        job_id: 5,
        new_run_at: 1000,
        attempts: 1,
    });

    // Test MoveToDlq
    writer.queue_op(WriteOp::MoveToDlq {
        job: Box::new(job.clone()),
        error: Some("Test error".to_string()),
    });

    // Test CancelJob
    writer.queue_op(WriteOp::CancelJob { job_id: 6 });

    // Test UpdateState
    writer.queue_op(WriteOp::UpdateState {
        job_id: 7,
        state: "active".to_string(),
    });

    // Test UpdateProgress
    writer.queue_op(WriteOp::UpdateProgress {
        job_id: 8,
        progress: 50,
        message: Some("Halfway done".to_string()),
    });

    // Test ChangePriority
    writer.queue_op(WriteOp::ChangePriority {
        job_id: 9,
        priority: 10,
    });

    // Test Flush
    writer.queue_op(WriteOp::Flush);

    assert_eq!(writer.queue_len(), 10);
}

#[test]
fn test_async_writer_runtime_config_changes() {
    let config = AsyncWriterConfig {
        batch_interval_ms: 10,
        max_batch_size: 100,
        queue_capacity: 1000,
    };
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_runtime.db"), config);

    // Initial values
    assert_eq!(writer.get_batch_interval_ms(), 10);
    assert_eq!(writer.get_max_batch_size(), 100);

    // Change batch interval
    writer.set_batch_interval_ms(200);
    assert_eq!(writer.get_batch_interval_ms(), 200);

    // Change max batch size
    writer.set_max_batch_size(500);
    assert_eq!(writer.get_max_batch_size(), 500);

    // Original config should remain unchanged
    let original_config = writer.config();
    assert_eq!(original_config.batch_interval_ms, 10);
    assert_eq!(original_config.max_batch_size, 100);
}

#[test]
fn test_async_writer_queue_ops_iterator() {
    let config = AsyncWriterConfig::default();
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_iterator.db"), config);

    // Test queue_ops with iterator
    let ops = vec![
        WriteOp::InsertJob {
            job: Box::new(create_test_job(1, "q")),
            state: "waiting".to_string(),
        },
        WriteOp::InsertJob {
            job: Box::new(create_test_job(2, "q")),
            state: "waiting".to_string(),
        },
        WriteOp::InsertJob {
            job: Box::new(create_test_job(3, "q")),
            state: "waiting".to_string(),
        },
    ];

    writer.queue_ops(ops);

    assert_eq!(writer.queue_len(), 3);
    assert_eq!(writer.stats().ops_queued.load(Ordering::Relaxed), 3);
}

#[test]
fn test_async_writer_batch_size_trigger() {
    // Create writer with small batch size
    let config = AsyncWriterConfig {
        batch_interval_ms: 1000, // Long interval
        max_batch_size: 5,       // Small batch size
        queue_capacity: 100,
    };
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_trigger.db"), config);

    // Queue operations up to batch size
    for i in 0..5 {
        let job = create_test_job(i, "test");
        writer.queue_op(WriteOp::InsertJob {
            job: Box::new(job),
            state: "waiting".to_string(),
        });
    }

    // Queue should have all 5 ops
    assert_eq!(writer.queue_len(), 5);
}

#[test]
fn test_async_writer_empty_ops_queued() {
    let config = AsyncWriterConfig::default();
    let writer = AsyncWriter::new(PathBuf::from("/tmp/test_empty.db"), config);

    // Without queuing anything
    assert_eq!(writer.queue_len(), 0);
    assert_eq!(writer.stats().ops_queued.load(Ordering::Relaxed), 0);
    assert_eq!(writer.stats().ops_written.load(Ordering::Relaxed), 0);
    assert_eq!(writer.stats().batches_written.load(Ordering::Relaxed), 0);
}
