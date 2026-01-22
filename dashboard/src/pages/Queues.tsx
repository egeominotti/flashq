import { useState, useMemo } from 'react';
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
  Download,
  CheckSquare,
  Square,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useDashboardWebSocket, useToast } from '../hooks';
import { api } from '../api/client';
import { formatNumber } from '../utils';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { Tooltip } from '../components/common/Tooltip';
import type { Queue } from '../api/types';
import './Queues.css';

export function Queues() {
  const { showToast } = useToast();
  const { isConnected, queues: queuesData } = useDashboardWebSocket();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedQueues, setSelectedQueues] = useState<Set<string>>(new Set());

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
    variant: 'danger' | 'warning' | 'info';
    confirmText: string;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: async () => {},
    variant: 'danger',
    confirmText: 'Confirm',
  });
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);

  const queues: Queue[] = useMemo(() => queuesData || [], [queuesData]);

  const filteredQueues = useMemo(() => {
    return queues.filter((queue) => {
      const matchesSearch = queue.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && !queue.paused) ||
        (statusFilter === 'paused' && queue.paused);
      return matchesSearch && matchesStatus;
    });
  }, [queues, searchTerm, statusFilter]);

  const toggleSelectQueue = (name: string) => {
    const newSelected = new Set(selectedQueues);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedQueues(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedQueues.size === filteredQueues.length) {
      setSelectedQueues(new Set());
    } else {
      setSelectedQueues(new Set(filteredQueues.map((q) => q.name)));
    }
  };

  const handlePause = async (queueName: string) => {
    try {
      await api.pauseQueue(queueName);
      showToast(`Queue "${queueName}" paused`, 'success');
    } catch {
      showToast('Failed to pause queue', 'error');
    }
  };

  const handleResume = async (queueName: string) => {
    try {
      await api.resumeQueue(queueName);
      showToast(`Queue "${queueName}" resumed`, 'success');
    } catch {
      showToast('Failed to resume queue', 'error');
    }
  };

  const handleDrain = (queueName: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Drain Queue',
      message: `Are you sure you want to drain all waiting jobs from "${queueName}"? This action cannot be undone.`,
      variant: 'danger',
      confirmText: 'Drain Queue',
      onConfirm: async () => {
        try {
          await api.drainQueue(queueName);
          showToast(`Queue "${queueName}" drained`, 'success');
        } catch {
          showToast('Failed to drain queue', 'error');
        }
      },
    });
  };

  const handleBulkPause = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Pause Selected Queues',
      message: `Are you sure you want to pause ${selectedQueues.size} queue(s)?`,
      variant: 'warning',
      confirmText: 'Pause All',
      onConfirm: async () => {
        try {
          for (const name of selectedQueues) {
            await api.pauseQueue(name);
          }
          showToast(`${selectedQueues.size} queues paused`, 'success');
          setSelectedQueues(new Set());
        } catch {
          showToast('Failed to pause some queues', 'error');
        }
      },
    });
  };

  const handleBulkResume = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Resume Selected Queues',
      message: `Are you sure you want to resume ${selectedQueues.size} queue(s)?`,
      variant: 'info',
      confirmText: 'Resume All',
      onConfirm: async () => {
        try {
          for (const name of selectedQueues) {
            await api.resumeQueue(name);
          }
          showToast(`${selectedQueues.size} queues resumed`, 'success');
          setSelectedQueues(new Set());
        } catch {
          showToast('Failed to resume some queues', 'error');
        }
      },
    });
  };

  const handleExportCSV = () => {
    const csv = [
      'Queue,Status,Waiting,Active,Completed,Failed,Delayed,Rate Limit',
      ...filteredQueues.map(
        (q) =>
          `${q.name},${q.paused ? 'Paused' : 'Active'},${q.pending},${q.processing},${q.completed || 0},${q.dlq},${q.delayed || 0},${q.rate_limit || ''}`
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flashq-queues-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported', 'success');
  };

  const handleConfirm = async () => {
    setIsConfirmLoading(true);
    try {
      await confirmModal.onConfirm();
    } finally {
      setIsConfirmLoading(false);
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
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
          <Text className="page-subtitle">Real-time queue monitoring via WebSocket</Text>
        </div>
        <Flex className="gap-2">
          <Tooltip content="Export to CSV">
            <Button icon={Download} variant="secondary" onClick={handleExportCSV}>
              Export
            </Button>
          </Tooltip>
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
        </Flex>
      </header>

      <Card className="queues-card">
        {/* Filters and Bulk Actions */}
        <Flex className="mb-6 flex-wrap gap-4" justifyContent="between">
          <Flex className="gap-4">
            <TextInput
              icon={Search}
              placeholder="Search queues..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-xs"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter} className="max-w-xs">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </Select>
          </Flex>

          {/* Bulk Actions */}
          {selectedQueues.size > 0 && (
            <Flex className="gap-2">
              <Badge color="cyan">{selectedQueues.size} selected</Badge>
              <Button size="xs" variant="secondary" icon={Pause} onClick={handleBulkPause}>
                Pause All
              </Button>
              <Button size="xs" variant="secondary" icon={Play} onClick={handleBulkResume}>
                Resume All
              </Button>
            </Flex>
          )}
        </Flex>

        {/* Table */}
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell className="w-10">
                <button onClick={toggleSelectAll} className="select-checkbox">
                  {selectedQueues.size === filteredQueues.length && filteredQueues.length > 0 ? (
                    <CheckSquare size={18} className="text-cyan-400" />
                  ) : (
                    <Square size={18} className="text-zinc-500" />
                  )}
                </button>
              </TableHeaderCell>
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
                <TableCell colSpan={9}>
                  <div className="py-8 text-center">
                    <Text>No queues found</Text>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredQueues.map((queue) => {
                const status = getQueueStatus(queue);
                const isSelected = selectedQueues.has(queue.name);
                return (
                  <TableRow key={queue.name} className={isSelected ? 'selected' : ''}>
                    <TableCell>
                      <button
                        onClick={() => toggleSelectQueue(queue.name)}
                        className="select-checkbox"
                      >
                        {isSelected ? (
                          <CheckSquare size={18} className="text-cyan-400" />
                        ) : (
                          <Square size={18} className="text-zinc-500" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="queue-name">
                        <Text className="font-mono font-semibold text-white">{queue.name}</Text>
                        {queue.rate_limit && (
                          <Tooltip content="Rate limit (jobs per minute)">
                            <Badge size="xs" color="violet">
                              {queue.rate_limit}/min
                            </Badge>
                          </Tooltip>
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
                      <span className="font-mono text-emerald-400">
                        {formatNumber(queue.completed || 0)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-rose-400">{formatNumber(queue.dlq)}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-amber-400">
                        {formatNumber(queue.delayed || 0)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Flex justifyContent="end" className="gap-2">
                        {queue.paused ? (
                          <Tooltip content="Resume processing">
                            <Button
                              size="xs"
                              variant="secondary"
                              icon={Play}
                              onClick={() => handleResume(queue.name)}
                            >
                              Resume
                            </Button>
                          </Tooltip>
                        ) : (
                          <Tooltip content="Pause processing">
                            <Button
                              size="xs"
                              variant="secondary"
                              icon={Pause}
                              onClick={() => handlePause(queue.name)}
                            >
                              Pause
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip content="Remove all waiting jobs">
                          <Button
                            size="xs"
                            variant="secondary"
                            color="rose"
                            icon={Trash2}
                            onClick={() => handleDrain(queue.name)}
                          >
                            Drain
                          </Button>
                        </Tooltip>
                      </Flex>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Summary */}
        <Flex className="mt-6 border-t border-zinc-800 pt-6">
          <Text>
            Showing {filteredQueues.length} of {queues.length} queues
          </Text>
          <Flex className="gap-4">
            <Text>
              Total Waiting:{' '}
              <span className="font-mono text-cyan-400">
                {formatNumber(queues.reduce((sum, q) => sum + q.pending, 0))}
              </span>
            </Text>
            <Text>
              Total Active:{' '}
              <span className="font-mono text-blue-400">
                {formatNumber(queues.reduce((sum, q) => sum + q.processing, 0))}
              </span>
            </Text>
          </Flex>
        </Flex>
      </Card>

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        isLoading={isConfirmLoading}
        confirmText={confirmModal.confirmText}
      />
    </div>
  );
}
