//! SQLite snapshot operations for flashQ.
//!
//! Provides:
//! - Periodic snapshots with configurable intervals
//! - Local backup files with retention
//! - Restore from snapshot

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::{error, info};

use crate::protocol::Job;

/// Snapshot configuration
#[derive(Debug, Clone)]
pub struct SnapshotConfig {
    /// Interval between snapshots in seconds
    pub interval_secs: u64,
    /// Minimum changes before snapshot
    pub min_changes: u64,
    /// Number of local snapshots to keep
    pub keep_count: usize,
    /// Directory for snapshot files
    pub snapshot_dir: PathBuf,
}

impl Default for SnapshotConfig {
    fn default() -> Self {
        Self {
            interval_secs: 60,
            min_changes: 100,
            keep_count: 5,
            snapshot_dir: PathBuf::from("./snapshots"),
        }
    }
}

impl SnapshotConfig {
    /// Create from environment variables
    pub fn from_env() -> Option<Self> {
        let enabled = std::env::var("SNAPSHOT_ENABLED")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false);

        if !enabled {
            return None;
        }

        Some(Self {
            interval_secs: std::env::var("SNAPSHOT_INTERVAL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60),
            min_changes: std::env::var("SNAPSHOT_MIN_CHANGES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(100),
            keep_count: std::env::var("SNAPSHOT_KEEP_COUNT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5),
            snapshot_dir: std::env::var("SNAPSHOT_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("./snapshots")),
        })
    }
}

/// Snapshot manager for periodic backups
pub struct SnapshotManager {
    config: SnapshotConfig,
    last_snapshot: AtomicU64,
    change_count: AtomicU64,
}

impl SnapshotManager {
    pub fn new(config: SnapshotConfig) -> Self {
        // Create snapshot directory
        std::fs::create_dir_all(&config.snapshot_dir).ok();

        Self {
            config,
            last_snapshot: AtomicU64::new(crate::queue::types::now_ms()),
            change_count: AtomicU64::new(0),
        }
    }

    /// Record a change
    pub fn record_change(&self) {
        self.change_count.fetch_add(1, Ordering::Relaxed);
    }

    /// Check if snapshot is needed
    pub fn should_snapshot(&self) -> bool {
        let now = crate::queue::types::now_ms();
        let last = self.last_snapshot.load(Ordering::Relaxed);
        let changes = self.change_count.load(Ordering::Relaxed);

        let elapsed_secs = (now - last) / 1000;
        elapsed_secs >= self.config.interval_secs && changes >= self.config.min_changes
    }

    /// Mark snapshot as done
    pub fn mark_snapshot_done(&self) {
        self.last_snapshot.store(crate::queue::types::now_ms(), Ordering::Relaxed);
        self.change_count.store(0, Ordering::Relaxed);
    }

    /// Get snapshot filename with timestamp
    pub fn snapshot_filename(&self) -> PathBuf {
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        self.config.snapshot_dir.join(format!("flashq_{}.db", timestamp))
    }

    /// Cleanup old snapshots, keeping only the most recent N
    pub fn cleanup_old_snapshots(&self) {
        let dir = &self.config.snapshot_dir;
        if !dir.exists() {
            return;
        }

        let mut snapshots: Vec<_> = std::fs::read_dir(dir)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "db").unwrap_or(false))
            .collect();

        // Sort by modification time (newest first)
        snapshots.sort_by(|a, b| {
            let a_time = a.metadata().and_then(|m| m.modified()).ok();
            let b_time = b.metadata().and_then(|m| m.modified()).ok();
            b_time.cmp(&a_time)
        });

        // Remove old snapshots
        for snapshot in snapshots.iter().skip(self.config.keep_count) {
            if let Err(e) = std::fs::remove_file(snapshot.path()) {
                error!(path = ?snapshot.path(), error = %e, "Failed to remove old snapshot");
            }
        }
    }

    /// List available snapshots (newest first)
    pub fn list_snapshots(&self) -> Vec<PathBuf> {
        let dir = &self.config.snapshot_dir;
        if !dir.exists() {
            return vec![];
        }

        let mut snapshots: Vec<_> = std::fs::read_dir(dir)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "db").unwrap_or(false))
            .map(|e| e.path())
            .collect();

        snapshots.sort_by(|a, b| b.cmp(a));
        snapshots
    }

    /// Get the latest snapshot path
    pub fn latest_snapshot(&self) -> Option<PathBuf> {
        self.list_snapshots().into_iter().next()
    }
}

/// Snapshot all jobs to database (atomic replace).
pub fn snapshot_all(
    conn: &Connection,
    jobs: &[(Job, String)],
    dlq_jobs: &[(Job, Option<String>)],
) -> Result<(), rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;

    // Clear existing data
    tx.execute("DELETE FROM jobs", [])?;
    tx.execute("DELETE FROM dlq_jobs", [])?;

    // Insert all jobs
    for (job, state) in jobs {
        super::jobs::insert_job(&tx, job, state)?;
    }

    // Insert DLQ jobs
    for (job, error) in dlq_jobs {
        super::jobs::move_to_dlq(&tx, job, error.as_deref())?;
    }

    tx.commit()?;
    info!(jobs = jobs.len(), dlq = dlq_jobs.len(), "Snapshot completed");
    Ok(())
}

/// Create a backup file using SQLite's backup API.
pub fn create_backup(conn: &Connection, backup_path: &Path) -> Result<(), rusqlite::Error> {
    // Use SQLite's built-in backup API for consistent backup
    let mut backup_conn = Connection::open(backup_path)?;
    let backup = rusqlite::backup::Backup::new(conn, &mut backup_conn)?;
    backup.run_to_completion(100, std::time::Duration::from_millis(10), None)?;
    info!(path = ?backup_path, "Backup created");
    Ok(())
}

/// Restore from a snapshot file.
pub fn restore_from_snapshot(target_conn: &mut Connection, snapshot_path: &Path) -> Result<(), rusqlite::Error> {
    if !snapshot_path.exists() {
        return Err(rusqlite::Error::InvalidPath(snapshot_path.to_path_buf()));
    }

    let source_conn = Connection::open(snapshot_path)?;
    let backup = rusqlite::backup::Backup::new(&source_conn, target_conn)?;
    backup.run_to_completion(100, std::time::Duration::from_millis(10), None)?;
    info!(path = ?snapshot_path, "Restored from snapshot");
    Ok(())
}
