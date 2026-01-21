import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Title,
  Text,
  AreaChart,
  Grid,
  Badge,
  ProgressBar,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
  Card,
} from '@tremor/react';
import {
  Server,
  Cpu,
  HardDrive,
  Activity,
  Clock,
  Wifi,
  Database,
  Zap,
  TrendingUp,
  MemoryStick,
  Gauge,
  RefreshCw,
} from 'lucide-react';
import { useSettings, useMetrics, useMetricsHistory, useSparklineData } from '../hooks';
import { fetchSystemMetrics, getSqliteStats } from '../api';
import { formatNumber, formatUptime } from '../utils';
import {
  AnimatedCounter,
  EmptyState,
  Sparkline,
  StatCard,
  InfoItem,
  ResourceItem,
  StorageItem,
  JobDistItem,
} from '../components/common';
import './ServerMetrics.css';

interface MetricsHistoryPoint {
  timestamp: number;
  throughput: number;
  latency_ms: number;
  queued: number;
  processing: number;
}

export function ServerMetrics() {
  const { data: settings } = useSettings();
  const { data: metrics } = useMetrics();
  const { data: metricsHistory } = useMetricsHistory();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: systemMetrics, refetch: refetchSystem } = useQuery({
    queryKey: ['systemMetrics'],
    queryFn: fetchSystemMetrics,
    refetchInterval: 2000,
  });

  const { data: sqliteStats, refetch: refetchSqlite } = useQuery({
    queryKey: ['sqliteStats'],
    queryFn: getSqliteStats,
    refetchInterval: 5000,
    enabled: settings?.sqlite?.enabled ?? false,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchSystem(), refetchSqlite()]);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // DRY: Use custom hook for sparkline data extraction
  const latencySparkline = useSparklineData(metricsHistory, 'latency_ms');
  const throughputSparkline = useSparklineData(metricsHistory, 'throughput');
  const queuedSparkline = useSparklineData(metricsHistory, 'queued');
  const processingSparkline = useSparklineData(metricsHistory, 'processing');

  const performanceChartData = useMemo(
    () =>
      metricsHistory?.map((point: MetricsHistoryPoint) => ({
        date: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        'Latency (ms)': point.latency_ms || 0,
        Throughput: point.throughput || 0,
      })) || [],
    [metricsHistory]
  );

  const loadChartData = useMemo(
    () =>
      metricsHistory?.map((point: MetricsHistoryPoint) => ({
        date: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        Queued: point.queued || 0,
        Processing: point.processing || 0,
      })) || [],
    [metricsHistory]
  );

  const memoryPercent = systemMetrics?.memory_percent ?? 0;
  const memoryUsed = systemMetrics?.memory_used_mb ?? 0;
  const memoryTotal = systemMetrics?.memory_total_mb ?? 0;

  return (
    <div className="server-metrics-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Server Metrics</Title>
          <Text className="page-subtitle">
            Real-time system performance and resource monitoring
          </Text>
        </div>
        <div className="header-actions">
          <button
            className={`refresh-button ${isRefreshing ? 'refreshing' : ''}`}
            onClick={handleRefresh}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <Badge size="lg" color="emerald" className="status-badge">
            <span className="status-indicator" />
            Server Online
          </Badge>
        </div>
      </header>

      {/* Quick Stats Row - DRY: Using StatCard component */}
      <Grid numItemsSm={2} numItemsLg={4} className="mb-6 gap-4">
        <StatCard
          title="Memory Usage"
          value={memoryUsed}
          icon={<MemoryStick className="h-5 w-5" />}
          iconColor="cyan"
          formatter={(v) => `${v.toFixed(0)} MB`}
          badge={{
            text: `${memoryPercent.toFixed(1)}% of ${memoryTotal.toFixed(0)} MB`,
            color: memoryPercent > 80 ? 'rose' : memoryPercent > 60 ? 'amber' : 'emerald',
          }}
        />

        <StatCard
          title="Avg Latency"
          value={metrics?.avg_latency_ms ?? 0}
          icon={<Gauge className="h-5 w-5" />}
          iconColor="blue"
          formatter={(v) => `${v.toFixed(2)} ms`}
          badge={{
            text: 'Response Time',
            icon: <Activity className="mr-1 h-3 w-3" />,
          }}
          sparkline={{ data: latencySparkline, color: '#3b82f6' }}
        />

        <StatCard
          title="Throughput"
          value={metrics?.jobs_per_second ?? 0}
          icon={<Zap className="h-5 w-5" />}
          iconColor="emerald"
          formatter={(v) => `${v.toFixed(1)}/s`}
          badge={{
            text: 'Jobs/sec',
            icon: <TrendingUp className="mr-1 h-3 w-3" />,
          }}
          sparkline={{ data: throughputSparkline, color: '#10b981' }}
        />

        <StatCard
          title="Connections"
          value={systemMetrics?.tcp_connections ?? 0}
          icon={<Wifi className="h-5 w-5" />}
          iconColor="violet"
          badge={{
            text: 'Active TCP',
            icon: <span className="live-dot live-dot-violet" />,
          }}
        />
      </Grid>

      {/* Tabs */}
      <TabGroup>
        <TabList className="metrics-tab-list">
          <Tab icon={Server}>System</Tab>
          <Tab icon={Activity}>Performance</Tab>
          <Tab icon={Database}>Storage</Tab>
        </TabList>

        <TabPanels>
          {/* System Tab */}
          <TabPanel>
            <Grid numItemsSm={1} numItemsLg={2} className="mt-6 gap-4">
              <Card className="info-card">
                <div className="info-card-header">
                  <div>
                    <Title className="info-card-title">Server Information</Title>
                    <Text className="info-card-subtitle">Runtime configuration and status</Text>
                  </div>
                  <Badge color="cyan" size="xs">
                    v{settings?.version ?? '0.2.0'}
                  </Badge>
                </div>
                {/* DRY: Using InfoItem component */}
                <div className="info-grid">
                  <InfoItem
                    icon={<Clock className="h-4 w-4" />}
                    iconColor="cyan"
                    label="Uptime"
                    value={formatUptime(settings?.uptime_seconds ?? 0)}
                  />
                  <InfoItem
                    icon={<Server className="h-4 w-4" />}
                    iconColor="blue"
                    label="TCP Port"
                    value={settings?.tcp_port ?? 6789}
                  />
                  <InfoItem
                    icon={<Wifi className="h-4 w-4" />}
                    iconColor="emerald"
                    label="HTTP Port"
                    value={settings?.http_port ?? 6790}
                  />
                  <InfoItem
                    icon={<Cpu className="h-4 w-4" />}
                    iconColor="violet"
                    label="Process ID"
                    value={systemMetrics?.process_id ?? 'N/A'}
                  />
                </div>
              </Card>

              <Card className="info-card">
                <div className="info-card-header">
                  <div>
                    <Title className="info-card-title">Resource Usage</Title>
                    <Text className="info-card-subtitle">Memory and CPU utilization</Text>
                  </div>
                </div>
                {/* DRY: Using ResourceItem component */}
                <div className="resource-list">
                  <ResourceItem
                    icon={<MemoryStick className="h-4 w-4 text-cyan-400" />}
                    label="Memory"
                    value={`${memoryUsed.toFixed(0)} / ${memoryTotal.toFixed(0)} MB`}
                    percent={memoryPercent}
                    percentLabel={`${memoryPercent.toFixed(1)}% used`}
                  />
                  <ResourceItem
                    icon={<Cpu className="h-4 w-4 text-blue-400" />}
                    label="CPU"
                    value={`${(systemMetrics?.cpu_percent ?? 0).toFixed(1)}%`}
                    percent={systemMetrics?.cpu_percent ?? 0}
                    percentLabel={`${(systemMetrics?.cpu_percent ?? 0).toFixed(1)}% utilization`}
                    color="blue"
                  />
                  <ResourceItem
                    icon={<Wifi className="h-4 w-4 text-emerald-400" />}
                    label="Connections"
                    value={`${systemMetrics?.tcp_connections ?? 0} active`}
                    percent={Math.min((systemMetrics?.tcp_connections ?? 0) * 5, 100)}
                    color="emerald"
                  />
                </div>
              </Card>
            </Grid>
          </TabPanel>

          {/* Performance Tab */}
          <TabPanel>
            <Grid numItemsSm={1} numItemsLg={2} className="mt-6 gap-4">
              <Card className="chart-card">
                <div className="chart-card-header">
                  <div>
                    <Title className="chart-card-title">Performance Over Time</Title>
                    <Text className="chart-card-subtitle">Latency and throughput trends</Text>
                  </div>
                  <Badge color="cyan" size="xs">
                    <span className="live-dot" />
                    Live
                  </Badge>
                </div>
                {performanceChartData.length > 0 ? (
                  <AreaChart
                    className="mt-4 h-56"
                    data={performanceChartData}
                    index="date"
                    categories={['Latency (ms)', 'Throughput']}
                    colors={['cyan', 'emerald']}
                    showAnimation
                    showLegend
                    curveType="monotone"
                    showGridLines={false}
                  />
                ) : (
                  <EmptyState
                    variant="chart"
                    title="No performance data yet"
                    description="Metrics will appear as jobs are processed"
                  />
                )}
              </Card>

              <Card className="chart-card">
                <div className="chart-card-header">
                  <div>
                    <Title className="chart-card-title">Queue Load</Title>
                    <Text className="chart-card-subtitle">Jobs queued vs processing</Text>
                  </div>
                  <Badge color="blue" size="xs">
                    <span className="live-dot live-dot-blue" />
                    Real-time
                  </Badge>
                </div>
                {loadChartData.length > 0 ? (
                  <AreaChart
                    className="mt-4 h-56"
                    data={loadChartData}
                    index="date"
                    categories={['Queued', 'Processing']}
                    colors={['blue', 'violet']}
                    showAnimation
                    showLegend
                    curveType="monotone"
                    showGridLines={false}
                  />
                ) : (
                  <EmptyState
                    variant="chart"
                    title="No load data yet"
                    description="Push jobs to see load metrics"
                  />
                )}
              </Card>

              <Card className="chart-card col-span-full">
                <div className="chart-card-header">
                  <div>
                    <Title className="chart-card-title">Job Statistics</Title>
                    <Text className="chart-card-subtitle">Cumulative job metrics</Text>
                  </div>
                </div>
                <div className="job-stats-grid">
                  <div className="job-stat-item">
                    <div className="job-stat-icon icon-cyan">
                      <TrendingUp className="h-5 w-5" />
                    </div>
                    <div className="job-stat-content">
                      <span className="job-stat-value">
                        <AnimatedCounter
                          value={metrics?.total_pushed ?? 0}
                          formatter={formatNumber}
                        />
                      </span>
                      <span className="job-stat-label">Total Pushed</span>
                    </div>
                    <Sparkline data={queuedSparkline} width={80} height={32} color="#06b6d4" />
                  </div>
                  <div className="job-stat-item">
                    <div className="job-stat-icon icon-emerald">
                      <Activity className="h-5 w-5" />
                    </div>
                    <div className="job-stat-content">
                      <span className="job-stat-value">
                        <AnimatedCounter
                          value={metrics?.total_completed ?? 0}
                          formatter={formatNumber}
                        />
                      </span>
                      <span className="job-stat-label">Total Completed</span>
                    </div>
                    <Sparkline data={throughputSparkline} width={80} height={32} color="#10b981" />
                  </div>
                  <div className="job-stat-item">
                    <div className="job-stat-icon icon-rose">
                      <Zap className="h-5 w-5" />
                    </div>
                    <div className="job-stat-content">
                      <span className="job-stat-value">
                        <AnimatedCounter
                          value={metrics?.total_failed ?? 0}
                          formatter={formatNumber}
                        />
                      </span>
                      <span className="job-stat-label">Total Failed</span>
                    </div>
                  </div>
                  <div className="job-stat-item">
                    <div className="job-stat-icon icon-blue">
                      <Gauge className="h-5 w-5" />
                    </div>
                    <div className="job-stat-content">
                      <span className="job-stat-value">
                        {metrics?.total_pushed
                          ? ((metrics.total_completed / metrics.total_pushed) * 100).toFixed(1)
                          : 0}
                        %
                      </span>
                      <span className="job-stat-label">Success Rate</span>
                    </div>
                    <Sparkline data={processingSparkline} width={80} height={32} color="#3b82f6" />
                  </div>
                </div>
              </Card>
            </Grid>
          </TabPanel>

          {/* Storage Tab */}
          <TabPanel>
            <Grid numItemsSm={1} numItemsLg={2} className="mt-6 gap-4">
              <Card className="info-card">
                <div className="info-card-header">
                  <div>
                    <Title className="info-card-title">SQLite Database</Title>
                    <Text className="info-card-subtitle">Persistent storage metrics</Text>
                  </div>
                  <Badge color={settings?.sqlite?.enabled ? 'emerald' : 'zinc'} size="xs">
                    {settings?.sqlite?.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                {settings?.sqlite?.enabled && sqliteStats ? (
                  <div className="storage-list">
                    {/* DRY: Using StorageItem component */}
                    <StorageItem
                      icon={<HardDrive className="h-4 w-4" />}
                      iconColor="cyan"
                      label="Database Size"
                      value={`${sqliteStats.file_size_mb?.toFixed(2) ?? 0} MB`}
                    />
                    <StorageItem
                      icon={<Database className="h-4 w-4" />}
                      iconColor="blue"
                      label="Total Jobs"
                      value={formatNumber(sqliteStats.total_jobs ?? 0)}
                    />
                    <StorageItem
                      icon={<Activity className="h-4 w-4" />}
                      iconColor="emerald"
                      label="Queued Jobs"
                      value={formatNumber(sqliteStats.queued_jobs ?? 0)}
                    />
                    <StorageItem
                      icon={<Zap className="h-4 w-4" />}
                      iconColor="violet"
                      label="Processing"
                      value={formatNumber(sqliteStats.processing_jobs ?? 0)}
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
                        <Text className="writer-stat-value">
                          {sqliteStats.async_writer_queue_len ?? 0}
                        </Text>
                      </div>
                      <ProgressBar
                        value={Math.min(
                          ((sqliteStats.async_writer_queue_len ?? 0) /
                            (sqliteStats.async_writer_max_batch_size ?? 100)) *
                            100,
                          100
                        )}
                        color="cyan"
                      />
                    </div>
                    <div className="writer-info-grid">
                      <div className="writer-info-item">
                        <span className="writer-info-label">Ops Queued</span>
                        <span className="writer-info-value">
                          {formatNumber(sqliteStats.async_writer_ops_queued ?? 0)}
                        </span>
                      </div>
                      <div className="writer-info-item">
                        <span className="writer-info-label">Ops Written</span>
                        <span className="writer-info-value">
                          {formatNumber(sqliteStats.async_writer_ops_written ?? 0)}
                        </span>
                      </div>
                      <div className="writer-info-item">
                        <span className="writer-info-label">Batches</span>
                        <span className="writer-info-value">
                          {formatNumber(sqliteStats.async_writer_batches_written ?? 0)}
                        </span>
                      </div>
                      <div className="writer-info-item">
                        <span className="writer-info-label">Batch Size</span>
                        <span className="writer-info-value">
                          {sqliteStats.async_writer_max_batch_size ?? 0}
                        </span>
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

              {settings?.sqlite?.enabled && sqliteStats && (
                <Card className="info-card col-span-full">
                  <div className="info-card-header">
                    <div>
                      <Title className="info-card-title">Job Distribution</Title>
                      <Text className="info-card-subtitle">Jobs by state in database</Text>
                    </div>
                  </div>
                  {/* DRY: Using JobDistItem component */}
                  <div className="job-dist-grid">
                    <JobDistItem
                      label="Queued"
                      count={sqliteStats.queued_jobs ?? 0}
                      total={sqliteStats.total_jobs ?? 0}
                      color="cyan"
                    />
                    <JobDistItem
                      label="Processing"
                      count={sqliteStats.processing_jobs ?? 0}
                      total={sqliteStats.total_jobs ?? 0}
                      color="blue"
                    />
                    <JobDistItem
                      label="Completed"
                      count={sqliteStats.completed_jobs ?? 0}
                      total={sqliteStats.total_jobs ?? 0}
                      color="emerald"
                    />
                    <JobDistItem
                      label="Delayed"
                      count={sqliteStats.delayed_jobs ?? 0}
                      total={sqliteStats.total_jobs ?? 0}
                      color="amber"
                    />
                    <JobDistItem
                      label="Failed"
                      count={sqliteStats.failed_jobs ?? 0}
                      total={sqliteStats.total_jobs ?? 0}
                      color="rose"
                    />
                  </div>
                </Card>
              )}
            </Grid>
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
}
