import { Card, Title, Text, Badge, Grid } from '@tremor/react';
import { HardDrive, Database, Activity, Zap } from 'lucide-react';
import { formatNumber } from '../../utils';
import { EmptyState, StorageItem, JobDistItem } from '../../components/common';
import type { StorageStats } from '../../api/client';

interface StorageTabProps {
  storageStats: StorageStats | null;
}

export function StorageTab({ storageStats }: StorageTabProps) {
  // Ensure no negative values
  const totalJobs = Math.max(0, storageStats?.total_jobs ?? 0);
  const queuedJobs = Math.max(0, storageStats?.queued_jobs ?? 0);
  const processingJobs = Math.max(0, storageStats?.processing_jobs ?? 0);
  const completedJobs = Math.max(0, storageStats?.completed_jobs ?? 0);
  const delayedJobs = Math.max(0, storageStats?.delayed_jobs ?? 0);
  const failedJobs = Math.max(0, storageStats?.failed_jobs ?? 0);
  const streamMessages = Math.max(0, storageStats?.stream_messages ?? 0);
  const streamBytes = Math.max(0, storageStats?.stream_bytes ?? 0);
  const kvKeys = Math.max(0, storageStats?.kv_keys ?? 0);

  return (
    <Grid numItemsSm={1} numItemsLg={2} className="mt-6 gap-4">
      <Card className="info-card">
        <div className="info-card-header">
          <div>
            <Title className="info-card-title">NATS JetStream Storage</Title>
            <Text className="info-card-subtitle">Distributed persistence metrics</Text>
          </div>
          <Badge color={storageStats?.enabled ? 'emerald' : 'zinc'} size="xs">
            {storageStats?.enabled ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>
        {storageStats?.enabled ? (
          <div className="storage-list">
            <StorageItem
              icon={<HardDrive className="h-4 w-4" />}
              iconColor="cyan"
              label="Stream Messages"
              value={formatNumber(streamMessages)}
            />
            <StorageItem
              icon={<Database className="h-4 w-4" />}
              iconColor="blue"
              label="Stream Size"
              value={`${(streamBytes / 1024 / 1024).toFixed(2)} MB`}
            />
            <StorageItem
              icon={<Activity className="h-4 w-4" />}
              iconColor="emerald"
              label="KV Store Keys"
              value={formatNumber(kvKeys)}
            />
            <StorageItem
              icon={<Zap className="h-4 w-4" />}
              iconColor="violet"
              label="Total Jobs"
              value={formatNumber(totalJobs)}
            />
            {storageStats.nats_url && (
              <div className="storage-path">
                <span className="storage-path-label">NATS URL:</span>
                <code className="storage-path-value">{storageStats.nats_url}</code>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<Database className="h-8 w-8" />}
            title="Storage not connected"
            description="Connect to NATS JetStream to see storage metrics"
          />
        )}
      </Card>

      <Card className="info-card">
        <div className="info-card-header">
          <div>
            <Title className="info-card-title">Job Statistics</Title>
            <Text className="info-card-subtitle">Current job state distribution</Text>
          </div>
        </div>
        {storageStats?.enabled ? (
          <div className="storage-list">
            <StorageItem
              icon={<Activity className="h-4 w-4" />}
              iconColor="cyan"
              label="Queued"
              value={formatNumber(queuedJobs)}
            />
            <StorageItem
              icon={<Zap className="h-4 w-4" />}
              iconColor="blue"
              label="Processing"
              value={formatNumber(processingJobs)}
            />
            <StorageItem
              icon={<Database className="h-4 w-4" />}
              iconColor="emerald"
              label="Completed"
              value={formatNumber(completedJobs)}
            />
            <StorageItem
              icon={<HardDrive className="h-4 w-4" />}
              iconColor="amber"
              label="Delayed"
              value={formatNumber(delayedJobs)}
            />
          </div>
        ) : (
          <EmptyState
            icon={<Zap className="h-8 w-8" />}
            title="No data available"
            description="Connect to NATS JetStream to see job statistics"
          />
        )}
      </Card>

      {storageStats?.enabled && (
        <Card className="info-card col-span-full">
          <div className="info-card-header">
            <div>
              <Title className="info-card-title">Job Distribution</Title>
              <Text className="info-card-subtitle">Jobs by state in storage</Text>
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
