import { Card, Title, Text, Badge, ProgressBar, Grid } from '@tremor/react';
import { HardDrive, Database, Activity, Zap } from 'lucide-react';
import { formatNumber } from '../../utils';
import { EmptyState, StorageItem, JobDistItem } from '../../components/common';
import type { SqliteStats } from '../../api/client';

interface StorageTabProps {
  sqliteStats: SqliteStats | null;
}

export function StorageTab({ sqliteStats }: StorageTabProps) {
  // Ensure no negative values
  const totalJobs = Math.max(0, sqliteStats?.total_jobs ?? 0);
  const queuedJobs = Math.max(0, sqliteStats?.queued_jobs ?? 0);
  const processingJobs = Math.max(0, sqliteStats?.processing_jobs ?? 0);
  const completedJobs = Math.max(0, sqliteStats?.completed_jobs ?? 0);
  const delayedJobs = Math.max(0, sqliteStats?.delayed_jobs ?? 0);
  const failedJobs = Math.max(0, sqliteStats?.failed_jobs ?? 0);
  const fileSizeMb = Math.max(0, sqliteStats?.file_size_mb ?? 0);
  const queueLen = Math.max(0, sqliteStats?.async_writer_queue_len ?? 0);
  const maxBatchSize = Math.max(1, sqliteStats?.async_writer_max_batch_size ?? 100);
  const opsQueued = Math.max(0, sqliteStats?.async_writer_ops_queued ?? 0);
  const opsWritten = Math.max(0, sqliteStats?.async_writer_ops_written ?? 0);
  const batchesWritten = Math.max(0, sqliteStats?.async_writer_batches_written ?? 0);

  return (
    <Grid numItemsSm={1} numItemsLg={2} className="mt-6 gap-4">
      <Card className="info-card">
        <div className="info-card-header">
          <div>
            <Title className="info-card-title">SQLite Database</Title>
            <Text className="info-card-subtitle">Persistent storage metrics</Text>
          </div>
          <Badge color={sqliteStats?.enabled ? 'emerald' : 'zinc'} size="xs">
            {sqliteStats?.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
        {sqliteStats?.enabled ? (
          <div className="storage-list">
            <StorageItem
              icon={<HardDrive className="h-4 w-4" />}
              iconColor="cyan"
              label="Database Size"
              value={`${fileSizeMb.toFixed(2)} MB`}
            />
            <StorageItem
              icon={<Database className="h-4 w-4" />}
              iconColor="blue"
              label="Total Jobs"
              value={formatNumber(totalJobs)}
            />
            <StorageItem
              icon={<Activity className="h-4 w-4" />}
              iconColor="emerald"
              label="Queued Jobs"
              value={formatNumber(queuedJobs)}
            />
            <StorageItem
              icon={<Zap className="h-4 w-4" />}
              iconColor="violet"
              label="Processing"
              value={formatNumber(processingJobs)}
            />
            {sqliteStats.path && (
              <div className="storage-path">
                <span className="storage-path-label">Path:</span>
                <code className="storage-path-value">{sqliteStats.path}</code>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<Database className="h-8 w-8" />}
            title="SQLite not enabled"
            description="Enable SQLite persistence in Settings to see storage metrics"
          />
        )}
      </Card>

      <Card className="info-card">
        <div className="info-card-header">
          <div>
            <Title className="info-card-title">Async Writer</Title>
            <Text className="info-card-subtitle">Background write operations</Text>
          </div>
          <Badge color={sqliteStats?.async_writer_enabled ? 'emerald' : 'zinc'} size="xs">
            {sqliteStats?.async_writer_enabled ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        {sqliteStats?.async_writer_enabled ? (
          <div className="writer-stats">
            <div className="writer-stat-main">
              <div className="writer-stat-header">
                <Text>Queue Length</Text>
                <Text className="writer-stat-value">{queueLen}</Text>
              </div>
              <ProgressBar
                value={Math.min((queueLen / maxBatchSize) * 100, 100)}
                color="cyan"
              />
            </div>
            <div className="writer-info-grid">
              <div className="writer-info-item">
                <span className="writer-info-label">Ops Queued</span>
                <span className="writer-info-value">{formatNumber(opsQueued)}</span>
              </div>
              <div className="writer-info-item">
                <span className="writer-info-label">Ops Written</span>
                <span className="writer-info-value">{formatNumber(opsWritten)}</span>
              </div>
              <div className="writer-info-item">
                <span className="writer-info-label">Batches</span>
                <span className="writer-info-value">{formatNumber(batchesWritten)}</span>
              </div>
              <div className="writer-info-item">
                <span className="writer-info-label">Batch Size</span>
                <span className="writer-info-value">{maxBatchSize}</span>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Zap className="h-8 w-8" />}
            title="Async writer not active"
            description="Enable SQLite with async writer for background writes"
          />
        )}
      </Card>

      {sqliteStats?.enabled && (
        <Card className="info-card col-span-full">
          <div className="info-card-header">
            <div>
              <Title className="info-card-title">Job Distribution</Title>
              <Text className="info-card-subtitle">Jobs by state in database</Text>
            </div>
          </div>
          <div className="job-dist-grid">
            <JobDistItem label="Queued" count={queuedJobs} total={totalJobs} color="cyan" />
            <JobDistItem label="Processing" count={processingJobs} total={totalJobs} color="blue" />
            <JobDistItem label="Completed" count={completedJobs} total={totalJobs} color="emerald" />
            <JobDistItem label="Delayed" count={delayedJobs} total={totalJobs} color="amber" />
            <JobDistItem label="Failed" count={failedJobs} total={totalJobs} color="rose" />
          </div>
        </Card>
      )}
    </Grid>
  );
}
