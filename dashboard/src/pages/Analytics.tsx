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
  ProgressBar,
} from '@tremor/react';
import {
  TrendingUp,
  Activity,
  Clock,
  Zap,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { useMetrics, useStats } from '../hooks';
import { formatNumber } from '../utils';
import './Analytics.css';

export function Analytics() {
  const { data: metrics, refetch } = useMetrics();
  const { data: stats } = useStats();

  const throughputHistory = metrics?.history?.map((point: any) => ({
    timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    'Jobs/sec': point.jobs_per_sec,
    'Push': point.push_rate || 0,
    'Pull': point.pull_rate || 0,
  })) || [];

  const latencyHistory = metrics?.history?.map((point: any) => ({
    timestamp: new Date(point.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    'Avg Latency': point.avg_latency_ms || 0,
    'P99 Latency': point.p99_latency_ms || 0,
  })) || [];

  const queueData = stats?.queues?.map((q: any) => ({
    name: q.name,
    Waiting: q.waiting,
    Active: q.processing,
    Completed: q.completed,
    Failed: q.failed,
  })) || [];

  const totalOps = metrics?.total_operations || 0;
  const avgLatency = metrics?.avg_latency_ms || 0;
  const peakThroughput = metrics?.peak_throughput || 0;
  const memoryUsage = metrics?.memory_mb || 0;

  return (
    <div className="analytics-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Analytics</Title>
          <Text className="page-subtitle">
            Performance metrics and system analytics
          </Text>
        </div>
        <button className="refresh-btn" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </header>

      {/* Key Metrics */}
      <Grid numItemsSm={2} numItemsLg={4} className="gap-6 mb-8">
        <Card className="metric-card" decoration="top" decorationColor="cyan">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Total Operations</Text>
              <Metric>{formatNumber(totalOps)}</Metric>
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

        <Card className="metric-card" decoration="top" decorationColor="emerald">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Peak Throughput</Text>
              <Metric>{formatNumber(peakThroughput)}/s</Metric>
            </div>
            <div className="metric-icon emerald">
              <Zap className="w-5 h-5" />
            </div>
          </Flex>
          <Flex className="mt-4">
            <Badge color="cyan">
              <TrendingUp className="w-3 h-3 mr-1" />
              Maximum
            </Badge>
          </Flex>
        </Card>

        <Card className="metric-card" decoration="top" decorationColor="violet">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Memory Usage</Text>
              <Metric>{memoryUsage.toFixed(0)} MB</Metric>
            </div>
            <div className="metric-icon violet">
              <HardDrive className="w-5 h-5" />
            </div>
          </Flex>
          <Flex className="mt-4">
            <ProgressBar value={Math.min(memoryUsage / 1024 * 100, 100)} color="violet" className="w-full" />
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
              <Title>Latency Distribution</Title>
              <Text>Average and P99 latency in milliseconds</Text>
            </div>
            <Badge color="blue">Live</Badge>
          </Flex>
          <LineChart
            className="h-80"
            data={latencyHistory}
            index="timestamp"
            categories={['Avg Latency', 'P99 Latency']}
            colors={['blue', 'rose']}
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
              categories={['Waiting', 'Active', 'Completed', 'Failed']}
              colors={['cyan', 'blue', 'emerald', 'rose']}
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
              <Title>Push vs Pull Rate</Title>
              <Text>Operation rates over time</Text>
            </div>
            <Badge color="emerald">Live</Badge>
          </Flex>
          <AreaChart
            className="h-80"
            data={throughputHistory}
            index="timestamp"
            categories={['Push', 'Pull']}
            colors={['emerald', 'blue']}
            showAnimation
            curveType="monotone"
            valueFormatter={(v) => `${v.toFixed(1)}/s`}
          />
        </Card>
      </Grid>
    </div>
  );
}
