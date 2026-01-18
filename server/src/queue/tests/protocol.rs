//! Protocol and Job struct method tests.

use super::*;

#[test]
fn test_job_is_ready() {
    let now = 1000u64;

    let job = crate::protocol::Job {
        id: 1,
        queue: "test".to_string(),
        data: json!({}),
        priority: 0,
        created_at: 900,
        run_at: 950, // In the past
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
    };

    assert!(job.is_ready(now));

    let delayed_job = crate::protocol::Job {
        run_at: 2000, // In the future
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
        ttl: 400, // Expires at 900
        timeout: 0,
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
    };

    assert!(job.is_expired(now)); // 1000 > 900

    let valid_job = crate::protocol::Job {
        ttl: 600, // Expires at 1100
        ..job.clone()
    };

    assert!(!valid_job.is_expired(now)); // 1000 < 1100

    let no_ttl_job = crate::protocol::Job {
        ttl: 0, // No TTL
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
        timeout: 300, // Times out at 900
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
    };

    assert!(job.is_timed_out(now)); // 1000 > 900

    let valid_job = crate::protocol::Job {
        timeout: 500, // Times out at 1100
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
        backoff: 1000, // 1 second base
        ttl: 0,
        timeout: 0,
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
    };

    // Exponential backoff: base * 2^attempts
    assert_eq!(job.next_backoff(), 1000); // 1000 * 2^0

    let job1 = crate::protocol::Job {
        attempts: 1,
        ..job.clone()
    };
    assert_eq!(job1.next_backoff(), 2000); // 1000 * 2^1

    let job2 = crate::protocol::Job {
        attempts: 2,
        ..job.clone()
    };
    assert_eq!(job2.next_backoff(), 4000); // 1000 * 2^2

    let no_backoff = crate::protocol::Job {
        backoff: 0,
        ..job.clone()
    };
    assert_eq!(no_backoff.next_backoff(), 0); // No backoff configured
}
