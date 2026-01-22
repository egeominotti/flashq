import { Card, Title, Text, Badge, Grid } from '@tremor/react';
import { Clock, Server, Wifi, Cpu, MemoryStick } from 'lucide-react';
import { formatUptime } from '../../utils';
import { InfoItem, ResourceItem } from '../../components/common';
import type { SystemMetrics } from '../../api/client';

interface SystemTabProps {
  settings: { version?: string; tcp_port?: number; http_port?: number } | null | undefined;
  systemMetrics: SystemMetrics | null;
}

export function SystemTab({ settings, systemMetrics }: SystemTabProps) {
  // Ensure no negative values
  const memoryPercent = Math.max(0, systemMetrics?.memory_percent ?? 0);
  const memoryUsed = Math.max(0, systemMetrics?.memory_used_mb ?? 0);
  const memoryTotal = Math.max(0, systemMetrics?.memory_total_mb ?? 0);
  const cpuPercent = Math.max(0, systemMetrics?.cpu_percent ?? 0);
  const tcpConnections = Math.max(0, systemMetrics?.tcp_connections ?? 0);

  return (
    <Grid numItemsSm={1} numItemsLg={2} className="mt-6 gap-4">
      <Card className="info-card">
        <div className="info-card-header">
          <div>
            <Title className="info-card-title">Server Information</Title>
            <Text className="info-card-subtitle">Runtime configuration and status</Text>
          </div>
          <Badge color="cyan" size="xs">
            v{settings?.version ?? '0.2.0'}
          </Badge>
        </div>
        <div className="info-grid">
          <InfoItem
            icon={<Clock className="h-4 w-4" />}
            iconColor="cyan"
            label="Uptime"
            value={formatUptime(Math.max(0, systemMetrics?.uptime_seconds ?? 0))}
          />
          <InfoItem
            icon={<Server className="h-4 w-4" />}
            iconColor="blue"
            label="TCP Port"
            value={settings?.tcp_port ?? 6789}
          />
          <InfoItem
            icon={<Wifi className="h-4 w-4" />}
            iconColor="emerald"
            label="HTTP Port"
            value={settings?.http_port ?? 6790}
          />
          <InfoItem
            icon={<Cpu className="h-4 w-4" />}
            iconColor="violet"
            label="Process ID"
            value={systemMetrics?.process_id ?? 'N/A'}
          />
        </div>
      </Card>

      <Card className="info-card">
        <div className="info-card-header">
          <div>
            <Title className="info-card-title">Resource Usage</Title>
            <Text className="info-card-subtitle">Memory and CPU utilization</Text>
          </div>
        </div>
        <div className="resource-list">
          <ResourceItem
            icon={<MemoryStick className="h-4 w-4 text-cyan-400" />}
            label="Memory"
            value={`${memoryUsed.toFixed(0)} / ${memoryTotal.toFixed(0)} MB`}
            percent={memoryPercent}
            percentLabel={`${memoryPercent.toFixed(1)}% used`}
          />
          <ResourceItem
            icon={<Cpu className="h-4 w-4 text-blue-400" />}
            label="CPU"
            value={`${cpuPercent.toFixed(1)}%`}
            percent={cpuPercent}
            percentLabel={`${cpuPercent.toFixed(1)}% utilization`}
            color="blue"
          />
          <ResourceItem
            icon={<Wifi className="h-4 w-4 text-emerald-400" />}
            label="Connections"
            value={`${tcpConnections} active`}
            percent={Math.min(tcpConnections * 5, 100)}
            color="emerald"
          />
        </div>
      </Card>
    </Grid>
  );
}
