import { useState } from 'react';
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
  TextInput,
  Select,
  SelectItem,
} from '@tremor/react';
import {
  Search,
  Pause,
  Play,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { useQueues } from '../hooks';
import { api } from '../api/client';
import { formatNumber } from '../utils';
import type { Queue } from '../api/types';
import './Queues.css';

export function Queues() {
  const { data: queuesData, refetch } = useQueues();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const queues: Queue[] = queuesData || [];

  const filteredQueues = queues.filter((queue) => {
    const matchesSearch = queue.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && !queue.paused) ||
      (statusFilter === 'paused' && queue.paused);
    return matchesSearch && matchesStatus;
  });

  const handlePause = async (queueName: string) => {
    await api.pauseQueue(queueName);
    refetch();
  };

  const handleResume = async (queueName: string) => {
    await api.resumeQueue(queueName);
    refetch();
  };

  const handleDrain = async (queueName: string) => {
    if (confirm(`Are you sure you want to drain all waiting jobs from "${queueName}"?`)) {
      await api.drainQueue(queueName);
      refetch();
    }
  };

  const getQueueStatus = (queue: Queue) => {
    if (queue.paused) return { label: 'Paused', color: 'amber' as const };
    if (queue.processing > 0) return { label: 'Active', color: 'emerald' as const };
    if (queue.pending > 0) return { label: 'Pending', color: 'blue' as const };
    return { label: 'Idle', color: 'zinc' as const };
  };

  return (
    <div className="queues-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Queue Management</Title>
          <Text className="page-subtitle">
            Monitor and control your job queues
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

      <Card className="queues-card">
        {/* Filters */}
        <Flex className="mb-6 gap-4">
          <TextInput
            icon={Search}
            placeholder="Search queues..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={statusFilter}
            onValueChange={setStatusFilter}
            className="max-w-xs"
          >
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
          </Select>
        </Flex>

        {/* Table */}
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Queue Name</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell className="text-right">Waiting</TableHeaderCell>
              <TableHeaderCell className="text-right">Active</TableHeaderCell>
              <TableHeaderCell className="text-right">Completed</TableHeaderCell>
              <TableHeaderCell className="text-right">Failed</TableHeaderCell>
              <TableHeaderCell className="text-right">Delayed</TableHeaderCell>
              <TableHeaderCell className="text-right">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredQueues.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <div className="text-center py-8">
                    <Text>No queues found</Text>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredQueues.map((queue) => {
                const status = getQueueStatus(queue);
                return (
                  <TableRow key={queue.name}>
                    <TableCell>
                      <div className="queue-name">
                        <Text className="font-mono font-semibold text-white">
                          {queue.name}
                        </Text>
                        {queue.rate_limit && (
                          <Badge size="xs" color="violet">
                            {queue.rate_limit}/min
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge color={status.color}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge color="cyan">{formatNumber(queue.pending)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge color="blue">{formatNumber(queue.processing)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-emerald-400 font-mono">
                        {formatNumber(queue.completed || 0)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-rose-400 font-mono">
                        {formatNumber(queue.dlq)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-amber-400 font-mono">
                        {formatNumber(queue.delayed || 0)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Flex justifyContent="end" className="gap-2">
                        {queue.paused ? (
                          <Button
                            size="xs"
                            variant="secondary"
                            icon={Play}
                            onClick={() => handleResume(queue.name)}
                          >
                            Resume
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="secondary"
                            icon={Pause}
                            onClick={() => handlePause(queue.name)}
                          >
                            Pause
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="secondary"
                          color="rose"
                          icon={Trash2}
                          onClick={() => handleDrain(queue.name)}
                        >
                          Drain
                        </Button>
                      </Flex>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Summary */}
        <Flex className="mt-6 pt-6 border-t border-zinc-800">
          <Text>
            Showing {filteredQueues.length} of {queues.length} queues
          </Text>
          <Flex className="gap-4">
            <Text>
              Total Waiting: <span className="text-cyan-400 font-mono">{formatNumber(queues.reduce((sum, q) => sum + q.pending, 0))}</span>
            </Text>
            <Text>
              Total Active: <span className="text-blue-400 font-mono">{formatNumber(queues.reduce((sum, q) => sum + q.processing, 0))}</span>
            </Text>
          </Flex>
        </Flex>
      </Card>
    </div>
  );
}
