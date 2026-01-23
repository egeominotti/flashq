import {
  Title,
  Text,
  Grid,
  Badge,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
} from '@tremor/react';
import {
  Server,
  Activity,
  Database,
  Wifi,
  WifiOff,
  MemoryStick,
  Gauge,
  Zap,
  TrendingUp,
} from 'lucide-react';
import {
  useIsConnected,
  useMetrics,
  useMetricsHistory,
  useSystemMetrics,
  useStorageStats,
} from '../../stores';
import { useSettings, useSparklineData } from '../../hooks';
import { formatCompact } from '../../utils';
import { StatCard } from '../../components/common';
import { SystemTab } from './SystemTab';
import { PerformanceTab } from './PerformanceTab';
import { StorageTab } from './StorageTab';
import '../ServerMetrics.css';

export function ServerMetrics() {
  const { data: settings } = useSettings();

  // Granular WebSocket hooks - only re-render when needed data changes
  const isConnected = useIsConnected();
  const metrics = useMetrics();
  const metricsHistory = useMetricsHistory();
  const systemMetrics = useSystemMetrics();
  const storageStats = useStorageStats();

  // DRY: Use custom hook for sparkline data extraction
  const latencySparkline = useSparklineData(metricsHistory, 'latency_ms');
  const throughputSparkline = useSparklineData(metricsHistory, 'throughput');
  const queuedSparkline = useSparklineData(metricsHistory, 'queued');
  const processingSparkline = useSparklineData(metricsHistory, 'processing');

  // Ensure no negative values in stats
  const memoryUsed = Math.max(0, systemMetrics?.memory_used_mb ?? 0);
  const memoryPercent = Math.max(0, systemMetrics?.memory_percent ?? 0);
  const memoryTotal = Math.max(0, systemMetrics?.memory_total_mb ?? 0);
  const avgLatency = Math.max(0, metrics?.avg_latency_ms ?? 0);
  const jobsPerSecond = Math.max(0, metrics?.jobs_per_second ?? 0);
  const tcpConnections = Math.max(0, systemMetrics?.tcp_connections ?? 0);

  return (
    <div className="server-metrics-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Server Metrics</Title>
          <Text className="page-subtitle">Real-time system monitoring via WebSocket</Text>
        </div>
        <div className="header-actions">
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
        </div>
      </header>

      {/* Quick Stats Row */}
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
          value={avgLatency}
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
          value={jobsPerSecond}
          icon={<Zap className="h-5 w-5" />}
          iconColor="emerald"
          formatter={(v) => `${formatCompact(v)}/s`}
          badge={{
            text: 'Jobs/sec',
            icon: <TrendingUp className="mr-1 h-3 w-3" />,
          }}
          sparkline={{ data: throughputSparkline, color: '#10b981' }}
        />

        <StatCard
          title="Connections"
          value={tcpConnections}
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
          <TabPanel>
            <SystemTab settings={settings} systemMetrics={systemMetrics} />
          </TabPanel>

          <TabPanel>
            <PerformanceTab
              isConnected={isConnected}
              metrics={metrics}
              metricsHistory={metricsHistory}
              queuedSparkline={queuedSparkline}
              throughputSparkline={throughputSparkline}
              processingSparkline={processingSparkline}
            />
          </TabPanel>

          <TabPanel>
            <StorageTab storageStats={storageStats} />
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
}
