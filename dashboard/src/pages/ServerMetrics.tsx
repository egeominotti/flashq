import { useMemo, useState, useEffect } from 'react';
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
import { useSettings, useMetrics, useMetricsHistory } from '../hooks';
import {
  fetchSystemMetrics,
  getSqliteStats,
  type SystemMetrics as SystemMetricsType,
  type SqliteStats,
} from '../api';
import { formatNumber, formatUptime } from '../utils';
import { AnimatedCounter, formatCompact, EmptyState, Sparkline } from '../components/common';
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

  // System metrics with more frequent refresh
  const {
    data: systemMetrics,
    refetch: refetchSystem,
  } = useQuery({
    queryKey: ['systemMetrics'],
    queryFn: fetchSystemMetrics,
    refetchInterval: 2000,
  });

  // SQLite stats
  const { data: sqliteStats, refetch: refetchSqlite } = useQuery({
    queryKey: ['sqliteStats'],
    queryFn: getSqliteStats,
    refetchInterval: 5000,
    enabled: settings?.sqlite?.enabled ?? false,
  });

  // Manual refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchSystem(), refetchSqlite()]);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Sparkline data for various metrics
  const latencySparkline = useMemo(
    () => metricsHistory?.slice(-20).map((p: MetricsHistoryPoint) => p.latency_ms || 0) || [],
    [metricsHistory]
  );

  const throughputSparkline = useMemo(
    () => metricsHistory?.slice(-20).map((p: MetricsHistoryPoint) => p.throughput || 0) || [],
    [metricsHistory]
  );

  const queuedSparkline = useMemo(
    () => metricsHistory?.slice(-20).map((p: MetricsHistoryPoint) => p.queued || 0) || [],
    [metricsHistory]
  );

  const processingSparkline = useMemo(
    () => metricsHistory?.slice(-20).map((p: MetricsHistoryPoint) => p.processing || 0) || [],
    [metricsHistory]
  );

  // Transform history for charts
  const performanceChartData = useMemo(
    () =>
      metricsHistory?.map((point: MetricsHistoryPoint) => ({
        date: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        'Latency (ms)': point.latency_ms || 0,
        'Throughput': point.throughput || 0,
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
        'Queued': point.queued || 0,
        'Processing': point.processing || 0,
      })) || [],
    [metricsHistory]
  );

  // Memory usage as percentage
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

      {/* Quick Stats Row */}
      <Grid numItemsSm={2} numItemsLg={4} className="mb-8 gap-6">
        <Card className="metric-card">
          <div className="metric-glow-header">
            <span className="metric-glow-title">Memory Usage</span>
            <div className="metric-glow-icon icon-cyan">
              <MemoryStick className="h-5 w-5" />
            </div>
          </div>
          <div className="metric-glow-value">
            <AnimatedCounter value={memoryUsed} formatter={(v) => `${v.toFixed(0)} MB`} />
          </div>
          <div className="metric-glow-footer">
            <Badge color={memoryPercent > 80 ? 'rose' : memoryPercent > 60 ? 'amber' : 'emerald'} size="xs">
              {memoryPercent.toFixed(1)}% of {memoryTotal.toFixed(0)} MB
            </Badge>
          </div>
        </Card>

        <Card className="metric-card">
          <div className="metric-glow-header">
            <span className="metric-glow-title">Avg Latency</span>
            <div className="metric-glow-icon icon-blue">
              <Gauge className="h-5 w-5" />
            </div>
          </div>
          <div className="metric-glow-value">
            <AnimatedCounter
              value={metrics?.avg_latency_ms ?? 0}
              formatter={(v) => `${v.toFixed(2)} ms`}
            />
          </div>
          <div className="metric-glow-footer">
            <Badge color="blue" size="xs">
              <Activity className="mr-1 h-3 w-3" />
              Response Time
            </Badge>
            <Sparkline data={latencySparkline} width={60} height={24} color="#3b82f6" />
          </div>
        </Card>

        <Card className="metric-card">
          <div className="metric-glow-header">
            <span className="metric-glow-title">Throughput</span>
            <div className="metric-glow-icon icon-emerald">
              <Zap className="h-5 w-5" />
            </div>
          </div>
          <div className="metric-glow-value">
            <AnimatedCounter
              value={metrics?.jobs_per_second ?? 0}
              formatter={(v) => `${v.toFixed(1)}/s`}
            />
          </div>
          <div className="metric-glow-footer">
            <Badge color="emerald" size="xs">
              <TrendingUp className="mr-1 h-3 w-3" />
              Jobs/sec
            </Badge>
            <Sparkline data={throughputSparkline} width={60} height={24} color="#10b981" />
          </div>
        </Card>

        <Card className="metric-card">
          <div className="metric-glow-header">
            <span className="metric-glow-title">Connections</span>
            <div className="metric-glow-icon icon-violet">
              <Wifi className="h-5 w-5" />
            </div>
          </div>
          <div className="metric-glow-value">
            <AnimatedCounter value={systemMetrics?.tcp_connections ?? 0} formatter={formatCompact} />
          </div>
          <div className="metric-glow-footer">
            <Badge color="violet" size="xs">
              <span className="live-dot live-dot-violet" />
              Active TCP
            </Badge>
          </div>
        </Card>
      </Grid>

      {/* Tabs for different metric categories */}
      <TabGroup>
        <TabList className="metrics-tab-list">
          <Tab icon={Server}>System</Tab>
          <Tab icon={Activity}>Performance</Tab>
          <Tab icon={Database}>Storage</Tab>
        </TabList>

        <TabPanels>
          {/* System Tab */}
          <TabPanel>
            <Grid numItemsSm={1} numItemsLg={2} className="mt-6 gap-6">
              {/* Server Info Card */}
              <Card className="chart-card">
                <div className="chart-header">
                  <div>
                    <Title className="chart-title">Server Information</Title>
                    <Text className="chart-subtitle">Runtime configuration and status</Text>
                  </div>
                  <Badge color="cyan" size="xs">
                    v{settings?.version ?? '0.2.0'}
                  </Badge>
                </div>
                <div className="server-info-grid">
                  <div className="server-info-item">
                    <div className="info-icon icon-cyan">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="info-content">
                      <span className="info-label">Uptime</span>
                      <span className="info-value mono">
                        {formatUptime(settings?.uptime_seconds ?? 0)}
                      </span>
                    </div>
                  </div>
                  <div className="server-info-item">
                    <div className="info-icon icon-blue">
                      <Server className="h-4 w-4" />
                    </div>
                    <div className="info-content">
                      <span className="info-label">TCP Port</span>
                      <span className="info-value mono">{settings?.tcp_port ?? 6789}</span>
                    </div>
                  </div>
                  <div className="server-info-item">
                    <div className="info-icon icon-emerald">
                      <Wifi className="h-4 w-4" />
                    </div>
                    <div className="info-content">
                      <span className="info-label">HTTP Port</span>
                      <span className="info-value mono">{settings?.http_port ?? 6790}</span>
                    </div>
                  </div>
                  <div className="server-info-item">
                    <div className="info-icon icon-violet">
                      <Cpu className="h-4 w-4" />
                    </div>
                    <div className="info-content">
                      <span className="info-label">Process ID</span>
                      <span className="info-value mono">{systemMetrics?.process_id ?? 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Resource Usage Card */}
              <Card className="chart-card">
                <div className="chart-header">
                  <div>
                    <Title className="chart-title">Resource Usage</Title>
                    <Text className="chart-subtitle">Memory and CPU utilization</Text>
                  </div>
                </div>
                <div className="resource-metrics">
                  <div className="resource-metric">
                    <div className="resource-header">
                      <div className="resource-info">
                        <MemoryStick className="h-4 w-4 text-cyan-400" />
                        <Text className="resource-label">Memory</Text>
                      </div>
                      <Text className="resource-value">
                        {memoryUsed.toFixed(0)} / {memoryTotal.toFixed(0)} MB
                      </Text>
                    </div>
                    <ProgressBar
                      value={memoryPercent}
                      color={memoryPercent > 80 ? 'rose' : memoryPercent > 60 ? 'amber' : 'cyan'}
                      className="resource-bar"
                    />
                    <Text className="resource-percent">{memoryPercent.toFixed(1)}% used</Text>
                  </div>

                  <div className="resource-metric">
                    <div className="resource-header">
                      <div className="resource-info">
                        <Cpu className="h-4 w-4 text-blue-400" />
                        <Text className="resource-label">CPU</Text>
                      </div>
                      <Text className="resource-value">
                        {(systemMetrics?.cpu_percent ?? 0).toFixed(1)}%
                      </Text>
                    </div>
                    <ProgressBar
                      value={systemMetrics?.cpu_percent ?? 0}
                      color={
                        (systemMetrics?.cpu_percent ?? 0) > 80
                          ? 'rose'
                          : (systemMetrics?.cpu_percent ?? 0) > 50
                            ? 'amber'
                            : 'blue'
                      }
                      className="resource-bar"
                    />
                    <Text className="resource-percent">
                      {(systemMetrics?.cpu_percent ?? 0).toFixed(1)}% utilization
                    </Text>
                  </div>

                  <div className="resource-metric">
                    <div className="resource-header">
                      <div className="resource-info">
                        <Wifi className="h-4 w-4 text-emerald-400" />
                        <Text className="resource-label">Connections</Text>
                      </div>
                      <Text className="resource-value">
                        {systemMetrics?.tcp_connections ?? 0} active
                      </Text>
                    </div>
                    <ProgressBar
                      value={Math.min((systemMetrics?.tcp_connections ?? 0) * 5, 100)}
                      color="emerald"
                      className="resource-bar"
                    />
                  </div>
                </div>
              </Card>
            </Grid>
          </TabPanel>

          {/* Performance Tab */}
          <TabPanel>
            <Grid numItemsSm={1} numItemsLg={2} className="mt-6 gap-6">
              {/* Latency & Throughput Chart */}
              <Card className="chart-card">
                <div className="chart-header">
                  <div>
                    <Title className="chart-title">Performance Over Time</Title>
                    <Text className="chart-subtitle">Latency and throughput trends</Text>
                  </div>
                  <Badge color="cyan" size="xs">
                    <span className="live-dot" />
                    Live
                  </Badge>
                </div>
                {performanceChartData.length > 0 ? (
                  <AreaChart
                    className="chart-area"
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

              {/* Load Chart */}
              <Card className="chart-card">
                <div className="chart-header">
                  <div>
                    <Title className="chart-title">Queue Load</Title>
                    <Text className="chart-subtitle">Jobs queued vs processing</Text>
                  </div>
                  <Badge color="blue" size="xs">
                    <span className="live-dot live-dot-blue" />
                    Real-time
                  </Badge>
                </div>
                {loadChartData.length > 0 ? (
                  <AreaChart
                    className="chart-area"
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

              {/* Detailed Metrics */}
              <Card className="chart-card lg:col-span-2">
                <div className="chart-header">
                  <div>
                    <Title className="chart-title">Job Statistics</Title>
                    <Text className="chart-subtitle">Cumulative job metrics</Text>
                  </div>
                </div>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-icon icon-cyan">
                      <TrendingUp className="h-5 w-5" />
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">
                        <AnimatedCounter value={metrics?.total_pushed ?? 0} formatter={formatNumber} />
                      </span>
                      <span className="stat-label">Total Pushed</span>
                    </div>
                    <Sparkline data={queuedSparkline} width={80} height={32} color="#06b6d4" />
                  </div>
                  <div className="stat-item">
                    <div className="stat-icon icon-emerald">
                      <Activity className="h-5 w-5" />
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">
                        <AnimatedCounter value={metrics?.total_completed ?? 0} formatter={formatNumber} />
                      </span>
                      <span className="stat-label">Total Completed</span>
                    </div>
                    <Sparkline data={throughputSparkline} width={80} height={32} color="#10b981" />
                  </div>
                  <div className="stat-item">
                    <div className="stat-icon icon-rose">
                      <Zap className="h-5 w-5" />
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">
                        <AnimatedCounter value={metrics?.total_failed ?? 0} formatter={formatNumber} />
                      </span>
                      <span className="stat-label">Total Failed</span>
                    </div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-icon icon-blue">
                      <Gauge className="h-5 w-5" />
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">
                        {metrics?.total_pushed
                          ? ((metrics.total_completed / metrics.total_pushed) * 100).toFixed(1)
                          : 0}
                        %
                      </span>
                      <span className="stat-label">Success Rate</span>
                    </div>
                    <Sparkline data={processingSparkline} width={80} height={32} color="#3b82f6" />
                  </div>
                </div>
              </Card>
            </Grid>
          </TabPanel>

          {/* Storage Tab */}
          <TabPanel>
            <Grid numItemsSm={1} numItemsLg={2} className="mt-6 gap-6">
              {/* SQLite Stats */}
              <Card className="chart-card">
                <div className="chart-header">
                  <div>
                    <Title className="chart-title">SQLite Database</Title>
                    <Text className="chart-subtitle">Persistent storage metrics</Text>
                  </div>
                  <Badge
                    color={settings?.sqlite?.enabled ? 'emerald' : 'zinc'}
                    size="xs"
                  >
                    {settings?.sqlite?.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
                {settings?.sqlite?.enabled && sqliteStats ? (
                  <div className="storage-metrics">
                    <div className="storage-item">
                      <div className="storage-icon icon-cyan">
                        <HardDrive className="h-4 w-4" />
                      </div>
                      <div className="storage-info">
                        <span className="storage-label">Database Size</span>
                        <span className="storage-value mono">
                          {sqliteStats.file_size_mb?.toFixed(2) ?? 0} MB
                        </span>
                      </div>
                    </div>
                    <div className="storage-item">
                      <div className="storage-icon icon-blue">
                        <Database className="h-4 w-4" />
                      </div>
                      <div className="storage-info">
                        <span className="storage-label">Total Jobs</span>
                        <span className="storage-value mono">
                          {formatNumber(sqliteStats.total_jobs ?? 0)}
                        </span>
                      </div>
                    </div>
                    <div className="storage-item">
                      <div className="storage-icon icon-emerald">
                        <Activity className="h-4 w-4" />
                      </div>
                      <div className="storage-info">
                        <span className="storage-label">Queued Jobs</span>
                        <span className="storage-value mono">
                          {formatNumber(sqliteStats.queued_jobs ?? 0)}
                        </span>
                      </div>
                    </div>
                    <div className="storage-item">
                      <div className="storage-icon icon-violet">
                        <Zap className="h-4 w-4" />
                      </div>
                      <div className="storage-info">
                        <span className="storage-label">Processing</span>
                        <span className="storage-value mono">
                          {formatNumber(sqliteStats.processing_jobs ?? 0)}
                        </span>
                      </div>
                    </div>
                    {sqliteStats.path && (
                      <div className="storage-path">
                        <span className="path-label">Path:</span>
                        <code className="path-value">{sqliteStats.path}</code>
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

              {/* Async Writer Stats */}
              <Card className="chart-card">
                <div className="chart-header">
                  <div>
                    <Title className="chart-title">Async Writer</Title>
                    <Text className="chart-subtitle">Background write operations</Text>
                  </div>
                  <Badge
                    color={sqliteStats?.async_writer_enabled ? 'emerald' : 'zinc'}
                    size="xs"
                  >
                    {sqliteStats?.async_writer_enabled ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {sqliteStats?.async_writer_enabled ? (
                  <div className="writer-metrics">
                    <div className="writer-stat">
                      <div className="writer-stat-header">
                        <Text className="writer-label">Queue Length</Text>
                        <Text className="writer-value mono">
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
                        className="writer-bar"
                      />
                    </div>
                    <div className="writer-info-grid">
                      <div className="writer-info-item">
                        <span className="writer-info-label">Ops Queued</span>
                        <span className="writer-info-value mono">
                          {formatNumber(sqliteStats.async_writer_ops_queued ?? 0)}
                        </span>
                      </div>
                      <div className="writer-info-item">
                        <span className="writer-info-label">Ops Written</span>
                        <span className="writer-info-value mono">
                          {formatNumber(sqliteStats.async_writer_ops_written ?? 0)}
                        </span>
                      </div>
                      <div className="writer-info-item">
                        <span className="writer-info-label">Batches</span>
                        <span className="writer-info-value mono">
                          {formatNumber(sqliteStats.async_writer_batches_written ?? 0)}
                        </span>
                      </div>
                      <div className="writer-info-item">
                        <span className="writer-info-label">Batch Size</span>
                        <span className="writer-info-value mono">
                          {sqliteStats.async_writer_max_batch_size ?? 0}
                        </span>
                      </div>
                      <div className="writer-info-item">
                        <span className="writer-info-label">Interval</span>
                        <span className="writer-info-value mono">
                          {sqliteStats.async_writer_batch_interval_ms ?? 0} ms
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

              {/* Job Distribution */}
              {settings?.sqlite?.enabled && sqliteStats && (
                <Card className="chart-card lg:col-span-2">
                  <div className="chart-header">
                    <div>
                      <Title className="chart-title">Job Distribution</Title>
                      <Text className="chart-subtitle">Jobs by state in database</Text>
                    </div>
                  </div>
                  <div className="job-distribution">
                    <div className="job-dist-item">
                      <div className="job-dist-header">
                        <Badge color="cyan" size="xs">Queued</Badge>
                        <span className="job-dist-count mono">
                          {formatNumber(sqliteStats.queued_jobs ?? 0)}
                        </span>
                      </div>
                      <ProgressBar
                        value={
                          sqliteStats.total_jobs
                            ? ((sqliteStats.queued_jobs ?? 0) / sqliteStats.total_jobs) * 100
                            : 0
                        }
                        color="cyan"
                        className="job-dist-bar"
                      />
                    </div>
                    <div className="job-dist-item">
                      <div className="job-dist-header">
                        <Badge color="blue" size="xs">Processing</Badge>
                        <span className="job-dist-count mono">
                          {formatNumber(sqliteStats.processing_jobs ?? 0)}
                        </span>
                      </div>
                      <ProgressBar
                        value={
                          sqliteStats.total_jobs
                            ? ((sqliteStats.processing_jobs ?? 0) / sqliteStats.total_jobs) * 100
                            : 0
                        }
                        color="blue"
                        className="job-dist-bar"
                      />
                    </div>
                    <div className="job-dist-item">
                      <div className="job-dist-header">
                        <Badge color="emerald" size="xs">Completed</Badge>
                        <span className="job-dist-count mono">
                          {formatNumber(sqliteStats.completed_jobs ?? 0)}
                        </span>
                      </div>
                      <ProgressBar
                        value={
                          sqliteStats.total_jobs
                            ? ((sqliteStats.completed_jobs ?? 0) / sqliteStats.total_jobs) * 100
                            : 0
                        }
                        color="emerald"
                        className="job-dist-bar"
                      />
                    </div>
                    <div className="job-dist-item">
                      <div className="job-dist-header">
                        <Badge color="amber" size="xs">Delayed</Badge>
                        <span className="job-dist-count mono">
                          {formatNumber(sqliteStats.delayed_jobs ?? 0)}
                        </span>
                      </div>
                      <ProgressBar
                        value={
                          sqliteStats.total_jobs
                            ? ((sqliteStats.delayed_jobs ?? 0) / sqliteStats.total_jobs) * 100
                            : 0
                        }
                        color="amber"
                        className="job-dist-bar"
                      />
                    </div>
                    <div className="job-dist-item">
                      <div className="job-dist-header">
                        <Badge color="rose" size="xs">Failed</Badge>
                        <span className="job-dist-count mono">
                          {formatNumber(sqliteStats.failed_jobs ?? 0)}
                        </span>
                      </div>
                      <ProgressBar
                        value={
                          sqliteStats.total_jobs
                            ? ((sqliteStats.failed_jobs ?? 0) / sqliteStats.total_jobs) * 100
                            : 0
                        }
                        color="rose"
                        className="job-dist-bar"
                      />
                    </div>
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
