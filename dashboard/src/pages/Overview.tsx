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
import { useStats, useMetrics } from '../hooks';
import { formatNumber } from '../utils';
import './Overview.css';

export function Overview() {
  const { data: stats } = useStats();
  const { data: metrics } = useMetrics();

  const kpis = [
    {
      title: 'Total Jobs',
      value: formatNumber(stats?.total_jobs || 0),
      icon: Activity,
      color: 'cyan',
      change: '+12.3%',
      changeType: 'increase' as const,
    },
    {
      title: 'Processing',
      value: formatNumber(stats?.total_processing || 0),
      icon: Zap,
      color: 'blue',
      change: 'Active',
      changeType: 'neutral' as const,
    },
    {
      title: 'Completed',
      value: formatNumber(stats?.total_completed || 0),
      icon: CheckCircle2,
      color: 'emerald',
      change: stats?.total_jobs ? `${((stats.total_completed / stats.total_jobs) * 100).toFixed(1)}%` : '0%',
      changeType: 'increase' as const,
    },
    {
      title: 'Failed',
      value: formatNumber(stats?.total_dlq || 0),
      icon: XCircle,
      color: 'rose',
      change: stats?.total_jobs ? `${((stats.total_dlq / stats.total_jobs) * 100).toFixed(1)}%` : '0%',
      changeType: 'decrease' as const,
    },
  ];

  // Transform metrics for charts
  const throughputData = metrics?.history?.map((point: { timestamp: string; jobs_per_sec: number }) => ({
    date: new Date(point.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }),
    'Jobs/sec': point.jobs_per_sec,
  })) || [];

  const queueDistribution = stats?.queues?.map((q: { name: string; waiting: number }) => ({
    name: q.name,
    value: q.waiting,
  })) || [];

  const queueBarList = stats?.queues?.slice(0, 5).map((q: { name: string; waiting: number; processing: number }) => ({
    name: q.name,
    value: q.waiting + q.processing,
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
              {stats?.queues?.length || 0} Queues
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
                <Text>Memory Usage</Text>
                <Text>{metrics?.memory_mb?.toFixed(0) || 0} MB</Text>
              </Flex>
              <ProgressBar value={Math.min((metrics?.memory_mb || 0) / 1024 * 100, 100)} color="cyan" className="mt-2" />
            </div>
            <div>
              <Flex>
                <Text>Active Workers</Text>
                <Text>{stats?.active_connections || 0}</Text>
              </Flex>
              <ProgressBar value={Math.min((stats?.active_connections || 0) * 10, 100)} color="blue" className="mt-2" />
            </div>
            <div>
              <Flex>
                <Text>Queue Utilization</Text>
                <Text>{stats?.queues?.length || 0} active</Text>
              </Flex>
              <ProgressBar value={Math.min((stats?.queues?.length || 0) * 5, 100)} color="emerald" className="mt-2" />
            </div>
          </div>
        </Card>
      </Grid>
    </div>
  );
}
