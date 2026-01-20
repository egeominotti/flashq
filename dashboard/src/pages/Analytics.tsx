import {
  Card,
  Title,
  Text,
  Metric,
  Flex,
  Grid,
  AreaChart,
  BarChart,
  LineChart,
  Badge,
} from '@tremor/react';
import {
  TrendingUp,
  Activity,
  Clock,
  Zap,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useMetrics, useMetricsHistory } from '../hooks';
import { formatNumber } from '../utils';
import './Analytics.css';

export function Analytics() {
  const { data: metrics, refetch } = useMetrics();
  const { data: metricsHistory, refetch: refetchHistory } = useMetricsHistory();

  const handleRefresh = () => {
    refetch();
    refetchHistory();
  };

  const throughputHistory = metricsHistory?.map((point: any) => ({
    timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    'Jobs/sec': point.throughput || 0,
  })) || [];

  const latencyHistory = metricsHistory?.map((point: any) => ({
    timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    'Avg Latency': point.latency_ms || 0,
  })) || [];

  // Get queue data from metrics endpoint
  const queueData = metrics?.queues?.map((q: any) => ({
    name: q.name,
    Waiting: q.pending,
    Active: q.processing,
    DLQ: q.dlq,
  })) || [];

  const totalPushed = metrics?.total_pushed || 0;
  const totalCompleted = metrics?.total_completed || 0;
  const avgLatency = metrics?.avg_latency_ms || 0;
  const currentThroughput = metrics?.jobs_per_second || 0;

  return (
    <div className="analytics-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Analytics</Title>
          <Text className="page-subtitle">
            Performance metrics and system analytics
          </Text>
        </div>
        <button className="refresh-btn" onClick={handleRefresh}>
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </header>

      {/* Key Metrics */}
      <Grid numItemsSm={2} numItemsLg={4} className="gap-6 mb-8">
        <Card className="metric-card" decoration="top" decorationColor="cyan">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Total Pushed</Text>
              <Metric>{formatNumber(totalPushed)}</Metric>
            </div>
            <div className="metric-icon cyan">
              <Activity className="w-5 h-5" />
            </div>
          </Flex>
          <Flex className="mt-4">
            <Badge color="emerald">
              <TrendingUp className="w-3 h-3 mr-1" />
              All time
            </Badge>
          </Flex>
        </Card>

        <Card className="metric-card" decoration="top" decorationColor="emerald">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Total Completed</Text>
              <Metric>{formatNumber(totalCompleted)}</Metric>
            </div>
            <div className="metric-icon emerald">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </Flex>
          <Flex className="mt-4">
            <Badge color="emerald">
              {totalPushed > 0 ? `${((totalCompleted / totalPushed) * 100).toFixed(1)}%` : '0%'}
            </Badge>
          </Flex>
        </Card>

        <Card className="metric-card" decoration="top" decorationColor="blue">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Avg Latency</Text>
              <Metric>{avgLatency.toFixed(2)}ms</Metric>
            </div>
            <div className="metric-icon blue">
              <Clock className="w-5 h-5" />
            </div>
          </Flex>
          <Flex className="mt-4">
            <Badge color={avgLatency < 10 ? 'emerald' : avgLatency < 50 ? 'amber' : 'rose'}>
              {avgLatency < 10 ? 'Excellent' : avgLatency < 50 ? 'Good' : 'Slow'}
            </Badge>
          </Flex>
        </Card>

        <Card className="metric-card" decoration="top" decorationColor="violet">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Current Throughput</Text>
              <Metric>{currentThroughput.toFixed(1)}/s</Metric>
            </div>
            <div className="metric-icon violet">
              <Zap className="w-5 h-5" />
            </div>
          </Flex>
          <Flex className="mt-4">
            <Badge color="cyan">Live</Badge>
          </Flex>
        </Card>
      </Grid>

      {/* Charts Row 1 */}
      <Grid numItemsSm={1} numItemsLg={2} className="gap-6 mb-8">
        <Card className="chart-card">
          <Flex alignItems="start" justifyContent="between" className="mb-6">
            <div>
              <Title>Throughput Over Time</Title>
              <Text>Jobs processed per second</Text>
            </div>
            <Badge color="cyan">Live</Badge>
          </Flex>
          <AreaChart
            className="h-80"
            data={throughputHistory}
            index="timestamp"
            categories={['Jobs/sec']}
            colors={['cyan']}
            showAnimation
            showLegend={false}
            curveType="monotone"
            valueFormatter={(v) => `${v.toFixed(1)}/s`}
          />
        </Card>

        <Card className="chart-card">
          <Flex alignItems="start" justifyContent="between" className="mb-6">
            <div>
              <Title>Latency Over Time</Title>
              <Text>Average latency in milliseconds</Text>
            </div>
            <Badge color="blue">Live</Badge>
          </Flex>
          <LineChart
            className="h-80"
            data={latencyHistory}
            index="timestamp"
            categories={['Avg Latency']}
            colors={['blue']}
            showAnimation
            curveType="monotone"
            valueFormatter={(v) => `${v.toFixed(2)}ms`}
          />
        </Card>
      </Grid>

      {/* Charts Row 2 */}
      <Grid numItemsSm={1} numItemsLg={2} className="gap-6">
        <Card className="chart-card">
          <Flex alignItems="start" justifyContent="between" className="mb-6">
            <div>
              <Title>Queue Comparison</Title>
              <Text>Jobs by state across queues</Text>
            </div>
            <Badge color="violet">{queueData.length} Queues</Badge>
          </Flex>
          {queueData.length > 0 ? (
            <BarChart
              className="h-80"
              data={queueData}
              index="name"
              categories={['Waiting', 'Active', 'DLQ']}
              colors={['cyan', 'blue', 'rose']}
              showAnimation
              stack
              valueFormatter={formatNumber}
            />
          ) : (
            <div className="h-80 flex items-center justify-center">
              <Text>No queue data available</Text>
            </div>
          )}
        </Card>

        <Card className="chart-card">
          <Flex alignItems="start" justifyContent="between" className="mb-6">
            <div>
              <Title>Jobs in Queue Over Time</Title>
              <Text>Queue depth over time</Text>
            </div>
            <Badge color="emerald">Live</Badge>
          </Flex>
          {metricsHistory && metricsHistory.length > 0 ? (
            <AreaChart
              className="h-80"
              data={metricsHistory.map((point: any) => ({
                timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                Queued: point.queued || 0,
                Processing: point.processing || 0,
              }))}
              index="timestamp"
              categories={['Queued', 'Processing']}
              colors={['cyan', 'blue']}
              showAnimation
              curveType="monotone"
              valueFormatter={formatNumber}
            />
          ) : (
            <div className="h-80 flex items-center justify-center">
              <Text>No history data available</Text>
            </div>
          )}
        </Card>
      </Grid>
    </div>
  );
}
