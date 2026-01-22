import { useState, useMemo } from 'react';
import {
  Card,
  Title,
  Text,
  Badge,
  Button,
  Flex,
  TextInput,
  Select,
  SelectItem,
} from '@tremor/react';
import { Search, Pause, Play, Download, Wifi, WifiOff } from 'lucide-react';
import { useIsConnected, useQueues as useQueuesData } from '../../stores';
import { useToast } from '../../hooks';
import { api } from '../../api/client';
import { formatNumber } from '../../utils';
import { ConfirmModal } from '../../components/common/ConfirmModal';
import { Tooltip } from '../../components/common/Tooltip';
import { QueuesTable } from './QueuesTable';
import type { Queue } from '../../api/types';
import '../Queues.css';

export function Queues() {
  const { showToast } = useToast();
  // Granular WebSocket hooks - only re-render when queues change
  const isConnected = useIsConnected();
  const queuesData = useQueuesData();
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

  // Calculate totals - ensure no negative values
  const totalWaiting = Math.max(0, queues.reduce((sum, q) => sum + q.pending, 0));
  const totalActive = Math.max(0, queues.reduce((sum, q) => sum + q.processing, 0));

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
        <QueuesTable
          queues={filteredQueues}
          selectedQueues={selectedQueues}
          onToggleSelect={toggleSelectQueue}
          onToggleSelectAll={toggleSelectAll}
          onPause={handlePause}
          onResume={handleResume}
          onDrain={handleDrain}
        />

        {/* Summary */}
        <Flex className="mt-6 border-t border-zinc-800 pt-6">
          <Text>
            Showing {filteredQueues.length} of {queues.length} queues
          </Text>
          <Flex className="gap-4">
            <Text>
              Total Waiting:{' '}
              <span className="font-mono text-cyan-400">{formatNumber(totalWaiting)}</span>
            </Text>
            <Text>
              Total Active:{' '}
              <span className="font-mono text-blue-400">{formatNumber(totalActive)}</span>
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
