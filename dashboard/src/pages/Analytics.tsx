import { useMemo } from 'react';
import { Title, Text, AreaChart, BarChart, LineChart, Badge, Grid } from '@tremor/react';
import { TrendingUp, Activity, Clock, Zap, CheckCircle2, RefreshCw, BarChart3 } from 'lucide-react';
import { useMetrics, useMetricsHistory } from '../hooks';
import { formatNumber } from '../utils';
import { GlowCard, AnimatedCounter, formatCompact, EmptyState, Sparkline } from '../components/common';
import './Analytics.css';

interface MetricsPoint {
  timestamp: number;
  throughput?: number;
  latency_ms?: number;
  queued?: number;
  processing?: number;
}

interface QueueMetric {
  name: string;
  pending: number;
  processing: number;
  dlq: number;
}

export function Analytics() {
  const { data: metrics, refetch } = useMetrics();
  const { data: metricsHistory, refetch: refetchHistory } = useMetricsHistory();

  const handleRefresh = () => {
    refetch();
    refetchHistory();
  };

  const throughputHistory = useMemo(
    () =>
      metricsHistory?.map((point: MetricsPoint) => ({
        timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        'Jobs/sec': point.throughput || 0,
      })) || [],
    [metricsHistory]
  );

  const latencyHistory = useMemo(
    () =>
      metricsHistory?.map((point: MetricsPoint) => ({
        timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        'Avg Latency': point.latency_ms || 0,
      })) || [],
    [metricsHistory]
  );

  const queueData = useMemo(
    () =>
      metrics?.queues?.map((q: QueueMetric) => ({
        name: q.name,
        Waiting: q.pending,
        Active: q.processing,
        DLQ: q.dlq,
      })) || [],
    [metrics?.queues]
  );

  const jobsQueueHistory = useMemo(
    () =>
      metricsHistory?.map((point: MetricsPoint) => ({
        timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        Queued: point.queued || 0,
        Processing: point.processing || 0,
      })) || [],
    [metricsHistory]
  );

  // Sparkline data
  const throughputSparkline = useMemo(
    () => metricsHistory?.slice(-20).map((p: MetricsPoint) => p.throughput || 0) || [],
    [metricsHistory]
  );

  const latencySparkline = useMemo(
    () => metricsHistory?.slice(-20).map((p: MetricsPoint) => p.latency_ms || 0) || [],
    [metricsHistory]
  );

  const totalPushed = metrics?.total_pushed || 0;
  const totalCompleted = metrics?.total_completed || 0;
  const avgLatency = metrics?.avg_latency_ms || 0;
  const currentThroughput = metrics?.jobs_per_second || 0;

  return (
    <div className="analytics-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Analytics</Title>
          <Text className="page-subtitle">Performance metrics and system analytics</Text>
        </div>
        <button className="refresh-btn-glow" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </header>

      {/* Key Metrics with Glow Cards */}
      <Grid numItemsSm={2} numItemsLg={4} className="mb-8 gap-6">
        <GlowCard glowColor="cyan" className="metric-glow-card">
          <div className="metric-glow-header">
            <span className="metric-glow-title">Total Pushed</span>
            <div className="metric-glow-icon icon-cyan">
              <Activity className="h-5 w-5" />
            </div>
          </div>
          <div className="metric-glow-value">
            <AnimatedCounter value={totalPushed} formatter={formatCompact} />
          </div>
          <div className="metric-glow-footer">
            <Badge color="emerald" size="xs">
              <TrendingUp className="mr-1 h-3 w-3" />
              All time
            </Badge>
            <Sparkline data={throughputSparkline} width={60} height={24} color="#06b6d4" />
          </div>
        </GlowCard>

        <GlowCard glowColor="emerald" className="metric-glow-card">
          <div className="metric-glow-header">
            <span className="metric-glow-title">Total Completed</span>
            <div className="metric-glow-icon icon-emerald">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <div className="metric-glow-value">
            <AnimatedCounter value={totalCompleted} formatter={formatCompact} />
          </div>
          <div className="metric-glow-footer">
            <Badge color="emerald" size="xs">
              {totalPushed > 0 ? `${((totalCompleted / totalPushed) * 100).toFixed(1)}%` : '0%'}
            </Badge>
          </div>
        </GlowCard>

        <GlowCard glowColor="blue" className="metric-glow-card">
          <div className="metric-glow-header">
            <span className="metric-glow-title">Avg Latency</span>
            <div className="metric-glow-icon icon-blue">
              <Clock className="h-5 w-5" />
            </div>
          </div>
          <div className="metric-glow-value">
            <AnimatedCounter value={avgLatency} decimals={2} suffix="ms" />
          </div>
          <div className="metric-glow-footer">
            <Badge
              size="xs"
              color={avgLatency < 10 ? 'emerald' : avgLatency < 50 ? 'amber' : 'rose'}
            >
              {avgLatency < 10 ? 'Excellent' : avgLatency < 50 ? 'Good' : 'Slow'}
            </Badge>
            <Sparkline data={latencySparkline} width={60} height={24} color="#3b82f6" />
          </div>
        </GlowCard>

        <GlowCard glowColor="violet" className="metric-glow-card">
          <div className="metric-glow-header">
            <span className="metric-glow-title">Throughput</span>
            <div className="metric-glow-icon icon-violet">
              <Zap className="h-5 w-5" />
            </div>
          </div>
          <div className="metric-glow-value">
            <AnimatedCounter value={currentThroughput} decimals={1} suffix="/s" />
          </div>
          <div className="metric-glow-footer">
            <Badge color="cyan" size="xs">
              <span className="live-dot" />
              Live
            </Badge>
          </div>
        </GlowCard>
      </Grid>

      {/* Charts Row 1 */}
      <Grid numItemsSm={1} numItemsLg={2} className="mb-8 gap-6">
        <GlowCard glowColor="cyan" className="chart-glow-card">
          <div className="chart-header">
            <div>
              <Title className="chart-title">Throughput Over Time</Title>
              <Text className="chart-subtitle">Jobs processed per second</Text>
            </div>
            <Badge color="cyan" size="xs">
              <span className="live-dot" />
              Live
            </Badge>
          </div>
          {throughputHistory.length > 0 ? (
            <AreaChart
              className="chart-area"
              data={throughputHistory}
              index="timestamp"
              categories={['Jobs/sec']}
              colors={['cyan']}
              showAnimation
              showLegend={false}
              curveType="monotone"
              valueFormatter={(v) => `${v.toFixed(1)}/s`}
              showGridLines={false}
            />
          ) : (
            <EmptyState
              variant="chart"
              title="No throughput data yet"
              description="Start processing jobs to see throughput metrics"
            />
          )}
        </GlowCard>

        <GlowCard glowColor="blue" className="chart-glow-card">
          <div className="chart-header">
            <div>
              <Title className="chart-title">Latency Over Time</Title>
              <Text className="chart-subtitle">Average processing latency</Text>
            </div>
            <Badge color="blue" size="xs">
              <span className="live-dot live-dot-blue" />
              Live
            </Badge>
          </div>
          {latencyHistory.length > 0 ? (
            <LineChart
              className="chart-area"
              data={latencyHistory}
              index="timestamp"
              categories={['Avg Latency']}
              colors={['blue']}
              showAnimation
              curveType="monotone"
              valueFormatter={(v) => `${v.toFixed(2)}ms`}
              showGridLines={false}
            />
          ) : (
            <EmptyState
              variant="chart"
              title="No latency data yet"
              description="Start processing jobs to see latency metrics"
            />
          )}
        </GlowCard>
      </Grid>

      {/* Charts Row 2 */}
      <Grid numItemsSm={1} numItemsLg={2} className="gap-6">
        <GlowCard glowColor="violet" className="chart-glow-card">
          <div className="chart-header">
            <div>
              <Title className="chart-title">Queue Comparison</Title>
              <Text className="chart-subtitle">Jobs by state across queues</Text>
            </div>
            <Badge color="violet" size="xs">
              <BarChart3 className="mr-1 h-3 w-3" />
              {queueData.length} Queues
            </Badge>
          </div>
          {queueData.length > 0 ? (
            <BarChart
              className="chart-area"
              data={queueData}
              index="name"
              categories={['Waiting', 'Active', 'DLQ']}
              colors={['cyan', 'blue', 'rose']}
              showAnimation
              stack
              valueFormatter={formatNumber}
              showGridLines={false}
            />
          ) : (
            <EmptyState
              variant="chart"
              title="No queues available"
              description="Create a queue to see comparison data"
            />
          )}
        </GlowCard>

        <GlowCard glowColor="emerald" className="chart-glow-card">
          <div className="chart-header">
            <div>
              <Title className="chart-title">Jobs in Queue</Title>
              <Text className="chart-subtitle">Queue depth over time</Text>
            </div>
            <Badge color="emerald" size="xs">
              <span className="live-dot live-dot-emerald" />
              Live
            </Badge>
          </div>
          {jobsQueueHistory.length > 0 ? (
            <AreaChart
              className="chart-area"
              data={jobsQueueHistory}
              index="timestamp"
              categories={['Queued', 'Processing']}
              colors={['cyan', 'blue']}
              showAnimation
              curveType="monotone"
              valueFormatter={formatNumber}
              showGridLines={false}
            />
          ) : (
            <EmptyState
              variant="chart"
              title="No queue history yet"
              description="Queue depth will appear as jobs are processed"
            />
          )}
        </GlowCard>
      </Grid>
    </div>
  );
}
