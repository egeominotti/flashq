import { useMemo } from 'react';
import {
  Title,
  Text,
  AreaChart,
  DonutChart,
  BarList,
  Badge,
  ProgressBar,
  Grid,
} from '@tremor/react';
import { Activity, CheckCircle2, XCircle, Layers, TrendingUp, Zap, Clock } from 'lucide-react';
import { useStats, useMetrics, useMetricsHistory, useSparklineData } from '../hooks';
import { formatNumber } from '../utils';
import { GlowCard, EmptyState, MetricGlowCard } from '../components/common';
import './Overview.css';

interface MetricsPoint {
  timestamp: number;
  throughput: number;
  queued?: number;
}

interface QueueData {
  name: string;
  pending: number;
  processing: number;
}

export function Overview() {
  const { data: stats } = useStats();
  const { data: metrics } = useMetrics();
  const { data: metricsHistory } = useMetricsHistory();

  // Calculate totals from actual API data
  const totalQueued = stats?.queued || 0;
  const totalProcessing = stats?.processing || 0;
  const totalDelayed = stats?.delayed || 0;
  const totalDlq = stats?.dlq || 0;
  const totalCompleted = metrics?.total_completed || 0;
  const totalPushed = metrics?.total_pushed || 0;

  // DRY: Use custom hook for sparkline data extraction
  const throughputSparkline = useSparklineData(metricsHistory, 'throughput');
  const queuedSparkline = useSparklineData(metricsHistory, 'queued');

  // Transform metrics history for throughput chart
  const throughputData = useMemo(
    () =>
      metricsHistory?.map((point: MetricsPoint) => ({
        date: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        'Jobs/sec': point.throughput || 0,
      })) || [],
    [metricsHistory]
  );

  // Get queue data from metrics endpoint
  const queues = useMemo(() => metrics?.queues || [], [metrics?.queues]);

  const queueDistribution = useMemo(
    () =>
      queues
        .filter((q: QueueData) => q.pending > 0)
        .map((q: QueueData) => ({
          name: q.name,
          value: q.pending,
        })),
    [queues]
  );

  const queueBarList = useMemo(
    () =>
      queues
        .filter((q: QueueData) => q.pending > 0 || q.processing > 0)
        .slice(0, 5)
        .map((q: QueueData) => ({
          name: q.name,
          value: q.pending + q.processing,
        })),
    [queues]
  );

  const completionRate = totalPushed > 0 ? ((totalCompleted / totalPushed) * 100).toFixed(1) : '0';
  const failureRate = totalPushed > 0 ? ((totalDlq / totalPushed) * 100).toFixed(1) : '0';

  return (
    <div className="overview-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Dashboard Overview</Title>
          <Text className="page-subtitle">
            Real-time monitoring and analytics for your job queues
          </Text>
        </div>
        <div className="header-actions">
          <Badge size="lg" color="emerald" className="status-badge">
            <span className="status-indicator" />
            System Online
          </Badge>
        </div>
      </header>

      {/* KPI Cards with Glow Effect - DRY: Using MetricGlowCard */}
      <Grid numItemsSm={2} numItemsLg={4} className="mb-8 gap-6">
        <MetricGlowCard
          title="Queued"
          value={totalQueued}
          icon={<Activity className="h-5 w-5" />}
          glowColor="cyan"
          badge={{
            text: `${totalDelayed} delayed`,
            color: 'zinc',
            icon: <Clock className="mr-1 h-3 w-3" />,
          }}
          sparkline={{ data: queuedSparkline, color: '#06b6d4' }}
        />

        <MetricGlowCard
          title="Processing"
          value={totalProcessing}
          icon={<Zap className="h-5 w-5" />}
          glowColor="blue"
          badge={{
            text: 'Active',
            color: 'blue',
            icon: <span className="live-dot live-dot-blue" />,
          }}
        />

        <MetricGlowCard
          title="Completed"
          value={totalCompleted}
          icon={<CheckCircle2 className="h-5 w-5" />}
          glowColor="emerald"
          badge={{
            text: `${completionRate}%`,
            color: 'emerald',
            icon: <TrendingUp className="mr-1 h-3 w-3" />,
          }}
          sparkline={{ data: throughputSparkline, color: '#10b981' }}
        />

        <MetricGlowCard
          title="Failed (DLQ)"
          value={totalDlq}
          icon={<XCircle className="h-5 w-5" />}
          glowColor="rose"
          badge={{
            text: `${failureRate}% failure`,
            color: totalDlq > 0 ? 'rose' : 'zinc',
          }}
        />
      </Grid>

      {/* Charts Row */}
      <Grid numItemsSm={1} numItemsLg={2} className="mb-8 gap-6">
        <GlowCard glowColor="cyan" className="chart-glow-card">
          <div className="chart-header">
            <div>
              <Title className="chart-title">Throughput</Title>
              <Text className="chart-subtitle">Jobs processed per second over time</Text>
            </div>
            <Badge color="cyan" size="xs">
              <span className="live-dot" />
              Live
            </Badge>
          </div>
          {throughputData.length > 0 ? (
            <AreaChart
              className="chart-area"
              data={throughputData}
              index="date"
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
              <Title className="chart-title">Queue Distribution</Title>
              <Text className="chart-subtitle">Jobs waiting by queue</Text>
            </div>
            <Badge color="blue" size="xs">
              <Layers className="mr-1 h-3 w-3" />
              {queues.length} Queues
            </Badge>
          </div>
          {queueDistribution.length > 0 ? (
            <DonutChart
              className="chart-area donut-chart"
              data={queueDistribution}
              category="value"
              index="name"
              colors={['cyan', 'blue', 'indigo', 'violet', 'purple']}
              showAnimation
              valueFormatter={formatNumber}
              showLabel
            />
          ) : (
            <EmptyState
              variant="chart"
              title="No queues with waiting jobs"
              description="Jobs will appear here when queued for processing"
            />
          )}
        </GlowCard>
      </Grid>

      {/* Bottom Row */}
      <Grid numItemsSm={1} numItemsLg={3} className="gap-6">
        <GlowCard glowColor="violet" className="chart-glow-card lg:col-span-2">
          <div className="chart-header">
            <div>
              <Title className="chart-title">Top Queues</Title>
              <Text className="chart-subtitle">Queues with most active jobs</Text>
            </div>
          </div>
          {queueBarList.length > 0 ? (
            <BarList
              data={queueBarList}
              className="bar-list"
              color="cyan"
              valueFormatter={formatNumber}
            />
          ) : (
            <EmptyState
              variant="chart"
              title="No active queues"
              description="Push jobs to queues to see them listed here"
            />
          )}
        </GlowCard>

        <GlowCard glowColor="emerald" className="chart-glow-card">
          <div className="chart-header">
            <div>
              <Title className="chart-title">System Health</Title>
              <Text className="chart-subtitle">Real-time server metrics</Text>
            </div>
          </div>
          <div className="health-metrics">
            <div className="health-metric">
              <div className="health-metric-header">
                <Text className="health-metric-label">Avg Latency</Text>
                <Text className="health-metric-value">
                  {metrics?.avg_latency_ms?.toFixed(1) || 0} ms
                </Text>
              </div>
              <ProgressBar
                value={Math.min((metrics?.avg_latency_ms || 0) / 10, 100)}
                color="cyan"
                className="health-progress"
              />
            </div>
            <div className="health-metric">
              <div className="health-metric-header">
                <Text className="health-metric-label">Jobs/sec</Text>
                <Text className="health-metric-value">
                  {metrics?.jobs_per_second?.toFixed(1) || 0}
                </Text>
              </div>
              <ProgressBar
                value={Math.min((metrics?.jobs_per_second || 0) * 10, 100)}
                color="blue"
                className="health-progress"
              />
            </div>
            <div className="health-metric">
              <div className="health-metric-header">
                <Text className="health-metric-label">Active Queues</Text>
                <Text className="health-metric-value">{queues.length} queues</Text>
              </div>
              <ProgressBar
                value={Math.min(queues.length * 10, 100)}
                color="emerald"
                className="health-progress"
              />
            </div>
          </div>
        </GlowCard>
      </Grid>
    </div>
  );
}
