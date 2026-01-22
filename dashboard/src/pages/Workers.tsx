import {
  Card,
  Title,
  Text,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Badge,
  Flex,
  Grid,
  Metric,
  ProgressBar,
} from '@tremor/react';
import { Server, Cpu, Activity, Clock, Users, Wifi, WifiOff } from 'lucide-react';
import { useIsConnected, useWorkers } from '../stores';
import { formatRelativeTime } from '../utils';
import type { Worker } from '../api/types';
import './Workers.css';

// Helper functions outside component to avoid recreation on every render
function getWorkerStatus(worker: Worker): 'active' | 'idle' | 'disconnected' {
  const now = Date.now();
  const lastHeartbeat = worker.last_heartbeat;
  const secondsSinceHeartbeat = (now - lastHeartbeat) / 1000;

  if (secondsSinceHeartbeat < 30) return 'active';
  if (secondsSinceHeartbeat < 60) return 'idle';
  return 'disconnected';
}

function getStatusColor(status: string): 'emerald' | 'amber' | 'rose' | 'zinc' {
  switch (status) {
    case 'active':
      return 'emerald';
    case 'idle':
      return 'amber';
    case 'disconnected':
      return 'rose';
    default:
      return 'zinc';
  }
}

export function Workers() {
  // Granular WebSocket hooks - only re-render when workers change
  const isConnected = useIsConnected();
  const workersData = useWorkers();

  const workers: Worker[] = workersData || [];

  // Ensure no negative values
  const activeWorkers = Math.max(0, workers.filter((w) => getWorkerStatus(w) === 'active').length);
  const idleWorkers = Math.max(0, workers.filter((w) => getWorkerStatus(w) === 'idle').length);
  const totalProcessed = Math.max(0, workers.reduce((sum, w) => sum + Math.max(0, w.jobs_processed), 0));

  return (
    <div className="workers-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Workers</Title>
          <Text className="page-subtitle">Real-time worker monitoring via WebSocket</Text>
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

      {/* Stats Cards */}
      <Grid numItemsSm={2} numItemsLg={4} className="mb-8 gap-6">
        <Card className="stat-card" decoration="top" decorationColor="cyan">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Total Workers</Text>
              <Metric>{workers.length}</Metric>
            </div>
            <div className="stat-icon cyan">
              <Users className="h-5 w-5" />
            </div>
          </Flex>
        </Card>

        <Card className="stat-card" decoration="top" decorationColor="emerald">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Active</Text>
              <Metric>{activeWorkers}</Metric>
            </div>
            <div className="stat-icon emerald">
              <Activity className="h-5 w-5" />
            </div>
          </Flex>
          <ProgressBar
            value={workers.length > 0 ? (activeWorkers / workers.length) * 100 : 0}
            color="emerald"
            className="mt-4"
          />
        </Card>

        <Card className="stat-card" decoration="top" decorationColor="amber">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Idle</Text>
              <Metric>{idleWorkers}</Metric>
            </div>
            <div className="stat-icon amber">
              <Clock className="h-5 w-5" />
            </div>
          </Flex>
          <ProgressBar
            value={workers.length > 0 ? (idleWorkers / workers.length) * 100 : 0}
            color="amber"
            className="mt-4"
          />
        </Card>

        <Card className="stat-card" decoration="top" decorationColor="blue">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Jobs Processed</Text>
              <Metric>{totalProcessed.toLocaleString()}</Metric>
            </div>
            <div className="stat-icon blue">
              <Cpu className="h-5 w-5" />
            </div>
          </Flex>
        </Card>
      </Grid>

      {/* Workers Table */}
      <Card className="workers-card">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Worker ID</TableHeaderCell>
              <TableHeaderCell>Queues</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Concurrency</TableHeaderCell>
              <TableHeaderCell className="text-right">Jobs Processed</TableHeaderCell>
              <TableHeaderCell>Last Heartbeat</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {workers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="py-12 text-center">
                    <Server className="mx-auto mb-4 h-12 w-12 text-zinc-600" />
                    <Text className="mb-2 text-lg font-medium text-zinc-400">
                      No workers connected
                    </Text>
                    <Text className="text-zinc-500">
                      Workers will appear here when they connect to the server
                    </Text>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              workers.map((worker) => {
                const status = getWorkerStatus(worker);
                return (
                  <TableRow key={worker.id}>
                    <TableCell>
                      <span className="font-mono font-semibold text-white">
                        {worker.id.length > 20 ? `${worker.id.slice(0, 20)}...` : worker.id}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Flex className="flex-wrap gap-1">
                        {worker.queues.slice(0, 3).map((q) => (
                          <Badge key={q} size="xs" color="cyan">
                            {q}
                          </Badge>
                        ))}
                        {worker.queues.length > 3 && (
                          <Badge size="xs" color="zinc">
                            +{worker.queues.length - 3}
                          </Badge>
                        )}
                      </Flex>
                    </TableCell>
                    <TableCell>
                      <Badge color={getStatusColor(status)}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-blue-400">{worker.concurrency}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-emerald-400">
                        {worker.jobs_processed.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-zinc-400">
                        {formatRelativeTime(worker.last_heartbeat)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
