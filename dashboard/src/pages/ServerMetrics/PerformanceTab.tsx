import { useMemo } from 'react';
import { Card, Title, Text, AreaChart, Grid, Badge } from '@tremor/react';
import { TrendingUp, Activity, Zap, Gauge } from 'lucide-react';
import { formatNumber } from '../../utils';
import { AnimatedCounter, EmptyState, Sparkline } from '../../components/common';
import type { MetricsHistory, Metrics } from '../../api/types';

interface PerformanceTabProps {
  isConnected: boolean;
  metrics: Metrics | null;
  metricsHistory: MetricsHistory[];
  queuedSparkline: number[];
  throughputSparkline: number[];
  processingSparkline: number[];
}

export function PerformanceTab({
  isConnected,
  metrics,
  metricsHistory,
  queuedSparkline,
  throughputSparkline,
  processingSparkline,
}: PerformanceTabProps) {
  const performanceChartData = useMemo(
    () =>
      metricsHistory?.map((point: MetricsHistory) => ({
        date: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        'Latency (ms)': Math.max(0, point.latency_ms || 0),
        Throughput: Math.max(0, point.throughput || 0),
      })) || [],
    [metricsHistory]
  );

  const loadChartData = useMemo(
    () =>
      metricsHistory?.map((point: MetricsHistory) => ({
        date: new Date(point.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        Queued: Math.max(0, point.queued || 0),
        Processing: Math.max(0, point.processing || 0),
      })) || [],
    [metricsHistory]
  );

  // Ensure no negative values
  const totalPushed = Math.max(0, metrics?.total_pushed ?? 0);
  const totalCompleted = Math.max(0, metrics?.total_completed ?? 0);
  const totalFailed = Math.max(0, metrics?.total_failed ?? 0);
  const successRate = totalPushed > 0 ? ((totalCompleted / totalPushed) * 100).toFixed(1) : '0';

  return (
    <Grid numItemsSm={1} numItemsLg={2} className="mt-6 gap-4">
      <Card className="chart-card">
        <div className="chart-card-header">
          <div>
            <Title className="chart-card-title">Performance Over Time</Title>
            <Text className="chart-card-subtitle">Latency and throughput trends</Text>
          </div>
          <Badge color={isConnected ? 'cyan' : 'zinc'} size="xs">
            {isConnected && <span className="live-dot" />}
            {isConnected ? 'Live' : 'Offline'}
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
          <Badge color={isConnected ? 'blue' : 'zinc'} size="xs">
            {isConnected && <span className="live-dot live-dot-blue" />}
            {isConnected ? 'Real-time' : 'Offline'}
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
                <AnimatedCounter value={totalPushed} formatter={formatNumber} />
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
                <AnimatedCounter value={totalCompleted} formatter={formatNumber} />
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
                <AnimatedCounter value={totalFailed} formatter={formatNumber} />
              </span>
              <span className="job-stat-label">Total Failed</span>
            </div>
          </div>
          <div className="job-stat-item">
            <div className="job-stat-icon icon-blue">
              <Gauge className="h-5 w-5" />
            </div>
            <div className="job-stat-content">
              <span className="job-stat-value">{successRate}%</span>
              <span className="job-stat-label">Success Rate</span>
            </div>
            <Sparkline data={processingSparkline} width={80} height={32} color="#3b82f6" />
          </div>
        </div>
      </Card>
    </Grid>
  );
}
