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
  Button,
  Flex,
  Grid,
  Metric,
  ProgressBar,
} from '@tremor/react';
import {
  RefreshCw,
  Server,
  Cpu,
  Activity,
  Clock,
  Users,
} from 'lucide-react';
import { useWorkers } from '../hooks';
import { formatRelativeTime } from '../utils';
import './Workers.css';

interface Worker {
  id: string;
  host?: string;
  queues: string[];
  status: 'active' | 'idle' | 'disconnected';
  jobs_processed: number;
  current_job?: string;
  connected_at: string;
  last_heartbeat: string;
}

export function Workers() {
  const { data: workersData, refetch } = useWorkers();

  const workers: Worker[] = workersData?.workers || [];
  const activeWorkers = workers.filter(w => w.status === 'active').length;
  const idleWorkers = workers.filter(w => w.status === 'idle').length;
  const totalProcessed = workers.reduce((sum, w) => sum + w.jobs_processed, 0);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'emerald';
      case 'idle': return 'amber';
      case 'disconnected': return 'rose';
      default: return 'zinc';
    }
  };

  return (
    <div className="workers-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Workers</Title>
          <Text className="page-subtitle">
            Monitor connected workers and their status
          </Text>
        </div>
        <Button
          icon={RefreshCw}
          variant="secondary"
          onClick={() => refetch()}
        >
          Refresh
        </Button>
      </header>

      {/* Stats Cards */}
      <Grid numItemsSm={2} numItemsLg={4} className="gap-6 mb-8">
        <Card className="stat-card" decoration="top" decorationColor="cyan">
          <Flex alignItems="start" justifyContent="between">
            <div>
              <Text>Total Workers</Text>
              <Metric>{workers.length}</Metric>
            </div>
            <div className="stat-icon cyan">
              <Users className="w-5 h-5" />
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
              <Activity className="w-5 h-5" />
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
              <Clock className="w-5 h-5" />
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
              <Cpu className="w-5 h-5" />
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
              <TableHeaderCell>Host</TableHeaderCell>
              <TableHeaderCell>Queues</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Current Job</TableHeaderCell>
              <TableHeaderCell className="text-right">Jobs Processed</TableHeaderCell>
              <TableHeaderCell>Connected</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {workers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="text-center py-12">
                    <Server className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                    <Text className="text-lg font-medium text-zinc-400 mb-2">
                      No workers connected
                    </Text>
                    <Text className="text-zinc-500">
                      Workers will appear here when they connect to the server
                    </Text>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              workers.map((worker) => (
                <TableRow key={worker.id}>
                  <TableCell>
                    <span className="font-mono font-semibold text-white">
                      {worker.id.slice(0, 8)}...
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-zinc-400">
                      {worker.host || 'Unknown'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Flex className="gap-1 flex-wrap">
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
                    <Badge color={getStatusColor(worker.status)}>
                      {worker.status.charAt(0).toUpperCase() + worker.status.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {worker.current_job ? (
                      <span className="font-mono text-blue-400">
                        {worker.current_job}
                      </span>
                    ) : (
                      <span className="text-zinc-500">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-emerald-400">
                      {worker.jobs_processed.toLocaleString()}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-zinc-400">
                      {formatRelativeTime(worker.connected_at)}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
