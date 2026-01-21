//! Criterion benchmarks for flashQ queue operations.
//!
//! Run with: cargo bench
//! Results saved to: target/criterion/

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use serde_json::json;
use std::sync::Arc;

use flashq_server::protocol::JobInput;
use flashq_server::queue::QueueManager;

/// Create a test job input.
fn create_job_input() -> JobInput {
    JobInput {
        data: json!({"task": "benchmark", "value": 42}),
        priority: 0,
        delay: None,
        ttl: None,
        timeout: None,
        max_attempts: Some(3),
        backoff: None,
        unique_key: None,
        depends_on: None,
        tags: None,
        lifo: false,
        remove_on_complete: false,
        remove_on_fail: false,
        stall_timeout: None,
        debounce_id: None,
        debounce_ttl: None,
        job_id: None,
        keep_completed_age: None,
        keep_completed_count: None,
        group_id: None,
    }
}

/// Benchmark single push operation.
fn bench_push(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let qm = rt.block_on(async { QueueManager::new(false) });

    let mut group = c.benchmark_group("queue_push");
    group.throughput(Throughput::Elements(1));

    group.bench_function("single", |b| {
        b.to_async(&rt).iter(|| async {
            let input = create_job_input();
            qm.push("bench-push".to_string(), input).await.unwrap()
        })
    });

    group.finish();
}

/// Benchmark batch push operations.
fn bench_push_batch(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let qm = rt.block_on(async { QueueManager::new(false) });

    let mut group = c.benchmark_group("queue_push_batch");

    for batch_size in [10, 100, 1000].iter() {
        group.throughput(Throughput::Elements(*batch_size as u64));

        group.bench_with_input(
            BenchmarkId::from_parameter(batch_size),
            batch_size,
            |b, &size| {
                b.to_async(&rt).iter(|| async {
                    let jobs: Vec<JobInput> = (0..size).map(|_| create_job_input()).collect();
                    qm.push_batch("bench-batch".to_string(), jobs).await
                })
            },
        );
    }

    group.finish();
}

/// Benchmark push + pull cycle.
fn bench_push_pull(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let qm = rt.block_on(async { QueueManager::new(false) });

    let mut group = c.benchmark_group("queue_push_pull");
    group.throughput(Throughput::Elements(1));

    group.bench_function("cycle", |b| {
        b.to_async(&rt).iter(|| async {
            let input = create_job_input();
            let job = qm.push("bench-cycle".to_string(), input).await.unwrap();
            let pulled = qm.pull("bench-cycle").await;
            assert_eq!(pulled.id, job.id);
            pulled
        })
    });

    group.finish();
}

/// Benchmark full job lifecycle: push -> pull -> ack.
fn bench_full_lifecycle(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let qm = rt.block_on(async { QueueManager::new(false) });

    let mut group = c.benchmark_group("queue_lifecycle");
    group.throughput(Throughput::Elements(1));

    group.bench_function("push_pull_ack", |b| {
        b.to_async(&rt).iter(|| async {
            let input = create_job_input();
            let _job = qm.push("bench-lifecycle".to_string(), input).await.unwrap();
            let pulled = qm.pull("bench-lifecycle").await;
            qm.ack(pulled.id, Some(json!({"result": "ok"}))).await.ok()
        })
    });

    group.finish();
}

/// Benchmark pull from empty queue (should return immediately).
fn bench_pull_empty(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let qm = rt.block_on(async { QueueManager::new(false) });

    let mut group = c.benchmark_group("queue_pull_empty");

    group.bench_function("empty_queue", |b| {
        b.to_async(&rt)
            .iter(|| async { qm.pull("bench-empty-queue").await })
    });

    group.finish();
}

/// Benchmark concurrent push from multiple tasks.
fn bench_concurrent_push(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let qm = Arc::new(rt.block_on(async { QueueManager::new(false) }));

    let mut group = c.benchmark_group("queue_concurrent");
    group.throughput(Throughput::Elements(100));

    group.bench_function("100_concurrent_push", |b| {
        b.to_async(&rt).iter(|| {
            let qm = Arc::clone(&qm);
            async move {
                let handles: Vec<_> = (0..100)
                    .map(|i| {
                        let qm = Arc::clone(&qm);
                        tokio::spawn(async move {
                            let input = create_job_input();
                            qm.push(format!("bench-concurrent-{}", i % 10), input)
                                .await
                                .unwrap()
                        })
                    })
                    .collect();

                for handle in handles {
                    handle.await.unwrap();
                }
            }
        })
    });

    group.finish();
}

/// Benchmark stats collection.
fn bench_stats(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let qm = rt.block_on(async { QueueManager::new(false) });

    // Pre-populate with some jobs
    rt.block_on(async {
        for i in 0..100 {
            let input = create_job_input();
            qm.push(format!("bench-stats-{}", i % 5), input)
                .await
                .unwrap();
        }
    });

    let mut group = c.benchmark_group("queue_stats");

    group.bench_function("stats", |b| {
        b.to_async(&rt).iter(|| async { qm.stats().await })
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_push,
    bench_push_batch,
    bench_push_pull,
    bench_full_lifecycle,
    bench_pull_empty,
    bench_concurrent_push,
    bench_stats,
);

criterion_main!(benches);
