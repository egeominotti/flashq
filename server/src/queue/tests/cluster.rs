//! Cluster mode tests.
//!
//! These tests require PostgreSQL and CLUSTER_MODE=1.
//! Run with: CLUSTER_MODE=1 DATABASE_URL=postgres://... cargo test -- --ignored

#![allow(unused_imports)]
use super::*;

#[tokio::test]
#[ignore = "Requires PostgreSQL with CLUSTER_MODE - run with: CLUSTER_MODE=1 DATABASE_URL=postgres://... cargo test -- --ignored"]
async fn test_cluster_leader_election() {
    use crate::queue::cluster::ClusterManager;

    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

    // Create connection pool
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("Failed to connect");

    // Create cluster manager
    let cm = ClusterManager::new(
        "test-node-1".to_string(),
        "localhost".to_string(),
        6789,
        Some(pool.clone()),
    );

    // Initialize tables
    cm.init_tables().await.expect("Failed to init tables");

    // Try to become leader
    cm.try_become_leader()
        .await
        .expect("Leader election failed");

    // Should be leader (only node)
    assert!(cm.is_leader());

    // Register node
    cm.register_node().await.expect("Registration failed");

    // Get nodes
    let nodes = cm.list_nodes().await.expect("Get nodes failed");
    assert!(!nodes.is_empty());

    // Clean up
    sqlx::query("DELETE FROM cluster_nodes WHERE node_id = $1")
        .bind("test-node-1")
        .execute(&pool)
        .await
        .ok();
}

#[tokio::test]
#[ignore = "Requires PostgreSQL with CLUSTER_MODE - run with: CLUSTER_MODE=1 DATABASE_URL=postgres://... cargo test -- --ignored"]
async fn test_cluster_node_heartbeat() {
    use crate::queue::cluster::ClusterManager;

    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("Failed to connect");

    let cm = ClusterManager::new(
        "test-node-heartbeat".to_string(),
        "localhost".to_string(),
        6790,
        Some(pool.clone()),
    );

    cm.init_tables().await.expect("Init failed");
    cm.register_node().await.expect("Register failed");

    // Update heartbeat
    cm.heartbeat().await.expect("Heartbeat failed");

    // Query heartbeat timestamp
    let result: (i64,) = sqlx::query_as::<sqlx::Postgres, (i64,)>(
        "SELECT EXTRACT(EPOCH FROM last_heartbeat)::bigint FROM cluster_nodes WHERE node_id = $1",
    )
    .bind("test-node-heartbeat")
    .fetch_one(&pool)
    .await
    .expect("Query failed");

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    // Heartbeat should be within last 5 seconds
    assert!(now - result.0 < 5);

    // Clean up
    sqlx::query("DELETE FROM cluster_nodes WHERE node_id = $1")
        .bind("test-node-heartbeat")
        .execute(&pool)
        .await
        .ok();
}

#[tokio::test]
#[ignore = "Requires PostgreSQL with CLUSTER_MODE - run with: CLUSTER_MODE=1 DATABASE_URL=postgres://... cargo test -- --ignored"]
async fn test_cluster_stale_node_cleanup() {
    use crate::queue::cluster::ClusterManager;

    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("Failed to connect");

    let cm = ClusterManager::new(
        "test-node-cleanup".to_string(),
        "localhost".to_string(),
        6791,
        Some(pool.clone()),
    );

    cm.init_tables().await.expect("Init failed");

    // Insert a stale node (heartbeat 1 hour ago)
    sqlx::query(
        "INSERT INTO cluster_nodes (node_id, host, port, last_heartbeat)
         VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour')
         ON CONFLICT (node_id) DO UPDATE SET last_heartbeat = NOW() - INTERVAL '1 hour'",
    )
    .bind("stale-node")
    .bind("localhost")
    .bind(9999)
    .execute(&pool)
    .await
    .expect("Insert failed");

    // Run cleanup
    cm.cleanup_stale_nodes().await.expect("Cleanup failed");

    // Stale node should be removed
    let result: Option<(String,)> = sqlx::query_as::<sqlx::Postgres, (String,)>(
        "SELECT node_id FROM cluster_nodes WHERE node_id = $1",
    )
    .bind("stale-node")
    .fetch_optional(&pool)
    .await
    .expect("Query failed");

    assert!(result.is_none(), "Stale node should have been cleaned up");
}

#[tokio::test]
#[ignore = "Requires PostgreSQL with CLUSTER_MODE - run with: CLUSTER_MODE=1 DATABASE_URL=postgres://... cargo test -- --ignored"]
async fn test_cluster_load_balancing() {
    use crate::queue::cluster::{ClusterManager, LoadBalanceStrategy};

    let db_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .expect("Failed to connect");

    let cm = ClusterManager::new(
        "test-lb-node".to_string(),
        "localhost".to_string(),
        6792,
        Some(pool.clone()),
    );

    cm.init_tables().await.expect("Init failed");

    // Set load balancing strategy
    cm.set_load_balance_strategy(LoadBalanceStrategy::LeastConnections);
    assert_eq!(
        cm.load_balance_strategy(),
        LoadBalanceStrategy::LeastConnections
    );

    cm.set_load_balance_strategy(LoadBalanceStrategy::RoundRobin);
    assert_eq!(cm.load_balance_strategy(), LoadBalanceStrategy::RoundRobin);

    // Clean up
    sqlx::query("DELETE FROM cluster_nodes WHERE node_id = $1")
        .bind("test-lb-node")
        .execute(&pool)
        .await
        .ok();
}
