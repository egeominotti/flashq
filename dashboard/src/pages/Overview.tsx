import {
  Card,
  Title,
  Text,
  Metric,
  Flex,
  Grid,
  AreaChart,
  DonutChart,
  BarList,
  Badge,
  ProgressBar,
} from '@tremor/react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Layers,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useStats, useMetrics, useMetricsHistory } from '../hooks';
import { formatNumber } from '../utils';
import './Overview.css';

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

  const kpis = [
    {
      title: 'Queued',
      value: formatNumber(totalQueued),
      icon: Activity,
      color: 'cyan',
      change: `${totalDelayed} delayed`,
      changeType: 'neutral' as const,
    },
    {
      title: 'Processing',
      value: formatNumber(totalProcessing),
      icon: Zap,
      color: 'blue',
      change: 'Active',
      changeType: 'neutral' as const,
    },
    {
      title: 'Completed',
      value: formatNumber(totalCompleted),
      icon: CheckCircle2,
      color: 'emerald',
      change: totalPushed ? `${((totalCompleted / totalPushed) * 100).toFixed(1)}%` : '0%',
      changeType: 'increase' as const,
    },
    {
      title: 'Failed (DLQ)',
      value: formatNumber(totalDlq),
      icon: XCircle,
      color: 'rose',
      change: totalPushed ? `${((totalDlq / totalPushed) * 100).toFixed(1)}%` : '0%',
      changeType: totalDlq > 0 ? 'decrease' as const : 'neutral' as const,
    },
  ];

  // Transform metrics history for throughput chart
  const throughputData = metricsHistory?.map((point: { timestamp: number; throughput: number }) => ({
    date: new Date(point.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }),
    'Jobs/sec': point.throughput || 0,
  })) || [];

  // Get queue data from metrics endpoint
  const queues = metrics?.queues || [];

  const queueDistribution = queues
    .filter((q: { pending: number }) => q.pending > 0)
    .map((q: { name: string; pending: number }) => ({
      name: q.name,
      value: q.pending,
    })) || [];

  const queueBarList = queues
    .filter((q: { pending: number; processing: number }) => q.pending > 0 || q.processing > 0)
    .slice(0, 5)
    .map((q: { name: string; pending: number; processing: number }) => ({
      name: q.name,
      value: q.pending + q.processing,
    })) || [];

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
          <Badge size="lg" color="emerald">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              System Online
            </span>
          </Badge>
        </div>
      </header>

      {/* KPI Cards */}
      <Grid numItemsSm={2} numItemsLg={4} className="gap-6 mb-8">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.title} className="kpi-card" decoration="top" decorationColor={kpi.color}>
              <Flex alignItems="start" justifyContent="between">
                <div>
                  <Text className="kpi-label">{kpi.title}</Text>
                  <Metric className="kpi-value">{kpi.value}</Metric>
                </div>
                <div className={`kpi-icon kpi-icon-${kpi.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </Flex>
              <Flex className="mt-4">
                <Badge size="sm" color={
                  kpi.changeType === 'increase' ? 'emerald' :
                  kpi.changeType === 'decrease' ? 'rose' : 'zinc'
                }>
                  {kpi.change}
                </Badge>
              </Flex>
            </Card>
          );
        })}
      </Grid>

      {/* Charts Row */}
      <Grid numItemsSm={1} numItemsLg={2} className="gap-6 mb-8">
        <Card className="chart-card">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Title>Throughput</Title>
              <Text>Jobs processed per second over time</Text>
            </div>
            <Badge color="cyan">
              <TrendingUp className="w-3 h-3 mr-1" />
              Live
            </Badge>
          </Flex>
          <AreaChart
            className="h-72 mt-6"
            data={throughputData}
            index="date"
            categories={['Jobs/sec']}
            colors={['cyan']}
            showAnimation
            showLegend={false}
            curveType="monotone"
            valueFormatter={(v) => `${v.toFixed(1)}/s`}
          />
        </Card>

        <Card className="chart-card">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Title>Queue Distribution</Title>
              <Text>Jobs waiting by queue</Text>
            </div>
            <Badge color="blue">
              <Layers className="w-3 h-3 mr-1" />
              {queues.length} Queues
            </Badge>
          </Flex>
          {queueDistribution.length > 0 ? (
            <DonutChart
              className="h-72 mt-6"
              data={queueDistribution}
              category="value"
              index="name"
              colors={['cyan', 'blue', 'indigo', 'violet', 'purple']}
              showAnimation
              valueFormatter={formatNumber}
            />
          ) : (
            <div className="h-72 mt-6 flex items-center justify-center">
              <Text>No queues with waiting jobs</Text>
            </div>
          )}
        </Card>
      </Grid>

      {/* Bottom Row */}
      <Grid numItemsSm={1} numItemsLg={3} className="gap-6">
        <Card className="chart-card col-span-2">
          <Title>Top Queues</Title>
          <Text>Queues with most active jobs</Text>
          <BarList
            data={queueBarList}
            className="mt-6"
            color="cyan"
            valueFormatter={formatNumber}
          />
        </Card>

        <Card className="chart-card">
          <Title>System Health</Title>
          <Text>Real-time server metrics</Text>
          <div className="mt-6 space-y-6">
            <div>
              <Flex>
                <Text>Avg Latency</Text>
                <Text>{metrics?.avg_latency_ms?.toFixed(1) || 0} ms</Text>
              </Flex>
              <ProgressBar value={Math.min((metrics?.avg_latency_ms || 0) / 10, 100)} color="cyan" className="mt-2" />
            </div>
            <div>
              <Flex>
                <Text>Jobs/sec</Text>
                <Text>{metrics?.jobs_per_second?.toFixed(1) || 0}</Text>
              </Flex>
              <ProgressBar value={Math.min((metrics?.jobs_per_second || 0) * 10, 100)} color="blue" className="mt-2" />
            </div>
            <div>
              <Flex>
                <Text>Active Queues</Text>
                <Text>{queues.length} queues</Text>
              </Flex>
              <ProgressBar value={Math.min(queues.length * 10, 100)} color="emerald" className="mt-2" />
            </div>
          </div>
        </Card>
      </Grid>
    </div>
  );
}
