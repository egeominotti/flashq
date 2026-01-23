import { useMemo } from 'react';
import { Title, Text, AreaChart, BarChart, LineChart, Badge, Grid } from '@tremor/react';
import {
  TrendingUp,
  Activity,
  Clock,
  Zap,
  CheckCircle2,
  BarChart3,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useIsConnected, useMetrics, useMetricsHistory } from '../stores';
import { useSparklineData } from '../hooks';
import { formatNumber } from '../utils';
import { GlowCard, EmptyState, MetricGlowCard } from '../components/common';
import type { MetricsHistory } from '../api/types';
import './Analytics.css';

interface QueueMetric {
  name: string;
  pending: number;
  processing: number;
  dlq: number;
}

export function Analytics() {
  // Granular WebSocket hooks - only re-render when needed data changes
  const isConnected = useIsConnected();
  const metrics = useMetrics();
  const metricsHistory = useMetricsHistory();

  // Ensure no negative values in chart data
  const throughputHistory = useMemo(
    () =>
      metricsHistory?.map((point: MetricsHistory) => ({
        timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        'Jobs/sec': Math.max(0, point.throughput || 0),
      })) || [],
    [metricsHistory]
  );

  const latencyHistory = useMemo(
    () =>
      metricsHistory?.map((point: MetricsHistory) => ({
        timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        'Avg Latency': Math.max(0, point.latency_ms || 0),
      })) || [],
    [metricsHistory]
  );

  const queueData = useMemo(
    () =>
      metrics?.queues?.map((q: QueueMetric) => ({
        name: q.name,
        Waiting: Math.max(0, q.pending),
        Active: Math.max(0, q.processing),
        DLQ: Math.max(0, q.dlq),
      })) || [],
    [metrics?.queues]
  );

  const jobsQueueHistory = useMemo(
    () =>
      metricsHistory?.map((point: MetricsHistory) => ({
        timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        Queued: Math.max(0, point.queued || 0),
        Processing: Math.max(0, point.processing || 0),
      })) || [],
    [metricsHistory]
  );

  // DRY: Use custom hook for sparkline data extraction
  const throughputSparkline = useSparklineData(metricsHistory, 'throughput');
  const latencySparkline = useSparklineData(metricsHistory, 'latency_ms');

  // Ensure no negative values in metrics
  const totalPushed = Math.max(0, metrics?.total_pushed || 0);
  const totalCompleted = Math.max(0, metrics?.total_completed || 0);
  const avgLatency = Math.max(0, metrics?.avg_latency_ms || 0);
  const currentThroughput = Math.max(0, metrics?.jobs_per_second || 0);

  return (
    <div className="analytics-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Analytics</Title>
          <Text className="page-subtitle">Real-time performance metrics via WebSocket</Text>
        </div>
        <Badge size="lg" color={isConnected ? 'emerald' : 'rose'}>
          {isConnected ? (
            <>
              <Wifi className="mr-1 h-4 w-4" />
              <span className="status-indicator" />
              Connected
            </>
          ) : (
            <>
              <WifiOff className="mr-1 h-4 w-4" />
              Disconnected
            </>
          )}
        </Badge>
      </header>

      {/* Key Metrics with Glow Cards - DRY: Using MetricGlowCard */}
      <Grid numItemsSm={2} numItemsLg={4} className="mb-8 gap-6">
        <MetricGlowCard
          title="Total Pushed"
          value={totalPushed}
          icon={<Activity className="h-5 w-5" />}
          glowColor="cyan"
          badge={{
            text: 'All time',
            color: 'emerald',
            icon: <TrendingUp className="mr-1 h-3 w-3" />,
          }}
          sparkline={{ data: throughputSparkline, color: '#06b6d4' }}
        />

        <MetricGlowCard
          title="Total Completed"
          value={totalCompleted}
          icon={<CheckCircle2 className="h-5 w-5" />}
          glowColor="emerald"
          badge={{
            text: totalPushed > 0 ? `${((totalCompleted / totalPushed) * 100).toFixed(1)}%` : '0%',
            color: 'emerald',
          }}
        />

        <MetricGlowCard
          title="Avg Latency"
          value={avgLatency}
          icon={<Clock className="h-5 w-5" />}
          glowColor="blue"
          decimals={2}
          suffix="ms"
          badge={{
            text: avgLatency < 10 ? 'Excellent' : avgLatency < 50 ? 'Good' : 'Slow',
            color: avgLatency < 10 ? 'emerald' : avgLatency < 50 ? 'amber' : 'rose',
          }}
          sparkline={{ data: latencySparkline, color: '#3b82f6' }}
        />

        <MetricGlowCard
          title="Throughput"
          value={currentThroughput}
          icon={<Zap className="h-5 w-5" />}
          glowColor="violet"
          decimals={1}
          suffix="/s"
          compact
          badge={{
            text: 'Live',
            color: 'cyan',
            icon: <span className="live-dot" />,
          }}
        />
      </Grid>

      {/* Charts Row 1 */}
      <Grid numItemsSm={1} numItemsLg={2} className="mb-8 gap-6">
        <GlowCard glowColor="cyan" className="chart-glow-card">
          <div className="chart-header">
            <div>
              <Title className="chart-title">Throughput Over Time</Title>
              <Text className="chart-subtitle">Jobs processed per second</Text>
            </div>
            <Badge color={isConnected ? 'cyan' : 'zinc'} size="xs">
              {isConnected && <span className="live-dot" />}
              {isConnected ? 'Live' : 'Offline'}
            </Badge>
          </div>
          {throughputHistory.length > 0 ? (
            <AreaChart
              className="chart-area"
              data={throughputHistory}
              index="timestamp"
              categories={['Jobs/sec']}
              colors={['cyan']}
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
            <Badge color={isConnected ? 'blue' : 'zinc'} size="xs">
              {isConnected && <span className="live-dot live-dot-blue" />}
              {isConnected ? 'Live' : 'Offline'}
            </Badge>
          </div>
          {latencyHistory.length > 0 ? (
            <LineChart
              className="chart-area"
              data={latencyHistory}
              index="timestamp"
              categories={['Avg Latency']}
              colors={['blue']}
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
            <Badge color={isConnected ? 'emerald' : 'zinc'} size="xs">
              {isConnected && <span className="live-dot live-dot-emerald" />}
              {isConnected ? 'Live' : 'Offline'}
            </Badge>
          </div>
          {jobsQueueHistory.length > 0 ? (
            <AreaChart
              className="chart-area"
              data={jobsQueueHistory}
              index="timestamp"
              categories={['Queued', 'Processing']}
              colors={['cyan', 'blue']}
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
